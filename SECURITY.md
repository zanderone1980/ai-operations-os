# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | ✅ Current |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email **alex@zanderpinkdesign.com** with:

1. Description of the vulnerability
2. Steps to reproduce
3. Affected versions
4. Impact assessment (if known)

You will receive an acknowledgment within **48 hours** and a detailed response within **5 business days**.

## Disclosure Policy

- We follow [coordinated disclosure](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure).
- After a fix is released, we will publish a GitHub Security Advisory.
- Credit will be given to reporters unless they request otherwise.

## Security Architecture

AI Operations OS enforces safety at multiple layers:

| Layer | Mechanism | Description |
|-------|-----------|-------------|
| **Policy Engine** | `@ai-operations/ops-policy` | Owner-defined rules controlling what runs autonomously vs. requires approval |
| **CORD Safety Gate** | `@ai-operations/cord-adapter` → `cord-engine` | Constitutional AI scoring on every proposed action (0–99 risk score) |
| **Approval Gate** | Human-in-the-loop | Write operations require explicit user approval before execution |
| **Signed Receipts** | SHA-256 + HMAC-SHA256 | Every executed action produces a cryptographically signed, hash-chained receipt |
| **Credential Isolation** | `~/.ai-ops/credentials.json` | OAuth tokens stored with `0o600` permissions, never committed to repos |

## Dependency Policy

- **Zero runtime dependencies** in the API server (Node.js built-in `http` module only)
- `better-sqlite3` is the only native dependency (storage layer)
- `cord-engine` and `codebot-ai` are optional peer dependencies — the system degrades gracefully without them

## Supply Chain

- All packages are built from source with TypeScript strict mode
- No pre-built binaries shipped (except `better-sqlite3` which uses prebuildify)
- Turborepo build pipeline with deterministic output
