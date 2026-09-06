/**
 * Drizzle table definitions and inferred types for users, tools, agent configs, and agent runs.
 */
import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name"),
  email: text("email").notNull().unique(),
  agentCredits: integer('agentCredits').default(3),
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
  // Which Agent Slot this Agent occupies, 0-based. The unique index below is
  // what actually caps a user at AGENT_SLOT_QUOTA agents: locks cannot, because
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


export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type CreditLedgerEntry = typeof creditLedger.$inferSelect;
export type NewCreditLedgerEntry = typeof creditLedger.$inferInsert;
export type BrowserRun = typeof browserRun.$inferSelect;
export type BrowserSession = typeof browserSession.$inferSelect;
export type BrowserSlot = typeof browserSlot.$inferSelect;
export type BrowserEvent = typeof browserEvent.$inferSelect;
export type BrowserArtifact = typeof browserArtifact.$inferSelect;
