CREATE TABLE "workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid,
	"project_id" uuid NOT NULL,
	"workflow_name" text NOT NULL,
	"status" "execution_status" DEFAULT 'pending' NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_step_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_run_id" uuid NOT NULL,
	"workflow_step_id" uuid,
	"request_id" uuid,
	"request_execution_id" uuid,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"status" "execution_status" DEFAULT 'pending' NOT NULL,
	"failure_mode" "workflow_failure_mode" NOT NULL,
	"assertion_results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"output_names" text[] DEFAULT '{}'::text[] NOT NULL,
	"error" jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_steps" ALTER COLUMN "runtime_overrides" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "request_executions" ADD COLUMN "assertion_results" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "request_executions" ADD COLUMN "assertions_passed" boolean;--> statement-breakpoint
ALTER TABLE "assertions" ADD COLUMN "name" text DEFAULT 'Assertion' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_step_runs" ADD CONSTRAINT "workflow_step_runs_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_step_runs" ADD CONSTRAINT "workflow_step_runs_workflow_step_id_workflow_steps_id_fk" FOREIGN KEY ("workflow_step_id") REFERENCES "public"."workflow_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_step_runs" ADD CONSTRAINT "workflow_step_runs_request_id_saved_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."saved_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_step_runs" ADD CONSTRAINT "workflow_step_runs_request_execution_id_request_executions_id_fk" FOREIGN KEY ("request_execution_id") REFERENCES "public"."request_executions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_runs_project_created_idx" ON "workflow_runs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "workflow_runs_workflow_created_idx" ON "workflow_runs" USING btree ("workflow_id","created_at");--> statement-breakpoint
CREATE INDEX "workflow_step_runs_run_position_idx" ON "workflow_step_runs" USING btree ("workflow_run_id","position");--> statement-breakpoint
CREATE INDEX "workflow_step_runs_execution_idx" ON "workflow_step_runs" USING btree ("request_execution_id");