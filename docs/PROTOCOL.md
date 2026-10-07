# NearDrop wire protocol v1

The protocol is independent of Next.js, DOM APIs and browser user-agent strings. Android clients use this same contract, not a separate backend. Runtime schemas are in `src/shared/protocol.ts`. Breaking changes require a new API version.

## Authentication and device identity

Generate an ECDH P-256 key pair on the client. Register `{name, type, publicKey}` at `POST /api/v1/devices/register`. `publicKey` is JWK `{kty:"EC", crv:"P-256", x, y}` with base64url coordinates. Private keys never go to the server. Android should keep private material and session tokens in platform-backed secure storage. Web persists identity locally; clearing browser storage creates a new device.

Valid types: `desktop`, `laptop`, `phone`, `tablet`, `android`, `unknown`. Names are user-editable, 1–48 characters. Type is a hint for display, never authorization. Web's initial type is a conservative viewport hint, not fingerprinting or authoritative hardware identification.

Browser registration sets a random 256-bit HttpOnly, SameSite=Strict cookie, with Secure on HTTPS. Native registration includes `X-NearDrop-Client: native` and receives a bearer `token`; subsequent HTTP requests use `Authorization: Bearer <token>`. Native requests have no browser Origin. All write requests require JSON. Browser Origin must equal the configured public origin; the server does not enable cross-origin browser API access. Device sessions expire after 30 days.

`POST /auth/associate {accessToken}` verifies a Supabase access token by calling the provider's user endpoint and requires confirmed email. A device cannot silently switch account. Sign out first. `POST /auth/sign-out {}` expires the device session and removes relationships/trust. Native apps should use Supabase's native OAuth/email session support with their own verified redirect scheme.

## HTTP surface (prefix `/api/v1`)

| Method | Path | Body / response |
|---|---|---|
| GET | `/health` | Liveness, version, persistent-state configuration |
| POST | `/devices/register` | `{name,type,publicKey}` → `{device,token?}` |
| GET | `/devices` | Current device and explicitly paired devices only |
| PATCH | `/devices/:ownId` | `{name}` |
| DELETE | `/devices/:peerId` | `{}`; remove relationship and its trust; cancel active transfer |
| POST | `/devices/:peerId/trust` | `{trusted:boolean}`; same verified account required |
| POST | `/pairing/create` | `{}` → `{id,code,expiresAt}` |
| POST | `/pairing/join` | `{code}` → pending `{id,device}` |
| POST | `/pairing/confirm` | `{id}`; only code owner can approve |
| POST | `/pairing/reject` | `{id}`; only code owner can decline |
| POST | `/ws-ticket` | `{}` → one-use `{ticket}`, valid 30 seconds |
| GET | `/ice` | Short-lived `{iceServers}`; never static TURN secret |
| POST | `/transfers` | `{receiverId,item:{name,size,mime,kind}}` → `{transfer}` |
| GET | `/transfers/:id` | Participant-only `{transfer}` |
| POST | `/transfers/:id/accept` | `{}`; receiver only, waiting state only |
| POST | `/transfers/:id/reject` | `{}`; receiver only, waiting state only |
| POST | `/transfers/:id/cancel` | `{}`; either participant, nonterminal only |
| GET | `/transfer-history` | Up to 100 metadata records for device / same-account owned devices |

JSON errors: `{error:"Human-readable message"}` with meaningful HTTP 400/401/403/404/409/413/415/429/500 status. Metadata filenames are sanitized, active content is never rendered. `kind`: `file`, `text`, `link`; maximum 8 GiB file, 64 KiB UTF-8 text/link.

## Pairing

Codes use six cryptographically random symbols from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. Hashes, not raw codes, are held in server memory. Hyphens and spaces are ignored; codes expire after five minutes. Each open code can join once and becomes pending; only the initiator can approve. A code alone never establishes a relationship. Per-IP and per-device attempt limits apply. QR contains `https://origin/connect#code=ABCDEF`; the fragment is not part of HTTP requests and is removed from browser history on reading.

Pairings deliberately do not survive server restarts. Approved relationships do survive with PostgreSQL. Trust is directional, server-owned, and only available when both devices share a verified account. Trust does not bypass transfer consent in v1.

## WebSocket

Connect to `wss://origin/api/v1/events?ticket=...`; the ticket is one use and expires in 30 seconds. Do not log query strings in proxies. Browser Origin is checked. One active socket per device; a second tab replaces the first with close code 4001. Normal reconnection uses a fresh ticket and bounded exponential backoff. WebSocket ping/pong detects dead sockets.

Server events:

- `ready {device,devices,transfers,requests}`: authoritative state snapshot.
- `devices {devices}`: paired presence snapshot.
- `pairing.request {id,device,expiresAt}`, `pairing.accepted {device}`, `pairing.rejected {id}`.
- `transfer.updated {transfer}`: authoritative metadata/state. Client progress is derived separately from acknowledgements.
- `error {message}`, `pong`.

Client events (also forwarded to authorized participant where relevant):

```json
{"type":"signal","transferId":"uuid","description":{"type":"offer","sdp":"..."}}
{"type":"signal","transferId":"uuid","candidate":{"candidate":"...","sdpMid":"0","sdpMLineIndex":0}}
{"type":"transfer.transport","transferId":"uuid","transport":"direct"}
{"type":"transfer.chunk","transferId":"uuid","sequence":0,"data":"base64 ciphertext and GCM tag"}
{"type":"transfer.ack","transferId":"uuid","sequence":0,"bytes":16384}
{"type":"transfer.end","transferId":"uuid"}
{"type":"transfer.complete","transferId":"uuid"}
{"type":"transfer.fail","transferId":"uuid","reason":"Transfer interrupted"}
{"type":"ping"}
```

Only participants of an approved relationship can signal after receiver acceptance. A sender selects `direct`, `turn` or `relay` once. Channel label is `neardrop-v1`, reliable/ordered. `signal` SDP types are `offer` and `answer`. ICE candidates may arrive before remote SDP; queue them until SDP is set. Sender negotiates for up to eight seconds, then closes the attempt and selects WebSocket relay. No automatic mid-file transport switch or byte-range resume: failure means retry with a new transfer UUID.

## Chunk framing and encryption

1. Derive 256-bit ECDH shared secret from local private key and registered peer public key.
2. HKDF-SHA256: input key material = shared secret; salt = UTF-8 transfer UUID (canonical lowercase with hyphens); info = UTF-8 `neardrop-v1`; output = 32-byte AES-GCM key.
3. Split source into chunks of **16,384 bytes**, final chunk may be shorter. Empty files have no chunks.
4. Each chunk uses AES-256-GCM with a 128-bit authentication tag. IV = 12 bytes: eight zero bytes followed by unsigned 32-bit sequence number in network/big-endian order. AAD = UTF-8 transfer UUID. Base64 standard (not base64url) encoding of ciphertext followed by tag.
5. Never reuse transfer UUID/key/sequence for different content. Retry creates a new UUID. 8 GiB cap is far below the 32-bit sequence limit.
6. Send one chunk and await its acknowledgment. Receiver requires exact next sequence, verifies authenticated decryption and expected length, writes to its sink, then acknowledges cumulative plaintext bytes. Acknowledgment travels over signaling in v1, including for direct transfers. This is bounded backpressure, with a throughput tradeoff on high-RTT paths.
7. For direct/TURN, chunk envelopes are JSON strings over the ordered DataChannel. For WebSocket relay, identical envelopes pass through the server. The server checks sender identity, status, exact ciphertext length, sequence and ack window; it does not decrypt or persist them.
8. After the last acknowledgement, sender emits `transfer.end` over signaling. Receiver checks exact final byte count, finalizes its sink, then sends `transfer.complete`. Only this receiver event permits server completion, and server cumulative bytes must match declared size.

No plaintext file hash is published. AES-GCM validates each chunk; exact count and sequence validate assembly. Browser tests independently compare source/download SHA-256 as an end-to-end correctness check.

## Transfer state machine

`queued` is client-local. Server flow: `waiting → preparing → transferring → completed`, with `connecting` reserved for client transport setup. `waiting → rejected`; any nonterminal state may become `cancelled` or `failed`. Terminal states cannot become completed later. A disconnected participant or a two-minute progress/acceptance timeout fails unfinished transfers. No pause or resume controls are implemented.

Android must implement the same acceptance, ordering, authenticated decryption and finalization checks. Android storage APIs replace browser sinks; transport and metadata stay the same. Android background service/notification permission behavior is a separate future client concern.
