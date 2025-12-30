# Signet Configuration

All runtime settings live in `signet.json`. When running via Docker, the file is mounted at `~/.signet-config/signet.json`. Locally it defaults to `apps/signet/config/signet.json` unless you pass `--config`.

On first boot, Signet auto-generates this file with secure defaults (including all required secrets). You only need to edit it to customize relays, CORS origins, or other settings.

## Example

```json
{
  "nostr": {
    "relays": [
      "wss://relay.nip46.com",
      "wss://relay.primal.net",
      "wss://relay.damus.io",
      "wss://theforest.nostr1.com",
      "wss://nostr.oxtr.dev"
    ]
  },
  "admin": {
    "key": "auto-generated",
    "secret": "auto-generated-256-bit"
  },
  "authPort": 3000,
  "authHost": "0.0.0.0",
  "baseUrl": "http://localhost:4174",
  "database": "sqlite://signet.db",
  "logs": "./signet.log",
  "keys": {
    "alice": {
      "iv": "hex-iv",
      "data": "hex-cipher"
    },
    "bob": {
      "key": "nsec1..."
    }
  },
  "jwtSecret": "auto-generated-256-bit-secret",
  "allowedOrigins": [
    "http://localhost:4174",
    "http://localhost:3000"
  ],
  "requireAuth": false,
  "verbose": false
}
```

## Keys

- `keys.<name>.iv` + `keys.<name>.data`: encrypted nsec (written by `signet add`). Provide the passphrase at boot or unlock through the admin UI.
- `keys.<name>.key`: plain nsec text (auto-starts without prompt; keep the file private).

Keys are encrypted using AES-256-GCM with PBKDF2 key derivation (600,000 iterations). Legacy keys encrypted with AES-256-CBC are automatically detected and remain compatible.

## Networking

- `nostr.relays`: relays watched for NIP-46 requests.

## Web Administration

All administration is done via the web UI. The following settings are required:

- `baseUrl`: public URL where the daemon is reachable (required for request approval flow).
- `authPort` / `authHost`: local interface for the Fastify REST API.

## Security Settings

### `jwtSecret`

Secret key used to sign JWT authentication tokens for the REST API.

- **Type**: string (hex-encoded)
- **Default**: Auto-generated 256-bit secret on first run
- **Recommendation**: Let Signet generate this automatically. If you need to set it manually, use at least 32 bytes of cryptographically random data.

```bash
# Generate a secure secret manually
openssl rand -hex 32
```

### `allowedOrigins`

List of origins allowed to make cross-origin requests to the API. This controls the CORS `Access-Control-Allow-Origin` header.

- **Type**: array of strings
- **Default**: `["http://localhost:4174", "http://localhost:3000", "http://127.0.0.1:4174", "http://127.0.0.1:3000"]`

For production, set this to your actual UI domain(s):

```json
{
  "allowedOrigins": [
    "https://signet.example.com",
    "https://admin.example.com"
  ]
}
```

Supported patterns:
- Exact match: `"https://app.example.com"`
- Wildcard subdomain: `"*.example.com"` (matches `app.example.com`, `admin.example.com`, etc.)
- Wildcard all (not recommended): `"*"`

### `requireAuth`

Require JWT authentication for all API endpoints.

- **Type**: boolean
- **Default**: `false`

When `false` (default), the API is open for local development. Set to `true` for production deployments where you want to enforce authentication.

```json
{
  "requireAuth": true
}
```

### `admin.secret`

Secret included in the bunker connection URI. Used to validate connection attempts from NIP-46 clients.

- **Type**: string (hex-encoded)
- **Default**: Auto-generated 256-bit secret on first run
- **Note**: This is separate from `jwtSecret` which is used for REST API auth.
- **Behavior**: The secret validates that a client has the correct bunker URI, but does **not** auto-approve the connection. All first-time connections require manual approval via the UI, where you select a trust level. Invalid secrets are silently rejected.

## Rate Limiting

The API includes built-in rate limiting for sensitive endpoints:

| Endpoint Category | Limit | Block Duration |
|-------------------|-------|----------------|
| Request Approval (`POST /requests/:id`) | 10 req/min | 1 minute |
| Key Management (`POST /keys`, `DELETE /keys/:name`) | 10 req/min | 1 minute |
| Batch Operations (`POST /requests/batch`) | 10 req/min | 1 minute |

Rate limits are per-IP address. After exceeding the limit, requests receive HTTP 429 with a `Retry-After` header.

## Environment Variables

Docker Compose works out of the box with no `.env` file required. To customize settings, set these environment variables before running `docker compose`:

```bash
SIGNET_PORT=3001 UI_PORT=8080 EXTERNAL_URL=https://signet.example.com docker compose up --build
```

### Daemon Variables (`signet`)

| Variable | Description | Default |
|----------|-------------|---------|
| `SIGNET_PORT` | Port for the REST API | `3000` |
| `SIGNET_HOST` | Host binding for the REST API | `0.0.0.0` |
| `EXTERNAL_URL` | Public URL of the UI (for authorization flow) | `http://localhost:4174` |
| `DATABASE_URL` | SQLite database path | `file:/app/config/signet.db` |

### UI Variables (`signet-ui`)

| Variable | Description | Default |
|----------|-------------|---------|
| `UI_PORT` | Port for the React UI | `4174` |
| `UI_HOST` | Host binding for the UI server | `0.0.0.0` |
| `DAEMON_URL` | Internal URL to reach the daemon | `http://localhost:3000` |

The `EXTERNAL_URL` environment variable is particularly important for Docker deployments. It tells Signet where to redirect users for request approval. If not set in the config file, the daemon will use this environment variable.

> **Note:** Legacy variable names (`AUTH_PORT`, `AUTH_HOST`, `BASE_URL`, `PORT`, `HOST`) are still supported for backward compatibility but are deprecated.

All other settings are configured in `signet.json`.

---

For deployment guides (Tailscale, reverse proxies, etc.), see [DEPLOYMENT.md](DEPLOYMENT.md).
