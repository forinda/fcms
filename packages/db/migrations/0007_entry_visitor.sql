ALTER TABLE "entries" ADD COLUMN "visitor_id" uuid;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_visitor_id_visitors_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "public"."visitors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entries_visitor" ON "entries" USING btree ("site_id","visitor_id");