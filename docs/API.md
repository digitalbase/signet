# Signet REST API Reference

This document describes all REST API endpoints provided by the Signet daemon.

## Base URL

- **Development**: `http://localhost:3000`
- **Docker**: `http://localhost:3000` (internal), exposed via UI proxy
- **Production**: Configure via `baseUrl` in `signet.json`

## Authentication

Most endpoints require JWT authentication. The token is stored in an HTTP-only cookie after login.

### Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Authorization` | Optional | Bearer token (alternative to cookie) |
| `X-CSRF-Token` | For mutations | CSRF token for POST/PATCH/DELETE requests |

### Getting a CSRF Token

Before making state-changing requests, fetch a CSRF token:

```bash
curl -c cookies.txt http://localhost:3000/csrf-token
```

Include the token in subsequent requests:

```bash
curl -b cookies.txt -H "X-CSRF-Token: <token>" -X POST ...
```

---

## Endpoints

### Health

#### `GET /health`

Health check endpoint. No authentication required.

**Response:**
```json
{
  "status": "ok"
}
```

---

### CSRF Token

#### `GET /csrf-token`

Get a CSRF token for state-changing requests.

**Authentication:** Required

**Response:**
```json
{
  "token": "abc123..."
}
```

The token is also set in a cookie named `signet_csrf`.

---

### Connection

#### `GET /connection`

Get bunker connection information for NIP-46 clients.

**Authentication:** Required

**Response:**
```json
{
  "npub": "npub1...",
  "pubkey": "hex...",
  "npubUri": "bunker://npub1...?relay=wss://...",
  "hexUri": "bunker://hex...?relay=wss://...",
  "relays": ["wss://relay.example.com"],
  "nostrRelays": ["wss://relay.damus.io"]
}
```

---

### Relays

#### `GET /relays`

Get relay connection status.

**Authentication:** Required

**Response:**
```json
{
  "connected": 4,
  "total": 5,
  "relays": [
    {
      "url": "wss://relay.damus.io",
      "connected": true,
      "lastConnected": "2025-01-15T10:30:00.000Z",
      "lastDisconnected": null
    }
  ]
}
```

---

### Requests

#### `GET /requests`

List authorization requests.

**Authentication:** Required

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `status` | string | `pending` | Filter by status: `pending`, `approved`, `expired` |
| `limit` | number | 10 | Max results (1-50) |
| `offset` | number | 0 | Pagination offset |

**Response:**
```json
{
  "requests": [
    {
      "id": "uuid-string",
      "keyName": "main-key",
      "method": "sign_event",
      "remotePubkey": "hex...",
      "params": "{\"kind\":1,\"content\":\"Hello\"}",
      "eventPreview": {
        "kind": 1,
        "content": "Hello",
        "tags": []
      },
      "createdAt": "2025-01-15T10:30:00.000Z",
      "expiresAt": "2025-01-15T10:31:00.000Z",
      "ttlSeconds": 45,
      "requiresPassword": false,
      "processedAt": null,
      "autoApproved": false,
      "appName": "Primal"
    }
  ]
}
```

---

#### `GET /requests/:id`

Web authorization page (HTML). Used for manual approval via browser.

**Authentication:** Not required (uses request secret)

**Response:** HTML page for approving/denying the request.

---

#### `POST /requests/:id`

Approve or deny a request.

**Authentication:** Not required (uses form submission from web page)
**Rate Limited:** Yes (10 req/min)

**Request Body (form-encoded):**

| Field | Type | Description |
|-------|------|-------------|
| `passphrase` | string | Key passphrase (if encrypted) |
| `trustLevel` | string | For connect: `paranoid`, `reasonable`, `full` |
| `alwaysAllow` | boolean | Grant permission for future requests of this type |

**Response:** Redirect to success/error page.

---

#### `POST /requests/batch`

Batch approve multiple requests.

**Authentication:** Required
**CSRF:** Required
**Rate Limited:** Yes (10 req/min)

**Request Body:**
```json
{
  "ids": ["uuid1", "uuid2", "uuid3"],
  "trustLevel": "reasonable",
  "alwaysAllow": false
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `ids` | string[] | required | Request IDs to approve (max 50) |
| `trustLevel` | string | `reasonable` | Trust level for connect requests |
| `alwaysAllow` | boolean | `false` | Grant permanent permission |

**Response:**
```json
{
  "results": [
    { "id": "uuid1", "success": true },
    { "id": "uuid2", "success": false, "error": "Request not found" }
  ],
  "summary": {
    "approved": 1,
    "failed": 1
  }
}
```

---

### Keys

#### `GET /keys`

List all keys.

**Authentication:** Required

**Response:**
```json
{
  "keys": [
    {
      "name": "main-key",
      "npub": "npub1...",
      "bunkerUri": "bunker://...",
      "status": "online",
      "isEncrypted": true,
      "userCount": 5,
      "tokenCount": 2,
      "requestCount": 150,
      "lastUsedAt": "2025-01-15T10:30:00.000Z"
    }
  ]
}
```

**Key Status Values:**
- `online` - Key is unlocked and active
- `locked` - Key is encrypted and needs passphrase
- `offline` - Key is not loaded

---

#### `POST /keys`

Create a new key.

**Authentication:** Required
**CSRF:** Required
**Rate Limited:** Yes (10 req/min)

**Request Body:**
```json
{
  "keyName": "my-key",
  "passphrase": "optional-passphrase",
  "nsec": "nsec1... (optional, generates new if omitted)"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `keyName` | string | Yes | Unique key identifier |
| `passphrase` | string | No | Encrypt key with passphrase |
| `nsec` | string | No | Import existing nsec (generates new if omitted) |

**Response:**
```json
{
  "ok": true,
  "key": {
    "name": "my-key",
    "npub": "npub1...",
    "status": "online",
    "isEncrypted": false
  }
}
```

---

#### `PATCH /keys/:keyName`

Rename a key.

**Authentication:** Required
**CSRF:** Required

**Request Body:**
```json
{
  "newName": "renamed-key"
}
```

**Response:**
```json
{
  "ok": true
}
```

---

#### `POST /keys/:keyName/unlock`

Unlock an encrypted key.

**Authentication:** Required
**CSRF:** Required

**Request Body:**
```json
{
  "passphrase": "your-passphrase"
}
```

**Response:**
```json
{
  "ok": true
}
```

**Errors:**
- `400` - Passphrase is required
- `401` - Incorrect passphrase
- `404` - Key not found

---

#### `POST /keys/:keyName/set-passphrase`

Encrypt an unencrypted key with a passphrase.

**Authentication:** Required
**CSRF:** Required
**Rate Limited:** Yes (10 req/min)

**Request Body:**
```json
{
  "passphrase": "new-passphrase"
}
```

**Response:**
```json
{
  "ok": true
}
```

---

#### `DELETE /keys/:keyName`

Delete a key and revoke all connected apps.

**Authentication:** Required
**CSRF:** Required
**Rate Limited:** Yes (10 req/min)

**Request Body:**
```json
{
  "passphrase": "required-if-encrypted"
}
```

**Response:**
```json
{
  "ok": true,
  "revokedApps": 3
}
```

---

### Apps

#### `GET /apps`

List all connected applications.

**Authentication:** Required

**Response:**
```json
{
  "apps": [
    {
      "id": 1,
      "keyName": "main-key",
      "userPubkey": "hex...",
      "description": "Primal",
      "trustLevel": "reasonable",
      "permissions": ["sign_event", "nip04_encrypt"],
      "connectedAt": "2025-01-10T08:00:00.000Z",
      "lastUsedAt": "2025-01-15T10:30:00.000Z",
      "requestCount": 42,
      "methodBreakdown": {
        "sign_event": 35,
        "nip04_encrypt": 5,
        "nip04_decrypt": 2,
        "nip44_encrypt": 0,
        "nip44_decrypt": 0,
        "get_public_key": 0,
        "other": 0
      }
    }
  ]
}
```

**Trust Levels:**
- `paranoid` - Always ask for approval (including reconnects)
- `reasonable` - Auto-approve safe event kinds (1, 6, 7, 16, 1111, 24242), NIP-44 encryption, and reconnects
- `full` - Auto-approve all requests

Note: NIP-04 encryption (`nip04_encrypt`, `nip04_decrypt`) always requires approval at `paranoid` and `reasonable` levels due to privacy sensitivity (legacy DMs).

---

#### `PATCH /apps/:id`

Update an app's description or trust level.

**Authentication:** Required
**CSRF:** Required

**Request Body:**
```json
{
  "description": "My Nostr Client",
  "trustLevel": "full"
}
```

At least one field is required.

**Response:**
```json
{
  "ok": true
}
```

---

#### `POST /apps/:id/revoke`

Revoke an app's access.

**Authentication:** Required
**CSRF:** Required

**Response:**
```json
{
  "ok": true
}
```

---

### Dashboard

#### `GET /dashboard`

Get dashboard statistics and recent activity.

**Authentication:** Required

**Response:**
```json
{
  "stats": {
    "totalKeys": 3,
    "activeKeys": 2,
    "connectedApps": 5,
    "pendingRequests": 1,
    "recentActivity24h": 54
  },
  "activity": [
    {
      "id": 123,
      "timestamp": "2025-01-15T10:30:00.000Z",
      "type": "approval",
      "method": "sign_event",
      "keyName": "main-key",
      "userPubkey": "hex...",
      "appName": "Primal",
      "autoApproved": false
    }
  ]
}
```

---

### Events (SSE)

#### `GET /events`

Server-Sent Events stream for real-time updates.

**Authentication:** Required

**Connection:**
```javascript
const eventSource = new EventSource('/events', { withCredentials: true });

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(data.type, data);
};
```

**Event Types:**

| Type | Description | Payload |
|------|-------------|---------|
| `connected` | Initial connection established | `{}` |
| `request:created` | New authorization request | `{ request: PendingRequest }` |
| `request:approved` | Request was approved | `{ requestId: string }` |
| `request:denied` | Request was denied | `{ requestId: string }` |
| `request:expired` | Request expired | `{ requestId: string }` |
| `request:auto_approved` | Request auto-approved via trust level | `{ activity: ActivityEntry }` |
| `app:connected` | New app connected | `{ app: ConnectedApp }` |
| `key:created` | Key was created | `{ key: KeyInfo }` |
| `key:unlocked` | Key was unlocked | `{ keyName: string }` |
| `key:deleted` | Key was deleted | `{ keyName: string }` |
| `stats:updated` | Dashboard stats changed | `{ stats: DashboardStats }` |
| `relays:updated` | Relay connection status changed | `{ relays: RelayStatusResponse }` |
| `ping` | Keep-alive (every 30s) | n/a (comment line) |

---

#### `GET /events/status`

Get SSE connection status.

**Authentication:** Required

**Response:**
```json
{
  "subscribers": 2
}
```

---

### Tokens

#### `GET /tokens`

List all delegation tokens.

**Authentication:** Required

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `keyName` | string | Filter by key name |

**Response:**
```json
{
  "tokens": [
    {
      "id": 1,
      "keyName": "main-key",
      "clientName": "Mobile App",
      "token": "hex-token...",
      "policyId": 1,
      "policyName": "Read Only",
      "createdAt": "2025-01-10T08:00:00.000Z",
      "expiresAt": "2025-02-10T08:00:00.000Z",
      "redeemedAt": null,
      "redeemedBy": null
    }
  ]
}
```

---

#### `POST /tokens`

Create a new delegation token.

**Authentication:** Required
**CSRF:** Required
**Rate Limited:** Yes (10 req/min)

**Request Body:**
```json
{
  "keyName": "main-key",
  "clientName": "Mobile App",
  "policyId": 1,
  "expiresInHours": 720
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `keyName` | string | Yes | Key to delegate |
| `clientName` | string | Yes | Name for the client |
| `policyId` | number | Yes | Policy to apply |
| `expiresInHours` | number | No | Token expiration (hours) |

**Response:**
```json
{
  "ok": true,
  "token": {
    "id": 1,
    "token": "hex-token...",
    "expiresAt": "2025-02-10T08:00:00.000Z"
  }
}
```

---

#### `DELETE /tokens/:id`

Delete a token.

**Authentication:** Required
**CSRF:** Required

**Response:**
```json
{
  "ok": true
}
```

---

### Policies

#### `GET /policies`

List all policies.

**Authentication:** Required

**Response:**
```json
{
  "policies": [
    {
      "id": 1,
      "name": "Read Only",
      "description": "Only allows reading public key",
      "createdAt": "2025-01-10T08:00:00.000Z",
      "expiresAt": null,
      "rules": [
        {
          "id": 1,
          "method": "get_public_key",
          "kind": null,
          "maxUsageCount": null,
          "currentUsageCount": 0
        }
      ]
    }
  ]
}
```

---

#### `POST /policies`

Create a new policy.

**Authentication:** Required
**CSRF:** Required
**Rate Limited:** Yes (10 req/min)

**Request Body:**
```json
{
  "name": "Social Only",
  "description": "Allow signing social events",
  "expiresAt": "2025-12-31T23:59:59.000Z",
  "rules": [
    { "method": "sign_event", "kind": 1, "maxUsageCount": 100 },
    { "method": "sign_event", "kind": 6 },
    { "method": "sign_event", "kind": 7 }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Policy name |
| `description` | string | No | Policy description |
| `expiresAt` | string | No | ISO 8601 expiration date |
| `rules` | array | No | Permission rules |

**Rule Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `method` | string | NIP-46 method name (see [valid methods](#nip-46-methods)) |
| `kind` | number/string | Event kind (for sign_event) |
| `maxUsageCount` | number | Usage limit (null = unlimited) |

**Errors:**
- `400 Bad Request` - Invalid method name(s). Response includes the list of valid methods.

**Response:**
```json
{
  "ok": true,
  "policy": {
    "id": 2,
    "name": "Social Only",
    "rules": [
      { "id": 4, "method": "sign_event", "kind": "1" },
      { "id": 5, "method": "sign_event", "kind": "6" },
      { "id": 6, "method": "sign_event", "kind": "7" }
    ]
  }
}
```

---

#### `DELETE /policies/:id`

Delete a policy and its rules.

**Authentication:** Required
**CSRF:** Required

**Response:**
```json
{
  "ok": true
}
```

---

## Error Responses

All endpoints return consistent error responses:

```json
{
  "error": "Error message describing what went wrong"
}
```

### HTTP Status Codes

| Code | Description |
|------|-------------|
| `200` | Success |
| `400` | Bad request (invalid input) |
| `401` | Unauthorized (missing/invalid auth) |
| `403` | Forbidden (invalid CSRF token) |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Internal server error |
| `503` | Service unavailable |

### Rate Limit Response

When rate limited, the response includes a `Retry-After` header:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 60

{
  "error": "Rate limit exceeded. Try again in 60 seconds."
}
```

---

## NIP-46 Methods

For reference, these are the NIP-46 methods that appear in requests:

| Method | Description |
|--------|-------------|
| `connect` | Initial connection request |
| `sign_event` | Sign a Nostr event |
| `get_public_key` | Get the public key |
| `nip04_encrypt` | Encrypt message (NIP-04) |
| `nip04_decrypt` | Decrypt message (NIP-04) |
| `nip44_encrypt` | Encrypt message (NIP-44) |
| `nip44_decrypt` | Decrypt message (NIP-44) |
| `ping` | Connection health check |

---

## TypeScript Types

All API types are available in the `@signet/types` package:

```typescript
import type {
  ConnectionInfo,
  RelayStatusResponse,
  PendingRequest,
  KeyInfo,
  ConnectedApp,
  DashboardResponse,
  DashboardStats,
  ActivityEntry,
  TrustLevel,
} from '@signet/types';
```
