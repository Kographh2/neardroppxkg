# NearChat

Independent application module inside NearSpace. UI: `/near-chat`, API:
`/api/near-chat/*`. NearDrop's guest pairing and private-code chat are separate.

Implemented: Supabase email signup/verification, login and password reset;
account profile and unique username; direct and group conversations; paginated
text history; unread counts; idempotent sending; group leave/delete with confirmation;
desktop QR/code login approved from an authenticated device; linked-device revocation;
responsive desktop/mobile UI and light/dark themes. No voice/video calls or chat
file attachments are exposed. Files remain available in NearDrop.

Apply migration `004_near_chat.sql`. Database tables are server-only with RLS and
no public grants/policies. Use `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` in both local and Vercel build environments. Add
`https://neardrops.vercel.app/near-chat` and
`https://neardrops.vercel.app/near-chat?recovery=1` to Supabase Auth redirect allowlist.
Configure production SMTP in Supabase for reliable verification/reset delivery.
Mail delivery and real account login need validation with an account you control.

The server validates Supabase access tokens using `/auth/v1/user`, requires a verified
email, and issues an independent 30-day HttpOnly, SameSite=Strict cookie. Database
stores only its token hash. Supabase auth passwords are never handled by NearChat's
server. Sessions can be revoked individually; password reset does not automatically
revoke these independent sessions, so revoke any lost/untrusted device explicitly.

QR codes expire after five minutes. Creating a challenge sets a separate HttpOnly
polling secret; knowing the visible QR/code cannot consume a login. Authenticated
phone users preview the destination and explicitly approve. Polling atomically
consumes the approved challenge and creates the desktop cookie. This is device
linking, not account registration. CSRF origin checks, rate limits and room membership
checks apply server-side. Exact usernames are used; no public email directory.

As explicitly chosen, messages are normal account-protected chat, **not end-to-end
encrypted**. They are stored as readable text in PostgreSQL over TLS. Authorized
backend/database administrators can access them. HTML is rendered as inert text.
Messages remain until the group owner deletes the group; account-wide data export
and deletion are not implemented. UI labels report server acceptance, not unverified
delivery/read receipts. Foreground HTTPS polling works with Vercel; background mobile
delivery and push notifications are not claimed.

API contracts live in `shared.ts`; business logic in `server.ts`, with page wrappers
in `src/app/near-chat` and `src/app/api/near-chat`. The API is intentionally separate
from NearDrop's `/api/v1` device protocol. Tests use isolated PostgreSQL and controlled
auth-provider fixtures, never fake production users.
