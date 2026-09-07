CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"spec_version" integer DEFAULT 1 NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_specs" (
	"site_id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"document" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spec_patches" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"org_id" text NOT NULL,
	"seq" integer NOT NULL,
	"actor" text NOT NULL,
	"source" text NOT NULL,
	"harness" text,
	"ops" jsonb NOT NULL,
	"inverse" jsonb NOT NULL,
	"classification" text NOT NULL,
	"summary" text NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reverted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "entries" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"org_id" text NOT NULL,
	"type_key" text NOT NULL,
	"slug" text,
	"data" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"site_id" text,
	"blob_hash" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"alt" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owner_sessions" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"owner_id" char(26) NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" text,
	"ip_address" text
);
--> statement-breakpoint
CREATE TABLE "owners" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_specs" ADD CONSTRAINT "site_specs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_patches" ADD CONSTRAINT "spec_patches_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_sessions" ADD CONSTRAINT "owner_sessions_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owners" ADD CONSTRAINT "owners_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sites_org_slug" ON "sites" USING btree ("org_id","slug");--> statement-breakpoint
CREATE INDEX "sites_domain" ON "sites" USING btree ("domain");--> statement-breakpoint
CREATE UNIQUE INDEX "spec_patches_site_seq" ON "spec_patches" USING btree ("site_id","seq");--> statement-breakpoint
CREATE INDEX "spec_patches_site_applied" ON "spec_patches" USING btree ("site_id","applied_at");--> statement-breakpoint
CREATE UNIQUE INDEX "entries_site_type_slug" ON "entries" USING btree ("site_id","type_key","slug");--> statement-breakpoint
CREATE INDEX "entries_site_type" ON "entries" USING btree ("site_id","type_key");--> statement-breakpoint
CREATE INDEX "entries_data_gin" ON "entries" USING gin ("data");--> statement-breakpoint
CREATE INDEX "entries_site_type_status" ON "entries" USING btree ("site_id","type_key","status");--> statement-breakpoint
CREATE INDEX "assets_org" ON "assets" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "assets_blob" ON "assets" USING btree ("blob_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "owner_sessions_token" ON "owner_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "owner_sessions_owner" ON "owner_sessions" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "owners_email" ON "owners" USING btree ("email");