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
  createdAt: timestamp("created_at").defaultNow().notNull(),
})

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

    status: varchar("status")
      .default("scheduled")
      .notNull(),

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


export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
