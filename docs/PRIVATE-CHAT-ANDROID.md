# Private chat and Android releases

## Private chat v1

Pair devices first. Both devices set their own private passphrase (12–200 characters).
Each browser generates a separate P-256 chat identity. The private JWK is encrypted
locally with AES-256-GCM using a PBKDF2-SHA256 key (600,000 iterations, random
16-byte salt, random 12-byte IV). Only this encrypted vault is persisted in localStorage.
The transfer identity is never used to bypass the private chat passphrase.

Messages use P-256 ECDH, HKDF-SHA256 and AES-256-GCM. The HKDF salt and authenticated
data are UTF-8 `neardrop-chat-v1:<message UUID>:<sender UUID>:<receiver UUID>`;
HKDF info is `neardrop-v1`. Each message has a random 12-byte IV. Ciphertext is
base64, including the 128-bit authentication tag. Android can implement the same contract.

The message list shows the first 24 ciphertext bytes in binary, never a reversible
character substitution or plaintext preview. Each popup requires the code again;
it closes on blur, hidden tab, manual close, or after 60 seconds. Replies are outside
the popup. Sending also requires the sender's own code. Changing the code rewraps
the existing private key, so existing messages remain readable. No automatic daily
rotation: this release uses the user's personally configured code option.

The server stores ciphertext and routing metadata for 7 days. Expired records are
immediately excluded from reads and physically deleted on the next chat API request.
Only the latest 100 messages are listed. Browser storage loss or a forgotten passphrase
cannot be recovered. Keep the code privately in a password manager. No plaintext is
included in notifications. A compromised browser, malicious extension or compromised
web deployment can still access plaintext while a message is open. This is not an
audited secure messenger and does not provide forward secrecy. Public-key distribution
currently trusts the authenticated NearDrop server and confirmed device pairing.

API (same secure device cookie / native bearer authentication and CSRF rules):

- `POST /api/v1/chat/key { publicKey }`: immutable per-device public key; repeat is idempotent.
- `GET /api/v1/chat/messages?peer=<uuid>`: paired participant only; `{peerKey,messages}`.
- `POST /api/v1/chat/messages`: strict `ChatEnvelope` in `src/shared/chat.ts`; server
  validates both registered keys and relationship, adds sender ID and timestamp.
  Message UUID makes retries idempotent. Maximum encrypted payload 24,000 base64 characters.

Apply `003_private_chat.sql` using `npm run db:migrate`. PostgreSQL is required for
chat, including on the custom Node deployment; the ephemeral test-only Node mode does
not provide chat storage. Public database access is revoked; RLS enabled, backend role only.

## Publish Android versions

Put an actual signed release APK in `public/android/releases/neardrop-1.0.0.apk`.
Keep older APKs under their versioned filenames. `npm run build` generates the
download catalog from these files, with size and SHA-256. `/android` sorts versions
numerically and labels the newest Latest; no APK means an honest Coming soon state.
For local development run `node scripts/android-releases.mjs` after adding APKs.
The repository contains no APK or native application yet. The catalog validates ZIP
magic, not Android signing; validate release signatures with Android apksigner before
publishing. Every upgrade must retain the package ID and signing identity. Large APKs
should be hosted in a release/object store before exceeding Git/provider size limits.

## Bluetooth mesh scope

Browser Web Bluetooth is a BLE GATT client API, not a cross-browser background mesh
router. NearDrop Web does not claim Bluetooth mesh support. Native Android work needs
an explicit discovery/advertising design, permissions, foreground service, bounded
store-and-forward queues, hop limits, replay protection, message expiry and per-hop
consent. End-to-end ciphertext must remain opaque to intermediary devices. Large file
transfer should prefer Wi-Fi/internet; Bluetooth mesh throughput is a separate native
engineering project and cannot be enabled by a web UI switch.
