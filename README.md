# NearDrop

**Open. Connect. Drop. Done.** A Next.js web client and a separate, versioned Node.js transfer platform. Guest pairing and encrypted file/text/link transfers work without an account. Android can implement the same HTTP, WebSocket, WebRTC, and chunk protocol.

## Run locally

Node.js 24 LTS and npm are required.

```powershell
npm.cmd install
# Copy only if you do not already have a .env file:
Copy-Item .env.example .env
npm.cmd run dev
```

Open `http://localhost:3000`. For a two-device test, **both devices must use the same HTTPS public origin**. `http://localhost` is a browser secure-context exception; a phone accessing a laptop over a plain HTTP LAN address is not. Configure `APP_ORIGIN` to the exact public HTTPS origin, then restart the server. No automatic LAN discovery is claimed.

Port already in use? Set both `PORT` and `APP_ORIGIN` to the new port/origin. Browser test scripts use port 3117 independently.

## Features

- Random five-minute pairing codes, QR creation, camera QR scanning, and manual code fallback.
- Host approval of every pairing, receiver approval of every item, server-validated device relationships.
- WebRTC DataChannel with STUN, short-lived TURN credentials when configured, and application-encrypted live WebSocket relay fallback.
- 16 KiB chunks; one unacknowledged chunk at a time; AES-256-GCM authentication, strict order/size verification, actual acknowledged-byte progress, cancellation and retry.
- Sequential multiple-file queue; text and safe HTTP(S) link transfer; explicit save/copy/open actions.
- Private browser disk storage (OPFS), direct file writer enhancement, bounded 100 MiB memory fallback. Files up to 8 GiB subject to receiver quota/browser support.
- Light/dark responsive interface, keyboard-accessible native dialogs, mobile sheets, reduced motion, locally hosted Inter, and an installable PWA with an honest offline page.
- Optional Supabase email sign-up, verification, sign-in, reset and sign-out. Account association is verified server-side. Trust requires the same verified account on both paired devices.
- PostgreSQL metadata persistence in production, 30-day retention, and Android interoperability documentation.

## Verification

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npx.cmd playwright install chromium firefox webkit
npm.cmd run test:e2e -- --project=chromium --project=firefox --project=webkit
```

Optional installed-browser projects: `--project=chrome` and `--project=edge`. E2E scenarios pair isolated browser contexts, compare received file SHA-256, transfer text/links, force encrypted relay, exercise queue/decline/interruption, and check mobile width, rename and dark theme. Browser engines in Playwright do **not** replace validation on physical iPhones, iPads or Android devices.

See [validation notes](docs/VALIDATION.md) for actual results and remaining deployment checks. A successful build is not evidence of live TURN, database or email-provider operation.

## Production setup

1. Provision PostgreSQL and set `DATABASE_URL`. Run `npm.cmd run db:migrate` using a migration role. The platform backend requires an owner/BYPASSRLS role with privileges on its private tables; **never expose that credential to clients**. Supabase anon clients cannot access the metadata tables: RLS is enabled with no public policies. The browser uses the versioned API.
2. Configure a public HTTPS reverse proxy with WebSocket upgrades and `APP_ORIGIN=https://your-domain`. Deploy **one platform instance**. See [deployment](docs/DEPLOYMENT.md) for the supported topology and scaling boundary.
3. Configure TURN URLs and a coturn REST secret for restrictive networks. Without TURN, failed direct connections use encrypted WebSocket relay. The relay requires both clients to stay connected and does not store files.
4. Optionally configure Supabase public URL/key, email delivery, email confirmation, PKCE-compatible templates, redirect allowlist, and a minimum 12-character password policy. Build after changing `NEXT_PUBLIC_*` values. Accounts are visibly unavailable until configured; guest transfer remains functional.
5. Run the tests, build, then `npm.cmd start`. Production intentionally refuses to start without PostgreSQL and HTTPS origin.

## Architecture

```text
src/app + src/components          Presentation and accessible browser interactions
src/lib/platform-client.ts       Application session, queue, external stores
src/transfer/                    Crypto, capabilities, receive sinks, transfer engine
src/shared/protocol.ts           Versioned schemas, metadata, state vocabulary
server/platform.ts              HTTP authorization, pairing, signaling, relay routing
server/store.ts                  PostgreSQL metadata / ephemeral development adapter
migrations/                     Private server-owned schema
docs/PROTOCOL.md                 Android-compatible wire and crypto specification
```

The custom Node server hosts Next.js, `/api/v1`, and WebSocket upgrades on one origin. Do not replace it with `next start` or deploy it as stateless functions. Essential transfer logic is outside React components.

## Privacy and limits

Files are encrypted before transmission. AES-GCM keys derive from ECDH device keys through HKDF. The signaling service is trusted to authenticate/exchange keys; this is **not a claim of end-to-end protection against a compromised signaling server**. There is no analytics, invasive fingerprinting, active-content preview or automatic URL opening.

The server stores metadata only. Relay payloads are bounded, in-memory, live forwards. Received disk data stays in private browser storage until dismissed; stale data is removed on a subsequent application start after 24 hours. Save desired files before closing the browser. A completed transfer does not mean “saved to Downloads.”

No pause, byte-range resume, background mobile delivery, cross-session clipboard sync or automatic trust acceptance is advertised. If the network fails, retry starts a new transfer with a new key/nonce space. A tab or server restart interrupts active transfers. With no database configured, development state resets on server restart. Transfer throughput is intentionally constrained by a one-chunk acknowledgment window; do not market LAN line-rate performance.

See [security and threat model](docs/SECURITY.md), [wire protocol](docs/PROTOCOL.md), and [browser checklist](docs/BROWSER-SUPPORT.md).
