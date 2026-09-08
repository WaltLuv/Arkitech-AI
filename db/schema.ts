/**
 * Drizzle table definitions and inferred types for users, tools, agent configs, and agent runs.
 */
import { bigint, boolean, customType, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

/** Raw bytes. Drizzle has no built-in bytea, so the mapping is declared once here. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name"),
  email: text("email").notNull().unique(),
  // Which plan the account is on, and what decides its Agent Slot entitlement
  // when no override is set. `lib/agent-entitlement.ts` owns the numbers, and
  // the claim statement builds its SQL from them.
  planTier: varchar('plan_tier', { length: 20 }).default('starter'),
  // An operator-set Agent Slot entitlement that supersedes the plan. Null on an
  // ordinary account. Bounded by a CHECK constraint, not by trust.
  agentSlotOverride: integer('agent_slot_override'),
  // Keep the misspelled DB column name for compatibility with existing databases.
  usageCredits: integer('ussageCredits').default(100),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const tools = pgTable("tools", {
  id: uuid("id").defaultRandom().primaryKey(),

  slug: varchar("slug", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 150 }).notNull(),
  description: text("description"),

  category: varchar("category", { length: 100 }).notNull(),
  type: varchar("type", { length: 50 }).notNull(),
  provider: varchar("provider", { length: 100 }).notNull(),

  icon: text("icon",),

  status: varchar("status", { length: 50 }).default("active"),

  requiresAuth: boolean("requires_auth").default(false),
  authType: varchar("auth_type", { length: 50 }),
  authProvider: varchar("auth_provider", { length: 100 }),

  capabilities: jsonb("capabilities").$type<string[]>().default([]),
  useCases: jsonb("use_cases").$type<string[]>().default([]),

  permissions: jsonb("permissions").$type<string[]>().default([]),

  // Provider-specific safety flags that can be evaluated before risky tool calls.
  approvalRules: jsonb("approval_rules").$type<Record<string, boolean>>(),

  config: jsonb("config").$type<Record<string, any>>(),

  riskLevel: varchar("risk_level", { length: 30 }).default("low"),

  canRead: boolean("can_read").default(false),
  canWrite: boolean("can_write").default(false),
  canDelete: boolean("can_delete").default(false),
  canExecute: boolean("can_execute").default(true),

  enabled: boolean("enabled").default(true),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const AgentConfig = pgTable("agentConfig", {
  id: serial("id").primaryKey(),
  userEmail: text('email').references(() => users.email),
  agentId: varchar('agentId').notNull().unique(),
  name: varchar('name'),
  agentImage: varchar('agentImage'),
  description: text('description'),
  instructions: text('instructions'),
  objective: text('objective'),
  tools: jsonb('tools'),
  skills: jsonb('skills'),
  schedule: jsonb('schedule'),
  outputFormat: text('outputFormat'),
  status: varchar('status').default('active'),// Active, Pause
  composioSessionId: varchar('composioSessionId'),
  // Which Agent Slot this Agent occupies, 0-based. Server-owned allocation
  // state: no client may set or move it. The unique index below is what
  // actually caps a user at their effective entitlement, because locks cannot:
  // a count reads the snapshot taken before the lock was acquired.
  slotIndex: integer('slot_index'),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, table => [
  uniqueIndex("agent_config_user_slot").on(table.userEmail, table.slotIndex),
])

export const AgentRun = pgTable(
  "agentRun",
  {
    id: uuid("id")
      .defaultRandom()
      .primaryKey(),

    agentId: varchar("agentId")
      .notNull()
      .references(() => AgentConfig.agentId),

    userEmail: text("email").notNull(),

    scheduledFor: timestamp("scheduled_for", {
      withTimezone: true,
    }).notNull(),

    timezone: varchar("timezone", {
      length: 100,
    }).notNull(),

    // scheduled | queued | running | completed | failed | cancelled
    status: varchar("status")
      .default("scheduled")
      .notNull(),

    // Usage Credits charged for this Run, captured at acceptance so a later
    // price change never restates history. Read this; never assume 1.
    creditCost: integer("credit_cost").default(1).notNull(),

    output: jsonb("output"),
    error: text("error"),

    queuedAt: timestamp("queued_at", {
      withTimezone: true,
    }),

    startedAt: timestamp("started_at", {
      withTimezone: true,
    }),

    completedAt: timestamp("completed_at", {
      withTimezone: true,
    }),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  table => [
    // Prevent duplicate scheduled records for the same agent/time pair.
    uniqueIndex("unique_agent_occurrence").on(
      table.agentId,
      table.scheduledFor,
    ),

    // Speeds up the scheduler query that scans by status and scheduled time.
    index("agent_run_schedule_lookup").on(
      table.status,
      table.scheduledFor,
    ),
  ],
);


/**
 * Append-only record of every Usage Credit movement, and the source of truth
 * for what a user has spent. `users.usageCredits` is a cache of this.
 */
export const creditLedger = pgTable(
  "creditLedger",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    userEmail: text("email")
      .notNull()
      .references(() => users.email),

    // Null for system entries such as opening_balance, which belong to no
    // Agent and no Run. Every user-caused movement carries both.
    agentId: varchar("agentId"),
    runId: uuid("runId"),

    // Always positive. `direction` says which way it moved.
    amount: integer("amount").notNull(),

    // debit | credit
    direction: varchar("direction", { length: 10 }).notNull(),

    // opening_balance | run_accepted | platform_failure | worker_failure |
    // provider_failure | agent_failure | cancelled_before_execution
    reason: varchar("reason", { length: 40 }).notNull(),

    balanceAfter: integer("balance_after").notNull(),

    // Makes a repeated write a no-op rather than a double charge or a double
    // refund. Enforced by the unique index below, not by checking first.
    idempotencyKey: varchar("idempotency_key", { length: 200 }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => [
    uniqueIndex("credit_ledger_idempotency_key").on(table.idempotencyKey),

    // The dashboard reads a user's entries newest first.
    index("credit_ledger_user_time").on(table.userEmail, table.createdAt),
  ],
);


/**
 * A unit of browser work Arkitech owns. The provider supplies the browser; this
 * row is the thing Arkitech schedules, authorises, cancels and reports on.
 */
export const browserRun = pgTable(
  "browserRun",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    userEmail: text("email").notNull(),
    agentId: varchar("agentId").notNull(),

    // The Arkitech Run this browser work belongs to, when it was started by one.
    runId: uuid("runId"),

    task: text("task").notNull(),

    // queued | claimed | running | completed | failed | cancelled
    status: varchar("status", { length: 20 }).default("queued").notNull(),

    // urgent sorts before normal. Never used to bypass approvals or to seize
    // control from an active controller.
    priority: varchar("priority", { length: 10 }).default("normal").notNull(),

    // Set the moment cancellation is requested, so a queued run can never be
    // claimed afterwards.
    cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),

    attempt: integer("attempt").default(0).notNull(),

    // Identifies the worker holding the claim, so a stale claim is recognisable.
    claimedBy: varchar("claimed_by", { length: 100 }),

    failureReason: text("failure_reason"),

    // What the agent reported when it finished. Plain text; never reasoning.
    result: text("result"),

    // How long a browser was actually held for this run, and how many bytes of
    // evidence it left. Measurement for observability, not a price: browser
    // work is paid for by the Run's existing Usage Credit charge and nothing
    // here creates a Ledger Entry.
    durationMs: integer("duration_ms"),
    artifactBytes: bigint("artifact_bytes", { mode: "number" }),

    queuedAt: timestamp("queued_at", { withTimezone: true }).defaultNow().notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  table => [
    // The queue read: pending work, highest priority first, then oldest.
    index("browser_run_queue").on(table.status, table.priority, table.queuedAt),
    index("browser_run_owner").on(table.userEmail, table.queuedAt),
  ],
);

/**
 * A provider session backing one browser run.
 *
 * `creationKey` is written before the provider is called, so a create whose
 * outcome is unknown can be reconciled against the provider rather than
 * retried, which would create a second paid browser.
 */
export const browserSession = pgTable(
  "browserSession",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    browserRunId: uuid("browser_run_id").notNull(),
    userEmail: text("email").notNull(),

    creationKey: varchar("creation_key", { length: 100 }).notNull(),

    browserbaseSessionId: varchar("browserbase_session_id", { length: 120 }),
    browserbaseContextId: varchar("browserbase_context_id", { length: 120 }),

    // pending | running | released | errored | timed_out | unknown
    status: varchar("status", { length: 20 }).default("pending").notNull(),

    // not_requested | requested | released | failed
    releaseState: varchar("release_state", { length: 20 }).default("not_requested").notNull(),

    // How long this provider session was held. Written when it is released,
    // so a session nobody released is visibly unmeasured rather than free.
    durationMs: integer("duration_ms"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  table => [
    // One session per creation attempt. Reconciliation depends on this.
    uniqueIndex("browser_session_creation_key").on(table.creationKey),
    index("browser_session_run").on(table.browserRunId),
  ],
);


/**
 * Browser execution slots. One row per concurrently permitted session.
 *
 * Capacity is structural rather than counted: there are only as many rows as
 * the limit allows, so no amount of concurrency can produce an extra active
 * session. This is deliberate. The Agent Slot work established that counting
 * and then deciding cannot hold an invariant here, and that neither an advisory
 * lock nor SELECT FOR UPDATE fixes it, because the count reads a snapshot taken
 * before the lock is acquired.
 */
export const browserSlot = pgTable(
  "browserSlot",
  {
    slotIndex: integer("slot_index").primaryKey(),

    // Null when free. Holding it is what consumes capacity.
    browserRunId: uuid("browser_run_id"),

    claimedAt: timestamp("claimed_at", { withTimezone: true }),
  },
  table => [
    // A run can occupy at most one slot.
    uniqueIndex("browser_slot_run").on(table.browserRunId),
  ],
);


/**
 * The activity trail Arkitech owns, independent of the provider.
 *
 * Ordered by a per-run sequence rather than by timestamp, so ordering survives
 * clock skew between workers.
 */
export const browserEvent = pgTable(
  "browserEvent",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    browserRunId: uuid("browser_run_id").notNull(),
    userEmail: text("email").notNull(),
    browserSessionId: uuid("browser_session_id"),

    sequence: integer("sequence").notNull(),

    // queued | claimed | started | session_created | navigation |
    // action_proposed | action_executed | approval_requested |
    // approval_resolved | screenshot | file_downloaded | file_uploaded |
    // paused | takeover_requested | human_control | agent_control_restored |
    // warning | failed | cancelled | verification | completed |
    // session_released
    kind: varchar("kind", { length: 40 }).notNull(),

    // agent | human | system. Who caused it, not who is described by it.
    actor: varchar("actor", { length: 20 }).notNull(),
    actorId: varchar("actor_id", { length: 200 }),

    // Safe structured metadata only. Never reasoning, credentials, cookies, or
    // any writable capability URL; lib/browserbase/activity.ts refuses those.
    detail: jsonb("detail"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  table => [
    // One sequence number per run: two writers cannot claim the same position.
    uniqueIndex("browser_event_run_sequence").on(table.browserRunId, table.sequence),
    index("browser_event_owner").on(table.userEmail, table.createdAt),
  ],
);

/**
 * Durable evidence. A provider URL is a pointer to someone else's storage with
 * its own retention; an artifact is bytes Arkitech holds and can verify.
 */
export const browserArtifact = pgTable(
  "browserArtifact",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    browserRunId: uuid("browser_run_id").notNull(),
    userEmail: text("email").notNull(),
    agentId: varchar("agentId"),
    browserSessionId: uuid("browser_session_id"),

    // screenshot | download | generated | recording
    source: varchar("source", { length: 20 }).notNull(),

    filename: varchar("filename", { length: 400 }),
    mimeType: varchar("mime_type", { length: 120 }),
    sizeBytes: integer("size_bytes"),

    // sha256 of the stored bytes. Absent until the bytes are actually held.
    checksum: varchar("checksum", { length: 100 }),

    // Key in Arkitech-controlled private storage.
    storageKey: varchar("storage_key", { length: 500 }),

    // pending | stored | verified | missing | failed
    verificationState: varchar("verification_state", { length: 20 })
      .default("pending")
      .notNull(),

    // retained | expired
    retentionState: varchar("retention_state", { length: 20 }).default("retained").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  table => [index("browser_artifact_run").on(table.browserRunId, table.createdAt)],
);


/**
 * Who may drive a browser run, and since when.
 *
 * One row per run. `generation` is a fence: it increases on every handover, and
 * an actor holding an older generation is refused. That is what stops a worker
 * that was paused, or a human tab left open, from writing after control moved.
 */
export const browserControlLease = pgTable(
  "browserControlLease",
  {
    browserRunId: uuid("browser_run_id").primaryKey(),
    userEmail: text("email").notNull(),

    // agent | human | none
    holderKind: varchar("holder_kind", { length: 10 }).notNull(),
    holderId: varchar("holder_id", { length: 200 }),

    // Monotonic. Every grant and every revocation increments it.
    generation: integer("generation").default(0).notNull(),

    expiresAt: timestamp("expires_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
);


/**
 * The bytes behind a browserArtifact, held in Arkitech's own database rather
 * than referenced at the provider. A provider URL expires; this does not.
 *
 * Separate from browserArtifact so listing files never drags every screenshot
 * through the query.
 */
export const browserArtifactBlob = pgTable("browserArtifactBlob", {
  artifactId: uuid("artifact_id").primaryKey(),
  userEmail: text("email").notNull(),
  bytes: bytea("bytes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});


/**
 * Which sites a browser run for this Agent may reach. One row per Agent,
 * owner-scoped in every read and write. Absent means the default policy:
 * public websites allowed, private networks and metadata endpoints refused.
 * Those refusals are not stored here because no row may switch them off.
 */
export const browserSitePolicy = pgTable("browserSitePolicy", {
  agentId: varchar("agent_id").primaryKey(),
  userEmail: text("email").notNull(),

  // Public hosts outside the list are allowed when true.
  allowPublic: boolean("allow_public").default(true).notNull(),

  // Normalised host rules. `example.com` covers its subdomains.
  allowedHosts: jsonb("allowed_hosts").$type<string[]>().default([]).notNull(),

  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});


export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type CreditLedgerEntry = typeof creditLedger.$inferSelect;
export type NewCreditLedgerEntry = typeof creditLedger.$inferInsert;
export type BrowserRun = typeof browserRun.$inferSelect;
export type BrowserSession = typeof browserSession.$inferSelect;
export type BrowserSlot = typeof browserSlot.$inferSelect;
export type BrowserEvent = typeof browserEvent.$inferSelect;
export type BrowserArtifact = typeof browserArtifact.$inferSelect;
export type BrowserControlLease = typeof browserControlLease.$inferSelect;
export type BrowserArtifactBlob = typeof browserArtifactBlob.$inferSelect;
export type BrowserSitePolicy = typeof browserSitePolicy.$inferSelect;


/**
 * A connected communication channel: one bot or one workspace install a user
 * has attached to their account.
 *
 * Owner-scoped like everything else here, by `userEmail`. That scoping is what
 * stops one customer's inbound traffic reaching another's Team member, so it is
 * checked on the way in rather than assumed: an inbound event resolves to a
 * connection, and the connection names its owner.
 *
 * Credentials never sit here in the clear. `secret` holds an AES-256-GCM
 * envelope written by lib/channels/secrets.ts, and no read path returns it to a
 * client. `externalAccountLabel` is the only part a user sees: @SomeBot, or a
 * Slack workspace name.
 */
export const channelConnection = pgTable(
  "channelConnection",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    userEmail: text("email").notNull(),

    // telegram | slack. Web needs no connection: it is Arkitech itself.
    provider: varchar("provider", { length: 20 }).notNull(),

    // pending_link | active | needs_attention | disconnected
    //
    // `pending_link` is the gap between a verified bot and a human proving they
    // are the owner by messaging it. No agent runs for a connection in that
    // state, which is what makes a public bot username harmless.
    status: varchar("status", { length: 20 }).default("pending_link").notNull(),

    // Which Team member answers on this connection. One connection, one
    // default Team member: a customer should not have to configure routing to
    // send their first message.
    defaultAgentId: varchar("defaultAgentId"),

    // The provider's own id for the bot or workspace, and a human label for it.
    // The id is what a second connection attempt collides on.
    externalAccountId: varchar("external_account_id", { length: 120 }).notNull(),
    externalAccountLabel: varchar("external_account_label", { length: 200 }),

    // AES-256-GCM envelope. Bot token, signing secret, webhook secret. Never
    // selected into an API response; see lib/channels/connection-view.ts.
    secret: text("secret"),

    // The external person the provider already proved owns this account, where
    // the connect flow proves it. Slack sets it: installing the app is done
    // from inside the workspace by a signed-in Arkitech user, so that Slack
    // user needs no second linking step and their first direct message opens
    // the conversation. Telegram leaves it null, because pasting a bot token
    // says nothing about who will later message the bot; that connection is
    // linked by a one-time code instead.
    authorizedExternalUserId: varchar("authorized_external_user_id", { length: 120 }),

    // Why a connection is unhealthy, in words a support conversation can use.
    // Never carries a provider error verbatim, because those quote tokens.
    statusReason: varchar("status_reason", { length: 200 }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  table => [
    // One bot, or one workspace install, belongs to exactly one Arkitech
    // account. Without this a second customer could paste the same bot token
    // and start receiving the first customer's conversations.
    uniqueIndex("channel_connection_account").on(table.provider, table.externalAccountId),
    index("channel_connection_owner").on(table.userEmail, table.provider),
  ],
);


/**
 * A conversation between one user and one Team member, on one channel.
 *
 * Arkitech owns this record. The channel is where it is carried, not what it
 * is: the same Team member, memory and permissions apply whether the message
 * arrived from the web, Telegram or Slack.
 *
 * Deliberately per-channel rather than one universal thread. Merging a Slack
 * DM and a Telegram chat into a single transcript reads as a bug to the person
 * in either app, who cannot see the other half. Cross-channel continuity comes
 * from every conversation resolving to the same owner and Team member, so
 * Arkitech can show them together without pretending they were one exchange.
 */
export const conversation = pgTable(
  "conversation",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    userEmail: text("email").notNull(),
    agentId: varchar("agentId").notNull(),

    // web | telegram | slack
    channel: varchar("channel", { length: 20 }).notNull(),

    // Null for web, which is Arkitech's own surface and needs no connection.
    connectionId: uuid("connection_id"),

    // active | archived
    status: varchar("status", { length: 20 }).default("active").notNull(),

    // Denormalised so the conversation list sorts without touching messages.
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  table => [
    index("conversation_owner").on(table.userEmail, table.lastMessageAt),
    index("conversation_agent").on(table.agentId, table.lastMessageAt),
  ],
);


/**
 * The provider-side identity of a conversation, and the proof that it is
 * allowed to reach an Agent.
 *
 * This is the authorisation record. A bot username is public and anyone can
 * message it, so being able to reach the bot means nothing on its own. A row
 * here says: this external chat, on this connection, was linked by someone who
 * proved they hold the Arkitech account, and it maps to that conversation.
 * Inbound traffic with no row is refused before any Agent is built.
 *
 * Provider-specific ids stay here, as opaque strings. The conversation and
 * message tables never learn what a Telegram chat id or a Slack channel id is.
 */
export const channelThread = pgTable(
  "channelThread",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    conversationId: uuid("conversation_id").notNull(),
    connectionId: uuid("connection_id").notNull(),

    // Denormalised owner, so an inbound lookup reads one row to learn both who
    // owns this chat and whether it is authorised.
    userEmail: text("email").notNull(),
    provider: varchar("provider", { length: 20 }).notNull(),

    // The chat or channel the messages belong to.
    externalChatId: varchar("external_chat_id", { length: 120 }).notNull(),

    // The one external person authorised on this chat. Present for private
    // chats, which is all the first release accepts.
    externalUserId: varchar("external_user_id", { length: 120 }),

    // private | group | channel. Only `private` is served today; the column
    // exists so a group arriving at the webhook is recognised and refused
    // rather than silently treated as a private chat.
    chatKind: varchar("chat_kind", { length: 20 }).default("private").notNull(),

    // active | revoked. Revoked survives a disconnect so a later reconnect is
    // a deliberate act rather than an accident of history.
    status: varchar("status", { length: 20 }).default("active").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  table => [
    // The inbound lookup, and the guarantee that one external chat maps to one
    // conversation however many updates arrive at once.
    uniqueIndex("channel_thread_external_chat").on(table.connectionId, table.externalChatId),
    index("channel_thread_owner").on(table.userEmail),
  ],
);


/**
 * One message in a conversation, in either direction.
 *
 * `runId` is the link to the Run that produced an agent reply, and through the
 * Run to the Credit Ledger. A message arriving from Telegram therefore costs
 * exactly what the same message typed into Arkitech costs, and is attributable
 * on the usage dashboard the same way.
 *
 * `externalMessageId` is the provider's id for the delivered message, stored so
 * a reply can be threaded where the provider supports it. It is not the dedup
 * key: that is channelInboundEvent, which is written before any work happens.
 */
export const message = pgTable(
  "message",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    conversationId: uuid("conversation_id").notNull(),
    userEmail: text("email").notNull(),

    // inbound (towards Arkitech) | outbound (towards the person)
    direction: varchar("direction", { length: 10 }).notNull(),

    // user | agent | system. System carries Arkitech's own notices, such as
    // the line confirming a channel was linked.
    senderKind: varchar("sender_kind", { length: 10 }).notNull(),

    body: text("body"),

    // The Arkitech message this one answers, where the exchange is threaded.
    replyToId: uuid("reply_to_id"),

    // The Run that produced this reply, and so the Usage Credit it cost.
    runId: uuid("runId"),

    externalMessageId: varchar("external_message_id", { length: 120 }),

    // received | queued | sending | sent | failed
    //
    // Inbound messages are `received`. Outbound ones move through the rest, and
    // only reach `sent` when the provider confirmed it, never when Arkitech
    // merely queued it.
    status: varchar("status", { length: 12 }).notNull(),

    // Why a send failed, in words safe to show. Never a provider payload.
    error: text("error"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  table => [
    index("message_conversation").on(table.conversationId, table.createdAt),
    index("message_owner").on(table.userEmail, table.createdAt),
  ],
);


/**
 * Durable deduplication of inbound provider events.
 *
 * Both providers retry. Telegram re-delivers an update whose webhook did not
 * answer in time, and Slack retries up to three times on a missed 3-second
 * acknowledgement, so one event can arrive four times. Processing it twice
 * would run the Agent twice, spend two Usage Credits and send two replies.
 *
 * The unique index is the mechanism, not a check. A read-then-write cannot
 * hold this: two retries can arrive concurrently and both find nothing. The
 * insert is attempted first, and a unique violation means "already handled" and
 * ends the request. This is the same shape the Credit Ledger uses for its
 * idempotency key, and for the same reason: the neon-http driver has no
 * transactions, so a single statement is the only atomic unit available.
 */
export const channelInboundEvent = pgTable(
  "channelInboundEvent",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    connectionId: uuid("connection_id").notNull(),
    provider: varchar("provider", { length: 20 }).notNull(),

    // Telegram's update_id, or Slack's event_id. Opaque here.
    externalEventId: varchar("external_event_id", { length: 200 }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex("channel_inbound_event_key").on(
      table.connectionId,
      table.provider,
      table.externalEventId,
    ),
    // Lets old rows be swept without scanning the table.
    index("channel_inbound_event_age").on(table.createdAt),
  ],
);


/**
 * A single-use code that binds an external chat to an Arkitech account.
 *
 * This is what makes a public bot safe. Arkitech issues a code to a signed-in
 * user, the user carries it into Telegram as `/start <code>`, and the first
 * valid presentation links that chat and burns the code. Someone who finds the
 * bot without a code gets a polite refusal and reaches nothing.
 *
 * The code is stored hashed. A leaked database row should not hand someone a
 * working link code, and Arkitech never needs to display it again after issue.
 */
export const channelLinkCode = pgTable(
  "channelLinkCode",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    connectionId: uuid("connection_id").notNull(),
    userEmail: text("email").notNull(),

    // sha256 of the issued code. The code itself is shown once and not kept.
    codeHash: varchar("code_hash", { length: 100 }).notNull(),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    // Set when redeemed. The unique index below plus this column is what makes
    // redemption single-use under concurrency.
    usedAt: timestamp("used_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex("channel_link_code_hash").on(table.codeHash),
    index("channel_link_code_connection").on(table.connectionId),
  ],
);


export type ChannelConnection = typeof channelConnection.$inferSelect;
export type Conversation = typeof conversation.$inferSelect;
export type ChannelThread = typeof channelThread.$inferSelect;
export type Message = typeof message.$inferSelect;
export type ChannelInboundEvent = typeof channelInboundEvent.$inferSelect;
export type ChannelLinkCode = typeof channelLinkCode.$inferSelect;
