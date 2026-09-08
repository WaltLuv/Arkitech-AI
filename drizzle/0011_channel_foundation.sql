CREATE TABLE "channelConnection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"provider" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'pending_link' NOT NULL,
	"defaultAgentId" varchar,
	"external_account_id" varchar(120) NOT NULL,
	"external_account_label" varchar(200),
	"secret" text,
	"authorized_external_user_id" varchar(120),
	"status_reason" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channelInboundEvent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider" varchar(20) NOT NULL,
	"external_event_id" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channelLinkCode" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"email" text NOT NULL,
	"code_hash" varchar(100) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channelThread" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"email" text NOT NULL,
	"provider" varchar(20) NOT NULL,
	"external_chat_id" varchar(120) NOT NULL,
	"external_user_id" varchar(120),
	"chat_kind" varchar(20) DEFAULT 'private' NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"agentId" varchar NOT NULL,
	"channel" varchar(20) NOT NULL,
	"connection_id" uuid,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"email" text NOT NULL,
	"direction" varchar(10) NOT NULL,
	"sender_kind" varchar(10) NOT NULL,
	"body" text,
	"reply_to_id" uuid,
	"runId" uuid,
	"external_message_id" varchar(120),
	"status" varchar(12) NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "channel_connection_account" ON "channelConnection" USING btree ("provider","external_account_id");--> statement-breakpoint
CREATE INDEX "channel_connection_owner" ON "channelConnection" USING btree ("email","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_inbound_event_key" ON "channelInboundEvent" USING btree ("connection_id","provider","external_event_id");--> statement-breakpoint
CREATE INDEX "channel_inbound_event_age" ON "channelInboundEvent" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_link_code_hash" ON "channelLinkCode" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "channel_link_code_connection" ON "channelLinkCode" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_thread_external_chat" ON "channelThread" USING btree ("connection_id","external_chat_id");--> statement-breakpoint
CREATE INDEX "channel_thread_owner" ON "channelThread" USING btree ("email");--> statement-breakpoint
CREATE INDEX "conversation_owner" ON "conversation" USING btree ("email","last_message_at");--> statement-breakpoint
CREATE INDEX "conversation_agent" ON "conversation" USING btree ("agentId","last_message_at");--> statement-breakpoint
CREATE INDEX "message_conversation" ON "message" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "message_owner" ON "message" USING btree ("email","created_at");