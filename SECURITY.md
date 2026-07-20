# Security Policy

## Supported versions

Security fixes are provided for the latest stable release.

## Reporting

Do not disclose exploitable vulnerabilities in a public issue. Use the
[fork's private vulnerability reporting](https://github.com/kevinski119/local-ngram-code-suggester/security/advisories/new).

## Data and network behavior

- Completion, tokenization, project adaptation, and diagnostics run locally.
- No telemetry, account, or subscription is used.
- The extension performs no network request unless the user explicitly opens
  language-pack management, configures a catalog, or opts into pack updates.
- Imported packs are size-limited, shape-validated, and SHA-256 checked when a
  catalog checksum is available.
- Project context is held in memory and is not uploaded.

Treat third-party models and pack catalogs as untrusted. Use HTTPS catalogs
controlled by the fork maintainer and publish corpus source/license metadata.
