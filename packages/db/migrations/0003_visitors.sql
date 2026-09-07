CREATE TABLE "visitor_saves" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"visitor_id" uuid NOT NULL,
	"type_key" text NOT NULL,
	"entry_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visitor_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"visitor_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text
);
--> statement-breakpoint
CREATE TABLE "visitors" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"site_id" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "visitor_saves" ADD CONSTRAINT "visitor_saves_visitor_id_visitors_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "public"."visitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_sessions" ADD CONSTRAINT "visitor_sessions_visitor_id_visitors_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "public"."visitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitors" ADD CONSTRAINT "visitors_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "visitor_saves_unique" ON "visitor_saves" USING btree ("visitor_id","entry_id");--> statement-breakpoint
CREATE INDEX "visitor_saves_visitor" ON "visitor_saves" USING btree ("visitor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "visitor_sessions_token" ON "visitor_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "visitor_sessions_visitor" ON "visitor_sessions" USING btree ("visitor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "visitors_site_email" ON "visitors" USING btree ("site_id","email");