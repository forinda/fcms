CREATE TABLE "flow_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"site_id" text NOT NULL,
	"org_id" text NOT NULL,
	"page_key" text NOT NULL,
	"flow_key" text NOT NULL,
	"token_hash" text NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "flow_sessions" ADD CONSTRAINT "flow_sessions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "flow_sessions_token" ON "flow_sessions" USING btree ("token_hash","page_key","flow_key");--> statement-breakpoint
CREATE INDEX "flow_sessions_expiry" ON "flow_sessions" USING btree ("expires_at");