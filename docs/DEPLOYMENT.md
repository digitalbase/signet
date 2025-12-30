# Deployment Guide

This guide covers common deployment scenarios for Signet.

## Private Network (Tailscale)

Tailscale provides secure access to Signet without exposing it to the public internet. All devices on your tailnet can reach Signet via its Tailscale hostname.

### Architecture Note

The UI proxies all API requests to the daemon internally:

```
Browser → UI (:4174) → [proxy] → Daemon (:3000)
```

You only expose the UI. The daemon doesn't need direct external access - it communicates with NIP-46 clients via Nostr relays, not HTTP.

### Configuration

Set `EXTERNAL_URL` to your Tailscale hostname so that `auth_url` responses are reachable from other devices on your tailnet:

```bash
EXTERNAL_URL=http://signet.tailnet-name.ts.net:4174 docker compose up --build
```

Or in `signet.json`:

```json
{
  "baseUrl": "http://signet.tailnet-name.ts.net:4174",
  "allowedOrigins": [
    "http://signet.tailnet-name.ts.net:4174"
  ]
}
```

Replace `signet.tailnet-name.ts.net` with your actual Tailscale hostname (find it with `tailscale status`).

### HTTPS with Tailscale Serve

Some browser features (like clipboard copy) require HTTPS. Tailscale Serve provides automatic TLS certificates for `*.ts.net` domains:

```bash
# Serve the UI over HTTPS
tailscale serve https / http://localhost:4174
```

Then update your config to use HTTPS:

```json
{
  "baseUrl": "https://signet.tailnet-name.ts.net",
  "allowedOrigins": [
    "https://signet.tailnet-name.ts.net"
  ]
}
```

Note: Tailscale Serve on port 443 means you drop the port from URLs.

### When is EXTERNAL_URL needed?

| Setup | EXTERNAL_URL |
|-------|--------------|
| Single machine (Signet + apps on same device) | Not needed (localhost works) |
| Multi-device (Signet on server, apps on phone/laptop) | Required - use Tailscale hostname |

The `auth_url` sent to NIP-46 clients must be reachable from whatever device needs to approve requests. The default `localhost` only works for single-machine setups.
