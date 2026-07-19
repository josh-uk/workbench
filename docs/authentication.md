# Authentication and request outputs

Authentication profiles live at workspace or project scope. A project can use
its own profiles, inherit workspace profiles, and save field-level configuration
overrides without changing the shared profile. The request editor lists every
profile available to its project.

## Supported profiles

- No authentication
- Bearer token
- Basic authentication
- API key in a header or query parameter
- OAuth 2.0 client credentials
- OAuth 2.0 password grant
- OAuth 2.0 refresh-token grant
- Request-derived authentication backed by a saved request output

Profile fields support the same `{{variable}}` interpolation as requests. Direct
OAuth profiles accept a token URL, client credentials, scope, audience, token
response JSONPaths, injection target, and failure behavior. OAuth token endpoints
run through the normal protocol, DNS, redirect, private-network, metadata,
timeout, TLS, and response-size controls.

![OAuth client credentials profile](images/phase-10-oauth-client-credentials.png)

![Authentication profiles](images/phase-10-authentication.png)

## Azure Key Vault credential sources

The following secret-bearing fields can use either **Stored in Workbench** or
**Azure Key Vault**:

| Profile                    | Supported Key Vault fields      |
| -------------------------- | ------------------------------- |
| Bearer token               | Token                           |
| Basic authentication       | Password                        |
| API key in header or query | Key value                       |
| OAuth client credentials   | Client secret                   |
| OAuth password             | Client secret and password      |
| OAuth refresh token        | Client secret and refresh token |

Request-derived authentication does not need a Key Vault source because it
receives its value from a saved request output.

### Connect Azure

Open **Authentication profiles**, find **Azure connection**, and select
**Connect Azure**. An optional tenant ID or verified tenant domain narrows the
sign-in. Workbench starts Azure CLI's device-code flow inside its container and
shows the temporary Microsoft code and verification link in a modal. Complete
Microsoft sign-in and MFA in the new browser tab; no terminal command or custom
Entra application registration is required.

The connected user must already have Key Vault data-plane access. The
least-privilege built-in role is normally **Key Vault Secrets User** at the
individual vault scope. Workbench does not grant roles, change IAM, enumerate
vaults, or manage secrets.

The first version supports one connected Azure user per Workbench installation.
Select **Disconnect** before changing accounts. Azure CLI state is kept in the
dedicated `workbench_azure_cli` Docker volume and survives ordinary container
recreation. It is not stored in PostgreSQL or included in Workbench backups.

### Configure a reference

Choose **Azure Key Vault** from a supported field's Source menu, then enter:

- the exact vault URL, such as `https://my-vault.vault.azure.net/`;
- the secret name; and
- optionally, the 32-character secret version.

Select **Test reference** to verify access without displaying the value. If the
version is blank, every execution resolves the latest version. This is the
recommended setting for automatic secret rotation. If the latest version is
disabled, the request fails rather than requiring permission to enumerate older
versions. Supplying a version keeps the profile pinned until the reference is
edited.

Only public Azure Key Vault hostnames ending in `.vault.azure.net` are accepted
in v1.1.0. The hostname may resolve through a private endpoint, but the
Workbench container must have the required DNS and network route. Sovereign
Azure clouds are not yet supported.

Key Vault values are requested only when needed. In particular, a fresh cached
OAuth access token is reused without contacting Key Vault; the referenced
credential is resolved immediately before the next OAuth token request.

### Troubleshooting and decommissioning

- **Azure CLI unavailable:** use the supplied Docker Compose image; local
  `npm run dev` does not bundle Azure CLI.
- **Permission denied:** confirm the signed-in user has **Key Vault Secrets
  User** (or equivalent `secrets/get` data-plane access) on that vault.
- **Vault unreachable:** confirm the container can resolve and route to the
  vault hostname, including private-endpoint DNS when used.
- **Latest secret disabled or expired:** enable a usable latest version or pin
  the exact active 32-character version in the profile.

Disconnecting in the UI removes the active account but retains the empty Azure
CLI configuration volume. To fully remove all persisted Azure session state,
stop Workbench and delete only that dedicated volume:

```sh
docker compose down
docker volume rm workbench_azure_cli
```

The second command is intentionally destructive for Azure CLI session state;
it does not remove the PostgreSQL or backup volumes.

![Azure Key Vault credential source](images/phase-12-azure-key-vault.png)

## Token lifecycle

Workbench keeps one server-side cache entry per OAuth profile. It reuses a token
until 30 seconds before its expiry. On expiry it uses the cached or configured
refresh token when available; otherwise it repeats the configured grant. Editing
a profile or project override clears the relevant cache. Token values never enter
the browser DTO, execution snapshot, response history, or application log.

A request-derived profile identifies a saved token request and one of that
request's named outputs. Before a dependent request runs, Workbench:

1. checks for the newest unexpired output;
2. executes the token request through the same server-side engine when needed;
3. extracts and stores its outputs;
4. injects the selected output into a header or query parameter; and
5. records only the profile, source, target, and a masked credential in history.

Dependency cycles fail before another socket is opened. The default failure mode
stops the dependent request; a profile can explicitly continue without
authentication instead.

## General request outputs

The Outputs tab publishes named values from a successful JSON response. Each
definition contains a name, JSONPath, optional JSONPath containing lifetime in
seconds, and a secret flag. Supported JSONPath forms include root (`$`), property
access, quoted bracket properties, array indexes, and wildcards.

The newest unexpired output with a given name becomes a generated variable for
later requests in the same project. It resolves between environment/project
values and request/runtime values. This supports entity IDs, CSRF tokens,
pagination cursors, session values, and OAuth tokens without an
authentication-specific data path.

Secret output values are masked in the output viewer and redacted from response
body previews and headers before persistence. Output definitions and profile
references are deep-copied with requests, projects, and workspaces; live token
caches and historical output values are deliberately not copied.

## Trust boundary

Reusable credentials and tokens are stored in local PostgreSQL so they can be
used by the server. Database access is therefore inside the trusted local
boundary. Workbench does not claim operating-system keychain or at-rest database
encryption; protect the host and database and do not expose them to untrusted
networks.

Azure changes the storage boundary for referenced profile fields: the secret
value remains in Key Vault and exists in Workbench memory only for the active
request or OAuth exchange. The browser receives the temporary device code and
sanitized account/status metadata, never Azure access tokens, refresh tokens,
CLI output, or resolved Key Vault values. Removing the `workbench_azure_cli`
volume after stopping Compose fully removes the persisted Azure CLI session.
