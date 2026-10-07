# Browser compatibility checklist

Core use requires HTTPS, WebSocket, Web Crypto ECDH/HKDF/AES-GCM, Blob and standard file input. WebRTC is preferred but optional: live encrypted relay works when it is unavailable. There are no Bluetooth/NFC dependencies and no claim of browser-level LAN discovery.

| Capability | Chrome / Edge / Android Chromium | Firefox | Safari macOS / iPhone / iPad |
|---|---|---|---|
| Choose files | Standard input | Standard input | Native browser file/photo picker |
| Direct transfer | WebRTC, ICE/STUN/TURN | WebRTC, ICE/STUN/TURN | WebRTC, ICE/STUN/TURN |
| Relay | Secure WebSocket | Secure WebSocket | Secure WebSocket |
| Receive storage | OPFS; large-file save picker enhancement | OPFS when writable API exists; memory fallback | OPFS when writable API exists; memory fallback |
| Save received file | Explicit download / selected writer | Explicit download | Explicit Save file, browser manages storage |
| QR camera | On-demand camera + ZXing | On-demand camera + ZXing | playsInline muted video + ZXing; manual code fallback |
| Clipboard | Explicit copy, manual text selection fallback | Same | Same; user activation restrictions apply |
| Notifications | Permission requested in Settings | Same | Browser/installed-PWA dependent; in-app always works |
| Offline | Offline shell; no transfer claims | Same | Same |

Feature detection is used rather than pretending APIs exist. Initial phone/laptop label is only a viewport-based suggestion and can be renamed. Incoming files larger than 100 MiB require writable disk support and enough quota; failures are visible before acceptance. Browser storage capacity differs in private browsing and low-disk situations.

## Manual checks before launch

- Pair Chrome desktop ↔ physical iPhone Safari, Edge ↔ Chrome Android, Firefox ↔ Safari macOS, iPad Safari ↔ Samsung Internet. Check both sending and receiving directions.
- Accept/decline camera permission; switch to code; dismiss scanner and verify camera stops. Validate another-origin QR, malformed QR and expired code messages.
- Pick multiple images/videos/files, cancel picker, zero-byte file, non-ASCII names, HTML/SVG files, and files over memory fallback limit. Confirm inert download instead of preview.
- Test 320px, landscape, 200% text zoom, keyboard focus, VoiceOver/TalkBack, reduced motion, dark theme, safe areas and keyboard-open textarea/pairing layouts.
- Confirm no file/save success before final byte acknowledgment. Validate downloaded bytes. Do not infer save location on iOS.
- Background/lock/unlock devices mid-transfer: interruption must be shown; user can retry. Background delivery is not promised.
- Separate LANs, cellular NAT, corporate firewall, TURN-only path, relay-only path and server restart.
- Install from Android browser and Add to Home Screen on iOS; test offline launch, re-open online, and denied notifications.

Automated WebKit is useful but is not a substitute for Safari hardware/device testing. See VALIDATION.md for what has actually been executed.
