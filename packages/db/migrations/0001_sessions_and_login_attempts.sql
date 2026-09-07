CREATE TABLE "login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"ip_address" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "owner_sessions" ADD COLUMN "last_used_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "login_attempts_email_at" ON "login_attempts" USING btree ("email","at");--> statement-breakpoint
CREATE INDEX "login_attempts_at" ON "login_attempts" USING btree ("at");