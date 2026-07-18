# HTTPie import

Workbench accepts the versioned JSON format emitted by HTTPie Desktop and a
single HTTPie CLI command. Select **Collection imports**, choose automatic
detection or HTTPie, paste or load the source, and review the preview before
importing.

Desktop mappings include:

- workspace collections as folders and their requests as saved requests
- workspace environments and secret-variable flags
- collection or request Basic, Bearer, API-key, none, and inherited auth
- headers, query parameters, path parameters, and request names
- text/JSON/XML, form-url-encoded, multipart, GraphQL, and file body metadata

Path placeholders such as `:paymentId` and `{paymentId}` become Workbench
`{{paymentId}}` request variables. File bytes are never read from paths embedded
in an export; the preview identifies each file that must be reselected.

CLI imports understand a single `http` or `https` command with a method, URL,
headers, query fields (`==`), string JSON fields (`=`), raw JSON fields (`:=`),
forms/files, Basic or Bearer auth, redirect, TLS verification, timeout, and raw
body options. They do not run the command or expand shell variables. Unknown
options and unsupported authentication appear as warnings.

The preview displays the exact target workspace/project, folders, requests,
environments, variables, authentication profiles, unsupported data, and naming
conflicts. Requests can be selected individually. Environments, project
variables, and auth profiles can be included or omitted, and private/local
request targets require a visible opt-in.

The sanitized fixture at
`src/features/imports/fixtures/httpie-workspace.json` follows the HTTPie 1.0
schema and contains only fake domains and credentials. Unit, integration,
component, and browser tests cover mapping, all conflict strategies,
transactional persistence, source linkage, and execution against a local mock
API.
