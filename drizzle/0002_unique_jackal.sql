ALTER TABLE "import_runs" ADD COLUMN "source_document" text;--> statement-breakpoint
ALTER TABLE "import_runs" ADD COLUMN "source_hash" text;--> statement-breakpoint
ALTER TABLE "import_runs" ADD COLUMN "changes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "imported_definitions" ADD COLUMN "source_hash" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "imported_operations" ADD COLUMN "operation_hash" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "imported_operations" ADD COLUMN "request_id" uuid;--> statement-breakpoint
ALTER TABLE "imported_operations" ADD COLUMN "generated_request_hash" text;--> statement-breakpoint
ALTER TABLE "imported_operations" ADD COLUMN "customized" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "imported_operations" ADD CONSTRAINT "imported_operations_request_id_saved_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."saved_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "imported_operations_request_unique" ON "imported_operations" USING btree ("request_id");