CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"site_id" text NOT NULL,
	"org_id" text NOT NULL,
	"entry_id" uuid NOT NULL,
	"type_key" text NOT NULL,
	"via" text NOT NULL,
	"provider" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reference" text,
	"payer_ref" text,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_site_provider_reference" ON "payments" USING btree ("site_id","provider","reference");--> statement-breakpoint
CREATE INDEX "payments_site_status" ON "payments" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "payments_entry" ON "payments" USING btree ("entry_id");