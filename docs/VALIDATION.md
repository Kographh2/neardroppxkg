# Validation record

## Vercel adapter and connection status — 2026-10-07

- Added a dynamic Next.js `/api/v1/[...path]` route backed by shared PostgreSQL state. The production build lists it as a dynamic route, not a static asset.
- 14 unit/API tests passed, including a real PostgreSQL engine (PGlite) in isolated memory: session authorization, origin checks, pairing confirmation/expiry, attempt limits, receiver-only completion, presence expiry, and replacement-session rejection. No production data was used.
- Two Chrome scenarios passed through the actual Next route handlers: an HTML 404 shows Server unavailable, manual retry recovers, actual browser offline/online events recover, and two guests pair and transfer a 262,153-byte file with identical SHA-256 after download.
- This validates local HTTP signaling and direct WebRTC. Managed TURN, live Vercel, physical mobile browsers, and live Supabase authentication remain unverified. HTTP mode does not implement the custom Node server's WebSocket file relay.
- Local DATABASE_URL is now configured, but its connection attempt returns ENOTFOUND, including outside the sandbox. No live database migration was run. The earlier notes below describe the prior environment and are not current configuration claims.
- Initial verification hit Windows memory allocation failures. PostgreSQL tests passed with the baseline WebAssembly compiler and sequential execution. A single-process Next test server passed browser tests; the production build passed using `NODE_OPTIONS=--max-old-space-size=4096 --max-semi-space-size=4`.

## Earlier validation — 2026-10-05–06

## Executed successfully

- Strict TypeScript (`npm run typecheck`).
- Next.js production compilation and route generation (`npm run build`).
- 11 Node unit/API tests (`npm test`): pairing randomness/normalization/expiration/confirmation, rate limits, relationship authorization, transfer state transitions, dangerous filename/URL handling, API schema bounds, acknowledged-byte progress, feature detection, real ECDH/HKDF/AES-GCM round-trip and tamper rejection, and relay sequence/role/size enforcement.
- Installed Google Chrome browser automation: six scenarios passed across the main suite and the added resilience test. Two separate browser contexts paired through the actual HTTP/WebSocket service.
- File downloaded from the receiver had the same SHA-256 as the original 262,153-byte binary fixture. Selected transport was verified as **direct**.
- Text contents and link destination verified after explicit receiver acceptance.
- WebRTC deliberately disabled on both clients: live encrypted relay completed, transfer details reported secure relay, sequential queue/decline worked, and closing the receiver marked the pending transfer interrupted.
- Zero-byte file and memory-sink fallback downloaded correctly. Cancellation and invalid-code error were verified.
- Initial registration network failure recovered automatically; guest mode remained functional with localStorage access blocked.
- Desktop 1440px, mobile 390px and narrow 320px route checks; dark mode; rename; keyboard skip link; dialog Escape; no horizontal overflow on reviewed routes. Browser `pageerror` collection was empty in the transfer and screen-review scenarios.
- Screenshots were visually reviewed for landing, desktop transfer and mobile light/dark surfaces. Preview images are local, ignored artifacts in `.data/previews/`.

## Environment issues and recovery

- Sandbox process spawning returned EPERM for the Node test runner; tests passed when run with the approved external execution permission.
- Port 3000 belongs to another local application. NearDrop browser tests use **3117**, without stopping the other application.
- Edge executable launch returned EPERM even under the approved test command. No Edge runtime success is claimed.
- Playwright Chromium/WebKit downloads failed repeatedly with timeout, ECONNRESET and DNS errors. The combined installer stopped before Firefox installation. Installed Chrome was usable; WebKit/Firefox execution is **not verified**.
- Next.js development cache encountered Windows disk-full error 112 after an otherwise passing suite. Only NearDrop generated caches were removed. Disk caching is disabled in `next.config.ts`; the subsequent five-scenario suite completed without that cache error.
- An initial mobile test was obstructed by Next.js's developer indicator; `devIndicators:false` removed the obstruction and the mobile scenario passed.
- A repeated-navigation test exposed rate limiting of already-registered devices. Registration now checks a valid matching existing session before counting a new-registration attempt; the full five-scenario suite then passed.

## Not yet verified in a production environment

- PostgreSQL migration/persistence against a live database, failover/recovery and backup restoration. DATABASE_URL is not configured locally. The development adapter is intentionally ephemeral.
- Supabase signup/verification/recovery emails, native callback setup and server-validated account trust against a real provider. Public Supabase configuration is absent locally; the UI says accounts are unavailable and offers guest mode.
- Live coturn credentials, blocked-UDP NAT traversal, cellular/corporate networks and sustained multi-gigabyte transfer throughput. Local direct WebRTC and forced live WebSocket relay are verified.
- Physical Safari/iPhone/iPad, Chrome Android, Samsung Internet and Firefox. WebKit source/fallback review does not prove device compatibility.
- Real camera permissions and optical QR scanning, OS download/save destinations, PWA installation and mobile notification delivery.
- Public HTTPS deployment and infrastructure load/abuse testing. No hosting credentials/domain were supplied or configured.

This is a working, tested local implementation with production deployment requirements documented. It is **not** a claim that every target browser, provider or production environment has passed acceptance testing.
