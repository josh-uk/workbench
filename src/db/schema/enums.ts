import { pgEnum } from "drizzle-orm/pg-core";

export const httpMethodEnum = pgEnum("http_method", [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

export const requestBodyTypeEnum = pgEnum("request_body_type", [
  "none",
  "json",
  "text",
  "xml",
  "form_urlencoded",
  "multipart",
  "binary",
]);

export const variableScopeEnum = pgEnum("variable_scope", [
  "workspace",
  "workspace_environment",
  "project",
  "project_environment",
  "request",
]);

export const authTypeEnum = pgEnum("auth_type", [
  "none",
  "bearer",
  "basic",
  "api_key_header",
  "api_key_query",
  "oauth2_client_credentials",
  "oauth2_password",
  "oauth2_refresh_token",
  "request_derived",
]);

export const importSourceTypeEnum = pgEnum("import_source_type", [
  "file",
  "paste",
  "url",
]);

export const importFormatEnum = pgEnum("import_format", [
  "openapi_json",
  "openapi_yaml",
  "httpie",
  "postman",
  "curl",
  "raw_http",
]);

export const importRunStatusEnum = pgEnum("import_run_status", [
  "previewed",
  "completed",
  "failed",
]);

export const workflowFailureModeEnum = pgEnum("workflow_failure_mode", [
  "stop",
  "continue",
]);

export const assertionTypeEnum = pgEnum("assertion_type", [
  "status_equals",
  "status_range",
  "duration_below",
  "header_exists",
  "header_equals",
  "jsonpath_exists",
  "jsonpath_equals",
  "jsonpath_regex",
  "body_contains",
  "body_schema",
]);

export const executionStatusEnum = pgEnum("execution_status", [
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
