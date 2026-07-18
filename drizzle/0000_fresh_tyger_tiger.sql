CREATE TYPE "public"."assertion_type" AS ENUM('status_equals', 'status_range', 'duration_below', 'header_exists', 'header_equals', 'jsonpath_exists', 'jsonpath_equals', 'jsonpath_regex', 'body_contains', 'body_schema');--> statement-breakpoint
CREATE TYPE "public"."auth_type" AS ENUM('none', 'bearer', 'basic', 'api_key_header', 'api_key_query', 'oauth2_client_credentials', 'oauth2_password', 'oauth2_refresh_token', 'request_derived');--> statement-breakpoint
CREATE TYPE "public"."execution_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."http_method" AS ENUM('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS');--> statement-breakpoint
CREATE TYPE "public"."import_format" AS ENUM('openapi_json', 'openapi_yaml', 'httpie', 'postman', 'curl', 'raw_http');--> statement-breakpoint
CREATE TYPE "public"."import_run_status" AS ENUM('previewed', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."import_source_type" AS ENUM('file', 'paste', 'url');--> statement-breakpoint
CREATE TYPE "public"."request_body_type" AS ENUM('none', 'json', 'text', 'xml', 'form_urlencoded', 'multipart', 'binary');--> statement-breakpoint
CREATE TYPE "public"."variable_scope" AS ENUM('workspace', 'workspace_environment', 'project', 'project_environment', 'request');--> statement-breakpoint
CREATE TYPE "public"."workflow_failure_mode" AS ENUM('stop', 'continue');--> statement-breakpoint
CREATE TABLE "auth_profile_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_profile_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"project_id" uuid,
	"token_request_id" uuid,
	"name" text NOT NULL,
	"type" "auth_type" DEFAULT 'none' NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_profiles_name_not_blank" CHECK (length(trim("auth_profiles"."name")) > 0),
	CONSTRAINT "auth_profiles_one_owner" CHECK (num_nonnulls("auth_profiles"."workspace_id", "auth_profiles"."project_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "environments_name_not_blank" CHECK (length(trim("environments"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "variables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"project_id" uuid,
	"environment_id" uuid,
	"request_id" uuid,
	"scope" "variable_scope" NOT NULL,
	"name" text NOT NULL,
	"value" text DEFAULT '' NOT NULL,
	"secret" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "variables_name_not_blank" CHECK (length(trim("variables"."name")) > 0),
	CONSTRAINT "variables_has_owner" CHECK (num_nonnulls("variables"."workspace_id", "variables"."project_id", "variables"."environment_id", "variables"."request_id") > 0)
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "folders_name_not_blank" CHECK (length(trim("folders"."name")) > 0),
	CONSTRAINT "folders_not_self_parent" CHECK ("folders"."parent_id" is distinct from "folders"."id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_name_not_blank" CHECK (length(trim("projects"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_name_not_blank" CHECK (length(trim("workspaces"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "request_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"request_id" uuid,
	"status" "execution_status" DEFAULT 'pending' NOT NULL,
	"method" text NOT NULL,
	"resolved_url" text NOT NULL,
	"request_snapshot" jsonb NOT NULL,
	"error" jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "response_metadata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" uuid NOT NULL,
	"status_code" integer,
	"status_text" text,
	"duration_ms" integer,
	"size_bytes" bigint,
	"headers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cookies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"redirects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"body_preview" text,
	"body_truncated" boolean DEFAULT false NOT NULL,
	"content_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runtime_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"definition_id" uuid NOT NULL,
	"execution_id" uuid NOT NULL,
	"value" text NOT NULL,
	"secret" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"definition_id" uuid,
	"project_id" uuid NOT NULL,
	"format" "import_format" NOT NULL,
	"status" "import_run_status" NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imported_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"format" "import_format" NOT NULL,
	"source_type" "import_source_type" NOT NULL,
	"source_url" text,
	"original_document" text NOT NULL,
	"version" text,
	"title" text,
	"api_version" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imported_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"definition_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"operation_id" text,
	"summary" text,
	"tags" text[],
	"operation" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_bodies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"type" "request_body_type" DEFAULT 'none' NOT NULL,
	"content" text,
	"content_type" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_headers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"name" text NOT NULL,
	"value" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"secret" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_output_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"name" text NOT NULL,
	"json_path" text NOT NULL,
	"secret" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_query_parameters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"name" text NOT NULL,
	"value" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"folder_id" uuid,
	"auth_profile_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"method" "http_method" DEFAULT 'GET' NOT NULL,
	"url" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_requests_name_not_blank" CHECK (length(trim("saved_requests"."name")) > 0),
	CONSTRAINT "saved_requests_url_not_blank" CHECK (length(trim("saved_requests"."url")) > 0)
);
--> statement-breakpoint
CREATE TABLE "application_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assertions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid,
	"workflow_step_id" uuid,
	"type" "assertion_type" NOT NULL,
	"configuration" jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assertions_one_owner" CHECK (num_nonnulls("assertions"."request_id", "assertions"."workflow_step_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "workflow_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"name" text,
	"position" integer NOT NULL,
	"failure_mode" "workflow_failure_mode" DEFAULT 'stop' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"runtime_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflows_name_not_blank" CHECK (length(trim("workflows"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "auth_profile_overrides" ADD CONSTRAINT "auth_profile_overrides_auth_profile_id_auth_profiles_id_fk" FOREIGN KEY ("auth_profile_id") REFERENCES "public"."auth_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_profile_overrides" ADD CONSTRAINT "auth_profile_overrides_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_profiles" ADD CONSTRAINT "auth_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_profiles" ADD CONSTRAINT "auth_profiles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_profiles" ADD CONSTRAINT "auth_profiles_token_request_id_saved_requests_id_fk" FOREIGN KEY ("token_request_id") REFERENCES "public"."saved_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variables" ADD CONSTRAINT "variables_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variables" ADD CONSTRAINT "variables_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variables" ADD CONSTRAINT "variables_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variables" ADD CONSTRAINT "variables_request_id_saved_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."saved_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_parent_id_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_executions" ADD CONSTRAINT "request_executions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_executions" ADD CONSTRAINT "request_executions_request_id_saved_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."saved_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_metadata" ADD CONSTRAINT "response_metadata_execution_id_request_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."request_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_outputs" ADD CONSTRAINT "runtime_outputs_definition_id_request_output_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."request_output_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_outputs" ADD CONSTRAINT "runtime_outputs_execution_id_request_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."request_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_definition_id_imported_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."imported_definitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imported_definitions" ADD CONSTRAINT "imported_definitions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imported_operations" ADD CONSTRAINT "imported_operations_definition_id_imported_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."imported_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_bodies" ADD CONSTRAINT "request_bodies_request_id_saved_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."saved_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_headers" ADD CONSTRAINT "request_headers_request_id_saved_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."saved_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_output_definitions" ADD CONSTRAINT "request_output_definitions_request_id_saved_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."saved_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_query_parameters" ADD CONSTRAINT "request_query_parameters_request_id_saved_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."saved_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_requests" ADD CONSTRAINT "saved_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_requests" ADD CONSTRAINT "saved_requests_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assertions" ADD CONSTRAINT "assertions_request_id_saved_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."saved_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assertions" ADD CONSTRAINT "assertions_workflow_step_id_workflow_steps_id_fk" FOREIGN KEY ("workflow_step_id") REFERENCES "public"."workflow_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_request_id_saved_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."saved_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_profile_overrides_profile_project_unique" ON "auth_profile_overrides" USING btree ("auth_profile_id","project_id");--> statement-breakpoint
CREATE INDEX "auth_profiles_workspace_project_idx" ON "auth_profiles" USING btree ("workspace_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "environments_workspace_project_name_unique" ON "environments" USING btree ("workspace_id","project_id","name");--> statement-breakpoint
CREATE INDEX "environments_workspace_project_idx" ON "environments" USING btree ("workspace_id","project_id");--> statement-breakpoint
CREATE INDEX "variables_resolution_idx" ON "variables" USING btree ("workspace_id","project_id","environment_id","request_id","name");--> statement-breakpoint
CREATE INDEX "folders_project_parent_position_idx" ON "folders" USING btree ("project_id","parent_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_workspace_name_unique" ON "projects" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "projects_workspace_position_idx" ON "projects" USING btree ("workspace_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_name_unique" ON "workspaces" USING btree ("name");--> statement-breakpoint
CREATE INDEX "request_executions_project_created_idx" ON "request_executions" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "request_executions_request_created_idx" ON "request_executions" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "response_metadata_execution_unique" ON "response_metadata" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "runtime_outputs_definition_created_idx" ON "runtime_outputs" USING btree ("definition_id","created_at");--> statement-breakpoint
CREATE INDEX "import_runs_project_created_idx" ON "import_runs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "imported_definitions_project_idx" ON "imported_definitions" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "imported_operations_definition_source_unique" ON "imported_operations" USING btree ("definition_id","source_key");--> statement-breakpoint
CREATE UNIQUE INDEX "request_bodies_request_unique" ON "request_bodies" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "request_headers_request_position_idx" ON "request_headers" USING btree ("request_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "request_outputs_request_name_unique" ON "request_output_definitions" USING btree ("request_id","name");--> statement-breakpoint
CREATE INDEX "request_outputs_request_position_idx" ON "request_output_definitions" USING btree ("request_id","position");--> statement-breakpoint
CREATE INDEX "request_query_parameters_request_position_idx" ON "request_query_parameters" USING btree ("request_id","position");--> statement-breakpoint
CREATE INDEX "saved_requests_project_folder_position_idx" ON "saved_requests" USING btree ("project_id","folder_id","position");--> statement-breakpoint
CREATE INDEX "saved_requests_name_idx" ON "saved_requests" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "application_settings_key_unique" ON "application_settings" USING btree ("key");--> statement-breakpoint
CREATE INDEX "assertions_request_position_idx" ON "assertions" USING btree ("request_id","position");--> statement-breakpoint
CREATE INDEX "assertions_workflow_step_position_idx" ON "assertions" USING btree ("workflow_step_id","position");--> statement-breakpoint
CREATE INDEX "workflow_steps_workflow_position_idx" ON "workflow_steps" USING btree ("workflow_id","position");--> statement-breakpoint
CREATE INDEX "workflows_project_idx" ON "workflows" USING btree ("project_id");