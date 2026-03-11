# Changelog

All notable changes to AI Operations OS will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-03-09

### Added

**Architecture**
- 6-layer pipeline: Inbox → Intent → Policy → Workflow → Safety → Receipts
- 12-package Turborepo monorepo with npm workspaces
- Zero runtime dependencies in API server (Node.js built-in http module)
- TypeScript strict mode throughout

**Connectors**
- Gmail connector (read, reply, draft, send)
- Google Calendar connector (list, create, update, check availability)
- X/Twitter connector (timeline, post, reply, DM)
- Shopify connector (orders, products, customers, fulfill, refund)
- Resilient fetch with exponential backoff and rate limiting

**Pipeline Engine**
- Keyword-based intent classifier with LLM fallback (Anthropic, OpenAI, Ollama)
- Rule engine with configurable policy evaluation
- CORD safety gate — 14-dimension constitutional AI scoring, <1ms local evaluation
- Hash-chained HMAC-signed audit receipts (SHA-256 + HMAC-SHA256)
- SSE streaming for real-time pipeline execution

**API**
- 45 REST endpoints across tasks, workflows, approvals, pipeline, connectors, OAuth
- Multi-user authentication (dev mode, single-user API key, multi-user aops_ keys)
- Role-based access control (admin, operator, viewer)
- Google OAuth 2.0 flow for Gmail/Calendar
- Webhook receivers for Gmail, Calendar, Shopify, Stripe, generic

**Dashboard**
- Web dashboard with dark mode
- Approval inbox with approve/deny actions
- Task list with search, filter, and creation form
- Workflow visualization with step status
- Activity feed / audit log
- Real-time SSE sync
- Connector status indicators

**Infrastructure**
- Docker multi-stage build with non-root user
- docker-compose with health checks and persistent volumes
- OpenAPI 3.1 specification (40 endpoints, 20 schemas)
- SQLite with WAL mode for persistence
- GitHub Actions CI (ubuntu + macOS, Node 18/20/22)

**Testing**
- 692 tests across 35 test suites (7 packages with test coverage)
- Integration tests for all API routes
- Unit tests for intent classifier, policy engine, connectors, storage, schemas
- SPARK engine tests: predictor, learning core, weight manager, awareness, memory consolidation

### Known Limitations

- Single-node SQLite only (PostgreSQL planned for v0.2)
- No webhook signature verification yet
- Dashboard is vanilla JS (framework migration planned)
- No distributed tracing / correlation IDs yet

## [0.2.0] - 2026-03-10

### Added

**SPARK Spiral Memory**
- 5-layer essence-based memory architecture: EssenceExtractor, MemoryTokenManager, SpiralLoop, ContextReconstructor, FeedbackIntegrator
- Algorithmic text → essence compression (TF-IDF topics, lexicon-based sentiment, pattern-matched relationships, decision point extraction)
- Spiral reinforcement/weakening with passive decay — patterns that prove true get stronger, patterns that don't get weaker
- Graph-walk context reconstruction replaces linear turn loading
- Tiered token lifecycle: raw → recent → compressed → archival
- 7 new API endpoints under `/api/spark/memory/`
- 30+ new spiral memory tests

**CORD Reasoning Layer**
- Full CORD safety reasoning integration — 14-dimension scoring with explanation text
- CORD score display in pipeline events

**Publishing**
- `@ai-operations/spark-engine` published to npm
- `@ai-operations/cord-adapter` published to npm

### Changed
- Test count increased from 692 to 742 across 7 test suites
- README updated with SPARK architecture documentation and demo SVG
- Project structure documented as 12 packages (3 apps, 9 libraries)

## [Unreleased]

### Planned

- Quickstart demo mode (`npm run demo`)
- Dashboard approval polish (CORD score display, approval history, pending badge)
- SPARK diagnose and compare intents
- Slack and Notion connectors
- Auth + encrypted credential storage (JWT, scrypt, AES-256-GCM vault)
