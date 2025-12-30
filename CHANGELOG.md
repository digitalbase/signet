# Changelog

## [1.0.0-beta]

### Added

- **App Names in Activity** - Requests now display app names (from KeyUser.description) instead of truncated npubs in the Activity page and request details modal
  - New `appName` field added to `PendingRequest` API response
  - App filter dropdown shows app names when available
  - Search includes app names
  - Backfill migration populates `keyUserId` on existing requests
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
- **Subscription Manager** - Automatic subscription recovery after system sleep/wake via time-jump detection and ping-based health checks
- **Kind Names & Descriptions** - Human-readable event kind names (e.g., "Short Text Note" for kind 1) with contextual descriptions in request details
- **Permission Request Details** - Rich preview for signing requests showing kind, content, tags; trust level breakdown during connect; "Always allow [kind]" checkbox for kind-specific permissions
- **Config Options** - `jwtSecret`, `allowedOrigins`, `requireAuth` for security configuration
- **Environment Variables** - Improved Docker environment variable naming with service prefixes (`SIGNET_PORT`, `SIGNET_HOST`, `EXTERNAL_URL`, `UI_PORT`, `UI_HOST`, `DAEMON_URL`); legacy names still supported
- **Auto-Approval Activity Logging** - Requests auto-approved via trust level are now logged and visible in the Activity feed
  - Activity entries include `autoApproved` field to distinguish from manual approvals
  - "Auto" badge displayed on auto-approved entries in the UI
  - "Show auto" toggle to filter auto-approved entries
  - Rate-limited to 1 log per method per minute per app to prevent spam
  - New SSE event `request:auto_approved` for real-time updates
- **NIP-04 Support** - Added `nip04_encrypt` and `nip04_decrypt` methods for backwards compatibility with clients using legacy encrypted DMs

### Changed

- **Recent Activity Layout** - "Auto" badge moved next to timestamp ("Auto 27m ago") for better information grouping
- **Pending Count Source** - Sidebar badge and browser notifications now use dashboard stats for accurate count regardless of Activity filter state
- **UI Redesign** - Complete Linear-inspired visual overhaul with dark theme and purple accents
- **Navigation** - Sidebar navigation replacing tab bar; Home view for pending requests, Activity view for history
- **Mobile Experience** - Responsive layouts, collapsible sidebar, 44px touch targets
- **Icons** - Replaced emoji indicators with Lucide React icons
- **Trust Level Labels** - Simplified to "Always Ask", "Auto-approve Safe", "Auto-approve All"
- **Connect Flow** - Bunker secret now validates the connection but no longer auto-approves; all first-time connects require manual approval with trust level selection
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
- **Dependencies** - Removed `axios`, `express`, `crypto-js`, `lnbits`, `lnbits-ts`
- **NDK Dependency** - Replaced `@nostr-dev-kit/ndk` with direct `nostr-tools` usage for smaller bundle size and simpler relay management
- **Dead Code** - Removed unused `TabBar` component, `withErrorHandler` function, and legacy trust level exports

### Fixed

- Pending request count now correctly excludes expired requests (was counting all unprocessed requests regardless of age)
- SSE real-time updates now work correctly when Activity page filter is not set to "pending" - navigating to Home resets filter to ensure requests are fetched
- Token redemption race condition - atomic claiming prevents simultaneous redemption by multiple clients
- nsecEncode bug where hex private keys were passed directly instead of Buffer (GitHub issue #6)
- BigInt serialization error in `/dashboard` endpoint (SQLite COUNT returns BigInt)
- Docker Alpine compatibility for `better-sqlite3` native module
- Unhandled promises and swallowed errors in authorization polling
- Database cleanup errors now logged instead of silently ignored
- Relay subscriptions now auto-recover after system sleep/wake cycles via `SubscriptionManager` with time-jump detection and ping-based health checks
- Relay status in UI now updates via real-time SSE events when connections change, with 30-second polling fallback
- ACL now properly handles NIP-46 method names (`nip44_encrypt`, `nip44_decrypt`, `nip04_encrypt`, `nip04_decrypt`) instead of just generic `encrypt`/`decrypt`
- NIP-44 encryption/decryption now auto-approved at "reasonable" trust level (used for blossom file auth, general data encryption), while NIP-04 still requires approval (legacy DMs)
- Reconnects from existing apps now respect trust level: "paranoid" mode shows reconnect requests in pending queue, while "reasonable"/"full" auto-approve reconnects

### Security

- **Timing-Safe Secret Comparison** - Admin secret validation uses constant-time comparison to prevent timing attacks
- **Hex Input Validation** - Hex string parsing now validates input characters, preventing silent data corruption
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
