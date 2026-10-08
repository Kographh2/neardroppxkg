# Unreleased — reliable connections and private chat

- Give WebRTC negotiation a 60-second budget, including slow HTTPS signaling. The
  public-site regression showed three sequential signal requests taking roughly
  3–5 seconds each, exceeding the old 8-second budget before the answer arrived.
- Ignore authorized late events for terminal transfers; a late ICE candidate no
  longer tears down a device's HTTP signaling session.
- Pipeline at most 16 encrypted 16-KiB chunks on HTTP deployments. Receiver ACKs
  reflect writes, memory stays bounded, periodic server checkpoints no longer block
  each chunk, and the final checkpoint must commit before completion.
- Cloudflare Realtime TURN adapter for cross-network connections, with server-only
  configuration and temporary credentials. Requires real provider credentials.
- Add private chat: separate encrypted local keys, personal passphrase, ciphertext
  list, per-message unlock popup and seven-day server ciphertext retention.
- Add application folder on landing and Android release catalog at `/android`.
  No APK is bundled; signed APKs go in `public/android/releases/`.

Validation: production build, 26 unit/API/cryptography tests and strict TypeScript passed. All three
Chrome/Next API scenarios passed after freeing host memory, including a 9-second
SDP delay, a 2-MiB + 9-byte file with matching SHA-256, chat setup on two isolated
devices, wrong-code rejection, unlock/relock, and a 320px viewport overflow check.
Cloudflare credential generation succeeded using the configured real provider;
this alone is not proof of a TURN-routed file transfer. Public deployment and
forced-TURN verification are recorded separately once performed.
