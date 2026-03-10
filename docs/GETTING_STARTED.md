# Getting Started with AI Operations OS

Get up and running in under 10 minutes.

## Prerequisites

- **Node.js** 18+ (check: `node --version`)
- **npm** 10+ (check: `npm --version`)
- **Git** (check: `git --version`)

## 1. Clone & Install

```bash
git clone https://github.com/zanderone1980/ai-operations-os.git
cd ai-operations-os
npm install
```

## 2. Build

```bash
npm run build
```

This compiles all 10 packages via Turborepo. Takes ~5 seconds.

## 3. Start the Server

```bash
node apps/ops-api/dist/server.js
```

You should see:

```
  AI Operations OS — API Server
  Listening on http://0.0.0.0:3100
  Health: http://localhost:3100/health
  Routes: 45 registered
```

Open **http://localhost:3100** in your browser to see the dashboard.

## 4. Load Demo Data (Optional)

```bash
npm run seed
```

This populates 20 sample tasks, 5 workflows, 3 pending approvals, and a receipt chain so you can explore the dashboard immediately.

## 5. Create Your First Task

```bash
curl -X POST http://localhost:3100/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "source": "manual",
    "title": "Reply to customer about order delay",
    "intent": "reply",
    "priority": "high"
  }'
```

## 6. Simulate a Pipeline

```bash
curl -X POST http://localhost:3100/api/pipeline/simulate \
  -H "Content-Type: application/json" \
  -d '{
    "source": "email",
    "title": "Please reply to John about the project update"
  }'
```

This dry-runs the full pipeline (classify → policy → CORD safety → workflow plan) without executing any actions.

## 7. Connect Gmail (Optional)

To connect your Gmail account:

### a. Create Google OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project or select an existing one
3. Enable the **Gmail API** and **Google Calendar API**
4. Go to **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
5. Set **Authorized redirect URIs** to `http://localhost:3100/api/oauth/google/callback`
6. Copy the **Client ID** and **Client Secret**

### b. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:
```
GOOGLE_CLIENT_ID=your-client-id-here
GOOGLE_CLIENT_SECRET=your-client-secret-here
```

### c. Authorize

1. Restart the server: `node apps/ops-api/dist/server.js`
2. Open: `http://localhost:3100/api/oauth/google/url`
3. Click the authorization URL and grant access
4. You're connected! Try: `curl http://localhost:3100/api/gmail/inbox`

## 8. Connect X/Twitter (Optional)

1. Get API keys from the [X Developer Portal](https://developer.twitter.com/)
2. Add to `.env`:
   ```
   X_API_KEY=your-bearer-token
   X_USER_ID=your-user-id
   ```
3. Restart and try: `curl http://localhost:3100/api/x/timeline`

## 9. Connect Shopify (Optional)

1. Create a [Shopify custom app](https://help.shopify.com/en/manual/apps/custom-apps)
2. Add to `.env`:
   ```
   SHOPIFY_STORE_URL=https://your-store.myshopify.com
   SHOPIFY_ACCESS_TOKEN=your-admin-api-token
   ```
3. Restart and try: `curl http://localhost:3100/api/shopify/orders`

## Docker Deployment

```bash
docker compose up -d
```

The API runs on port 3100 with a persistent volume for the SQLite database.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPS_PORT` | No | `3100` | API server port |
| `OPS_DB_PATH` | No | `~/.ai-ops/data.db` | SQLite database path |
| `OPS_API_KEY` | No | (none) | API key for auth (dev mode if unset) |
| `OPS_LOG_LEVEL` | No | `INFO` | Log level: ERROR, WARN, INFO, DEBUG |
| `CORD_HMAC_KEY` | No | `ai-ops-dev-key` | HMAC key for receipt signing |
| `GOOGLE_CLIENT_ID` | For Gmail/Calendar | — | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | For Gmail/Calendar | — | Google OAuth client secret |
| `X_API_KEY` | For X/Twitter | — | X API bearer token |
| `SHOPIFY_STORE_URL` | For Shopify | — | Shopify store URL |
| `SHOPIFY_ACCESS_TOKEN` | For Shopify | — | Shopify admin API token |

## Troubleshooting

**Build fails with TypeScript errors**
```bash
npm run clean && npm install && npm run build
```

**Port 3100 already in use**
```bash
OPS_PORT=3200 node apps/ops-api/dist/server.js
```

**SQLite errors**
```bash
rm -rf ~/.ai-ops/data.db
# Server will recreate the DB on next start
```

**OAuth callback fails**
- Make sure the redirect URI in Google Cloud Console matches exactly: `http://localhost:3100/api/oauth/google/callback`
- Check that `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set in `.env`

## Next Steps

- Read the [Architecture Guide](../ARCHITECTURE.md) to understand the 6-layer pipeline
- Check the [OpenAPI Spec](./openapi.yaml) for all 45 API endpoints
- Explore the [Enterprise Guide](../ENTERPRISE.md) for production deployment options
