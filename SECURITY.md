# Security policy

## Reporting a vulnerability

Use a private GitHub security advisory for `josh-uk/workbench`. Do not open a
public issue and do not include real credentials or private request data in a
report.

Include a minimal reproduction, affected version or commit, impact assessment,
and any suggested mitigation. The repository owner will acknowledge the report,
triage the impact, and coordinate remediation and disclosure.

## Supported versions

Until the first stable release, only the latest commit on `master` is supported.
After `v1.0.0`, the support window will be documented in release notes.

## Scope

Workbench is intended to run on a trusted local machine or private development
network. This trust model does not remove the need for SSRF controls, safe secret
handling, import validation, and browser sandboxing. See
[docs/security.md](docs/security.md) for the full model.
