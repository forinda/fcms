CREATE TABLE "workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"site_id" text NOT NULL,
	"org_id" text NOT NULL,
	"workflow_key" text NOT NULL,
	"trigger" text NOT NULL,
	"entry_id" text,
	"dedupe" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_runs_dedupe" ON "workflow_runs" USING btree ("site_id","workflow_key","dedupe");--> statement-breakpoint
CREATE INDEX "workflow_runs_due" ON "workflow_runs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "workflow_runs_site_created" ON "workflow_runs" USING btree ("site_id","created_at");