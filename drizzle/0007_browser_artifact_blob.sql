-- Idempotent, matching the earlier migrations.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "browserArtifactBlob" (
	"artifact_id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"bytes" bytea NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
