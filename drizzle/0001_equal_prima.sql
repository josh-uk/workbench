CREATE TABLE "auth_token_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_profile_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"token_type" text DEFAULT 'Bearer' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "request_output_definitions" ADD COLUMN "expires_in_json_path" text;--> statement-breakpoint
ALTER TABLE "auth_token_cache" ADD CONSTRAINT "auth_token_cache_auth_profile_id_auth_profiles_id_fk" FOREIGN KEY ("auth_profile_id") REFERENCES "public"."auth_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_token_cache" ADD CONSTRAINT "auth_token_cache_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_token_cache_profile_project_unique" ON "auth_token_cache" USING btree ("auth_profile_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_profiles_workspace_name_unique" ON "auth_profiles" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_profiles_project_name_unique" ON "auth_profiles" USING btree ("project_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_outputs_definition_execution_unique" ON "runtime_outputs" USING btree ("definition_id","execution_id");