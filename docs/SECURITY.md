# Security Model

The premise of Signet is that you can store Nostr private keys (nsecs), use them remotely under certain policies, but these keys can never be exfiltrated from the bunker.

All communication with Signet happens through encrypted, ephemeral Nostr events following the NIP-46 protocol.

## Keys

Within Signet there are two distinct sets of keys:

### User keys

The keys that users want to sign with. These keys are stored encrypted with a passphrase using AES-256-GCM with authenticated encryption. The encryption key is derived using PBKDF2 with 600,000 iterations (per NIST SP 800-132 recommendations). Every time you start Signet, you must enter the passphrase to decrypt it.

Without this passphrase, keys cannot be used. The authenticated encryption ensures that any tampering with the encrypted data is detected.

### Signet's admin key

Signet generates its own private key, which is used for NIP-46 bunker communication. If this key is compromised, no user key material is at risk.

Administration is performed exclusively via the web UI, which requires JWT authentication. The web UI should be secured via network-level access control through the use of VPN/Wireguard/Tailscale, firewall rules, and reverse proxy authentication.

We currently recommend running this on a locally trusted machine only.

## NIP-46 (Nostr Connect)

Signet listens on configured relays, specified in `signet.json`, for NIP-46 requests from applications attempting to use the target keys.

## REST API Security

The REST API provides management functionality for the web dashboard. It implements multiple security layers:

### Authentication

All sensitive endpoints require JWT (JSON Web Token) authentication:

- Tokens are signed using HMAC-SHA256 with a 256-bit secret (`jwtSecret` in config)
- Tokens expire after 7 days
- Tokens are transmitted via HTTP-only, secure, same-site cookies

Protected endpoints include:
- `GET /connection` - Bunker connection info
- `GET /keys` - List all keys
- `POST /keys` - Create new keys
- `DELETE /keys/:name` - Delete a key
- `GET /apps` - List connected applications
- `POST /apps/:id/revoke` - Revoke application access
- `PATCH /apps/:id` - Update application metadata
- `GET /requests` - List pending authorization requests
- `POST /requests/batch` - Batch approve multiple requests
- `GET /events` - Server-sent events stream for real-time updates
- `GET /dashboard` - Dashboard statistics
- `GET /csrf-token` - Obtain CSRF token for state-changing requests
- `GET /tokens` - List tokens
- `POST /tokens` - Create tokens
- `DELETE /tokens/:id` - Delete tokens
- `GET /policies` - List policies
- `POST /policies` - Create policies
- `DELETE /policies/:id` - Delete policies

### CORS (Cross-Origin Resource Sharing)

CORS is restricted to explicitly configured origins:

- Only origins listed in `allowedOrigins` can make cross-origin requests
- Credentials (cookies) are only sent to allowed origins
- Wildcard origins are supported but not recommended for production

### CSRF Protection

State-changing API endpoints are protected against Cross-Site Request Forgery using the double-submit cookie pattern:

1. **Token Generation**: Client fetches a CSRF token via `GET /csrf-token`
2. **Cookie Storage**: Token is set in a non-HttpOnly cookie (`signet_csrf`)
3. **Header Submission**: Client includes the token in `X-CSRF-Token` header for state-changing requests
4. **Validation**: Server compares cookie and header using timing-safe comparison

Protected methods: POST, PUT, DELETE, PATCH

The following endpoints require CSRF tokens:
- `POST /keys` - Create new keys
- `POST /keys/:name/unlock` - Unlock encrypted keys
- `DELETE /keys/:name` - Delete keys
- `POST /apps/:id/revoke` - Revoke application access
- `PATCH /apps/:id` - Update application settings
- `POST /requests/batch` - Batch approve requests
- `POST /tokens` - Create tokens
- `DELETE /tokens/:id` - Delete tokens
- `POST /policies` - Create policies
- `DELETE /policies/:id` - Delete policies

### Rate Limiting

Sensitive endpoints are rate-limited to prevent brute-force attacks:

- 10 requests per minute per IP address
- 1-minute lockout after exceeding the limit
- Rate limits apply to:
  - Request approval (`POST /requests/:id`)
  - Key management (`POST /keys`, `DELETE /keys/:name`)
  - Batch operations (`POST /requests/batch`)

### Input Validation

- Callback URLs are validated to prevent XSS (only `http://` and `https://` allowed)
- Error messages are HTML-escaped before rendering
- JSON parsing uses safe defaults

## Encryption Details

### Key Encryption (AES-256-GCM)

User keys are encrypted using:

- **Algorithm**: AES-256-GCM (authenticated encryption)
- **Key derivation**: PBKDF2-HMAC-SHA256
- **Iterations**: 600,000
- **Salt**: 16 bytes, randomly generated per key
- **IV/Nonce**: 12 bytes, randomly generated per encryption
- **Auth tag**: 16 bytes (automatically verified on decryption)

The encrypted format includes a version byte for future compatibility. Legacy keys encrypted with AES-256-CBC are automatically detected and can be decrypted.

### Secret Generation

All secrets (JWT secret, admin secret) are generated using Node.js `crypto.randomBytes()`:

- **Length**: 32 bytes (256 bits)
- **Encoding**: Hexadecimal (64 characters)

## Threat Model

### What Signet protects against

1. **Key exfiltration**: Private keys never leave the bunker in plain text
2. **Unauthorized signing**: All signing requests require explicit approval
3. **Brute-force attacks**: Rate limiting and strong key derivation
4. **CSRF attacks**: Double-submit cookie pattern with timing-safe comparison
5. **XSS attacks**: CORS restrictions, input validation, and HTML escaping
6. **Replay attacks**: NIP-46 uses ephemeral encrypted events
7. **Data tampering**: Authenticated encryption detects modifications

### What Signet does NOT protect against

1. **Compromised host**: If the server running Signet is compromised, an attacker could potentially extract decrypted keys from memory while they are unlocked
2. **Weak passphrases**: The encryption is only as strong as the passphrase used
3. **Configuration file exposure**: The config file contains sensitive data (JWT secret, optionally plaintext keys)
4. **Web UI access compromise**: An attacker with access to the web UI can approve signing requests (but not extract user keys)

## Production Recommendations

1. **Use HTTPS**: Set `baseUrl` to an HTTPS URL and use a reverse proxy (nginx, Caddy)
2. **Restrict origins**: Set `allowedOrigins` to only your UI domain(s)
3. **Secure the config file**: Restrict file permissions (`chmod 600 signet.json`)
4. **Use encrypted keys**: Always encrypt keys with strong passphrases
5. **Monitor logs**: Enable verbose logging and monitor for suspicious activity
6. **Restrict network access**: Use VPN, firewall rules, or reverse proxy authentication to limit access to the web UI
7. **Regular updates**: Keep Signet updated to receive security patches
8. **See [DEPLOYMENT.md](DEPLOYMENT.md)**: For specific setup guides (Tailscale, reverse proxies)
