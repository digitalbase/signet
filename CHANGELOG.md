# Changelog

## [1.0.0-beta]

### Added

- **REST API Authentication** - All sensitive endpoints now require JWT authentication via `@fastify/jwt` and `@fastify/cookie`
- **CSRF Protection** - Double-submit cookie pattern with timing-safe comparison for all state-changing endpoints
- **Rate Limiting** - Per-IP rate limits (10 req/min) on authentication, key management, and batch endpoints
- **Real-time Updates (SSE)** - Server-Sent Events endpoint (`GET /events`) with pub/sub pattern for live UI updates
- **Batch Operations** - Batch approval API (`POST /requests/batch`) and bulk selection mode in UI
- **Search & Filtering** - Request/app search by npub, method, event kind; sorting and filtering options
- **Key Management** - Key deletion with passphrase verification, automatic app revocation, key statistics
- **App Insights** - Method breakdown visualization, per-app usage statistics, trust level management
- **Command Palette** - Quick navigation via `Cmd+K` / `Ctrl+K`
- **Relay Health Monitoring** - Connection status tracking with automatic reconnection using exponential backoff
- **Shared Types Package** - New `@signet/types` package for API and config type definitions
- **Service Layer Architecture** - `KeyService`, `RequestService`, `AppService`, `DashboardService`, `EventService`, `RelayService`
- **Repository Layer** - Database access layer with batch query methods (eliminates N+1 queries)
- **ACL Caching** - 30-second TTL cache for permission lookups with automatic invalidation
- **Config Options** - `jwtSecret`, `allowedOrigins`, `requireAuth` for security configuration
- **Environment Variables** - Improved Docker environment variable naming with service prefixes (`SIGNET_PORT`, `SIGNET_HOST`, `EXTERNAL_URL`, `UI_PORT`, `UI_HOST`, `DAEMON_URL`); legacy names still supported

### Changed

- **UI Redesign** - Complete Linear-inspired visual overhaul with dark theme and purple accents
- **Navigation** - Sidebar navigation replacing tab bar; Home view for pending requests, Activity view for history
- **Mobile Experience** - Responsive layouts, collapsible sidebar, 44px touch targets
- **Icons** - Replaced emoji indicators with Lucide React icons
- **Trust Level Labels** - Simplified to "Always Ask", "Auto-approve Safe", "Auto-approve All"
- **Error Messages** - Contextual guidance with retry buttons
- **Accessibility** - Focus trapping in modals, ARIA labels, keyboard navigation
- **Rate Limit Lockout** - Reduced from 5 minutes to 1 minute
- **Polling** - Authorization polling uses exponential backoff (100ms initial, 2s max)
- **Prisma** - Upgraded to v7 with `@prisma/adapter-better-sqlite3` driver adapter
- **CORS** - Restricted to explicitly configured origins (no more echoing arbitrary origins)

### Removed

- **OAuth Account Flow** - Removed `create_account` NIP-46 method, `/register` endpoint, and `domains` config
- **User Model** - Removed unused email field
- **Unused Libraries** - Removed `lib/rpc/`, `lib/bunker.ts`, `lib/nip07.ts`
- **Dependencies** - Removed `axios`, `express`, `crypto-js`

### Fixed

- nsecEncode bug where hex private keys were passed directly instead of Buffer (GitHub issue #6)
- BigInt serialization error in `/dashboard` endpoint (SQLite COUNT returns BigInt)
- Docker Alpine compatibility for `better-sqlite3` native module
- Unhandled promises and swallowed errors in authorization polling
- Database cleanup errors now logged instead of silently ignored
- NIP-46 subscriptions not recovering after sleep/wake cycles - subscription lifecycle now managed explicitly with automatic restart on relay reconnection

### Security

- **API Authentication** - All sensitive endpoints (`/keys`, `/apps`, `/connection`, `/requests`, `/dashboard`) now require JWT authentication (previously unauthenticated)
- **Encryption Upgrade** - Migrated from AES-256-CBC to AES-256-GCM with authenticated encryption for tamper detection
- **Key Derivation** - PBKDF2 iterations increased from 100,000 to 600,000 per NIST SP 800-132 (2023)
- **Secret Generation** - Admin secrets upgraded from 8 alphanumeric chars (~41 bits) to 32 bytes hex (256 bits)
- **XSS Prevention** - Callback URLs validated for `http://https://` only; error messages HTML-escaped
- **Safe URL Parsing** - Try-catch guards on all `new URL()` calls to prevent crashes

---

## [0.10.5]

Initial public release of Signet fork from nsecbunkerd.

### Added

- Modern React dashboard UI
- NIP-46 remote signing support
- Multi-key management
- Web-based request approval flow
- Docker Compose deployment
