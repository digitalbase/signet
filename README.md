# Signet

A modern NIP-46 remote signer for Nostr. Manages multiple keys securely with a web dashboard for administration. This project was originally forked from [nsecbunkerd](https://github.com/kind-0/nsecbunkerd), but has since received an extensive rewrite.

![Signet Dashboard](signet.png)

---

## Quick Start (Docker)

```bash
git clone https://github.com/Letdown2491/signet
cd signet
pnpm install
docker compose up --build
```

This launches:
- Daemon + REST API on `http://localhost:3000`
- Web dashboard on `http://localhost:4174`

> **Note:** Signet is designed for self-hosters on trusted networks (Tailscale, Wireguard, local LAN). There is no login page - access control is handled at the network layer. Public internet deployment with authentication is planned for a future release.

Add keys via CLI or through the web UI:

```bash
docker compose run --rm signet add --name main-key
```

---

## Development Setup

**Prereqs:** Node.js 18+, pnpm

```bash
git clone https://github.com/Letdown2491/signet
cd signet
pnpm install
```

Start the daemon:

```bash
cd apps/signet
pnpm run build
pnpm run prisma:migrate
pnpm run signet -- add --name main-key
pnpm run signet -- start --key main-key
```

Start the UI dev server:

```bash
cd apps/signet-ui
pnpm run dev
```

---

## Configuration

Config is auto-generated on first boot at:
- Docker: `~/.signet-config/signet.json`
- Local dev: `apps/signet/config/signet.json`

See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for all options.

---

## Security

Keys are encrypted with AES-256-GCM (PBKDF2, 600k iterations). API endpoints require JWT auth with CORS and rate limiting.

See [docs/SECURITY.md](docs/SECURITY.md) for the full security model.

---

## Documentation

- [Configuration Reference](docs/CONFIGURATION.md) - All config options
- [Deployment Guide](docs/DEPLOYMENT.md) - Tailscale, reverse proxies, etc.
- [Security Model](docs/SECURITY.md) - Security architecture and threat model
- [API Reference](docs/API.md) - REST API endpoints
