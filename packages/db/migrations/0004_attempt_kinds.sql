DROP INDEX "login_attempts_email_at";--> statement-breakpoint
ALTER TABLE "login_attempts" ADD COLUMN "kind" text DEFAULT 'login' NOT NULL;--> statement-breakpoint
CREATE INDEX "login_attempts_kind_email_at" ON "login_attempts" USING btree ("kind","email","at");