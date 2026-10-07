# Security model

## Boundaries

- Device credentials: cryptographically random bearer material, stored server-side only as SHA-256. Browser cookies are HttpOnly, SameSite=Strict, Secure in production. Native bearer tokens belong in Android Keystore-backed storage.
- Pairing: code lookup is rate limited by device and trusted-proxy-aware IP; five-minute expiration, single join, explicit host approval, no ambient “nearby” discovery.
- Transfer authorization: approved device relationship + authenticated session + participant role + active transfer state. Receiver consent precedes signaling/content. Same-account identity does not itself grant a transfer.
- Encryption: ECDH P-256 + HKDF-SHA256 + AES-256-GCM for every content chunk, including direct transfer. WebRTC adds DTLS. HTTPS/WSS protect platform metadata. The signaling server remains a trusted key directory; this version does not provide independently verified device key fingerprints or server-compromise-resistant identity binding.
- Resource limits: request body 64 KiB, socket message 64 KiB, 32 pending messages/socket, 1 MiB socket output high-water cutoff, one active transfer per participating device, 100 items in a browser queue, 8 GiB file cap, 64 KiB text, 100 MiB memory fallback. Pairings/tickets/limits are periodically swept. Process capacity is capped at 10,000 registered live identities.
- Content: filenames are stripped of path separators/control/bidi characters; MIME is untrusted. File blobs use `application/octet-stream`; text is displayed in a read-only textarea; links permit only HTTP(S), have `noopener noreferrer`, and require a user click.
- CSRF: browser mutation Origin must exactly match `APP_ORIGIN`, JSON content type required, no credentialed CORS. Native header is allowed only without Origin; browser cross-site requests using custom headers require a preflight the server does not approve.
- WebSocket: short-lived, single-use tickets, Origin validation, authenticated participant routing, schema validation, heartbeat, rate limits, bounded pending/output buffers. Reverse proxy logs must omit ticket query strings.
- Database: private tables with RLS enabled and no anon/authenticated policies. Only a narrowly provisioned backend role accesses them; never expose DATABASE_URL or TURN_SECRET. Queries are parameterized. Do not point the browser's Supabase client at metadata tables.
- Browser security headers: CSP, no framing, nosniff, referrer suppression and limited camera permission policy. Next.js inline hydration currently requires `unsafe-inline`; nonce-based CSP is a deployment hardening opportunity. No user HTML or external scripts are rendered.

## Operational requirements

Use a maintained Node LTS release, HTTPS with HSTS at the proxy, exact Origin config, private PostgreSQL networking/TLS, protected database backups, secret rotation, and an upstream abuse/connection limiter. Set `TRUST_PROXY=true` only when a trusted proxy overwrites `X-Forwarded-For`. Do not deploy multiple independent workers behind a load balancer: in-memory authorization/presence/rate-limit state is instance-local.

HTTP liveness does not prove TURN, email or database recoverability. Exercise backups, database failure, restart interruption, provider email flows and actual mobile network paths before a public launch. Keep infrastructure access logs free of auth headers, cookies, signed tickets and payloads. Metadata includes potentially sensitive filenames and should be subject to the same access controls as account data.

## Intentional limits

This is a single-instance platform. PostgreSQL persists device/relationship/history metadata, while pairing/tickets and live transfer transport stay in process. Horizontal scale requires a shared short-TTL coordination/rate-limit store and a pub/sub relay router. File-byte storage and temporary public object URLs do not exist in v1.

Device trust persists server-side but always-ask remains mandatory. Account-level remote wiping, account deletion/export, independent device key verification, and device credential revocation from a remote unpaired device are not provided in the UI. Removing a paired device revokes that relationship, not its independent session on its own device. Local history clearing hides metadata on this browser; 30-day server retention still applies.
