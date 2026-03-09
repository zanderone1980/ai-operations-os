# Contributing to AI Operations OS

Thanks for your interest in contributing! This project is in active early development.

## Getting Started

```bash
git clone https://github.com/zanderone1980/ai-operations-os.git
cd ai-operations-os
npm install
npm run build
```

## Development

```bash
# Build all packages
npm run build

# Start the API server
node apps/ops-api/dist/server.js

# Run the demo
node scripts/demo.js
```

## Project Structure

| Package | Purpose |
|---------|---------|
| `packages/shared-types` | Core TypeScript interfaces |
| `packages/ops-core` | Workflow engine + intent classification |
| `packages/ops-policy` | Policy rules + autonomy levels |
| `packages/ops-connectors` | Gmail, Calendar, X, Shopify connectors |
| `packages/cord-adapter` | CORD safety gate bridge |
| `packages/codebot-adapter` | CodeBot execution bridge |
| `packages/ops-storage` | SQLite persistence layer |
| `apps/ops-api` | HTTP/SSE API server |
| `apps/ops-worker` | Pipeline engine + background processor |
| `apps/ops-web` | Approval dashboard UI |

## How to Contribute

1. **Bug reports** — Use the [bug report template](https://github.com/zanderone1980/ai-operations-os/issues/new?template=bug_report.md)
2. **Feature requests** — Use the [feature request template](https://github.com/zanderone1980/ai-operations-os/issues/new?template=feature_request.md)
3. **Code** — Fork, branch, PR. All PRs run CI automatically.
4. **Docs** — Improvements to README, guides, or inline docs are always welcome.

## Code Style

- TypeScript strict mode
- No runtime dependencies in core packages
- All public APIs must have JSDoc comments
- Tests required for new features

## Security

If you find a security vulnerability, **do not open a public issue**. See [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
