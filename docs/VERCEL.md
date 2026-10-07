# Deploy NearDrop to Vercel

Public origin: **https://neardrops.vercel.app**.

The Next.js route at `src/app/api/v1/[...path]/route.ts` now serves the API on Vercel. Registration, pairing, presence, rate limits, signaling messages, and transfer metadata use PostgreSQL shared state. No VPS or persistent Node process is required for this deployment mode.

## Fix the current deployment

1. In Supabase, open **Connect → Transaction pooler** and copy the complete connection string. Use the actual database password, percent-encoding reserved characters. Do not guess the pooler hostname. This is different from the Supabase project URL and anon key.
2. In **Vercel → Project → Settings → Environment Variables**, configure Production:

   ```dotenv
   APP_ORIGIN=https://neardrops.vercel.app
   DATABASE_URL=<actual PostgreSQL transaction-pooler connection string>
   STUN_URLS=stun:stun.l.google.com:19302
   ```

   Keep DATABASE_URL server-only. The placeholder above is not a working value. Set `DATABASE_SSL=true` when required by your database provider, with a valid trusted certificate. Never disable certificate verification to conceal a connection error.
3. Run `migrations/001_platform.sql`, then `migrations/002_http_signaling.sql` in Supabase SQL Editor. Alternatively, with a working database connection configured locally, run `npm run db:migrate`. Both migrations are additive and repeatable. Use the backend database owner (or a provisioned backend role with the necessary access); public browser roles have no table policies.
4. Push this code and **redeploy** the Vercel project using the **Next.js** preset and `npm run build`. Do not use a static export. Environment-variable changes apply to new deployments.
5. Open `https://neardrops.vercel.app/api/v1/health`. Expect JSON containing `status: "ok"`, `persistent: true`, and `signaling: "http"`. A 503 means the route exists but database/origin setup is incomplete. A 404 means the new API route has not been deployed.
6. Open `/drop` and press **Try again** if necessary. Test pairing on two devices, accept a file, and compare the received file. The online label appears only after the server session handshake succeeds.

For the configuration inspected locally on 2026-10-07, the database connection failed with `ENOTFOUND`. Its hostname could not be resolved from this machine; the correct production credentials and Supabase project status still need verification. No production database migration or deployment was performed by the local tests.

References: [Supabase connection methods](https://supabase.com/docs/guides/database/connecting-to-postgres), [Vercel environment variables](https://vercel.com/docs/environment-variables).

## Transfers and network requirements

This Vercel mode carries control messages over authenticated HTTPS polling. Files, text, and links travel over an encrypted WebRTC DataChannel, directly or through a configured TURN service. File contents never enter PostgreSQL or Vercel request bodies. Per-chunk acknowledgements use the DataChannel; HTTPS stores periodic progress checkpoints.

**The custom Node server's live WebSocket file relay is not available in the Vercel HTTP mode.** If direct WebRTC fails and TURN is missing, the transfer fails with an explicit explanation. It never reports a fictional relay or successful transfer. Configuring TURN is necessary for reliable transfers across restrictive networks.

For a coturn REST-compatible managed service:

```dotenv
TURN_URLS=<provider supplied comma-separated TURN URLs>
TURN_SECRET=<provider supplied shared HMAC secret>
```

The Vercel domain is not a TURN server. Some providers issue username/password credentials through their own API instead; those require a provider adapter, not copying an API token into TURN_SECRET. The secret stays on the server and only short-lived credentials reach the client.

Both clients must remain open. Reconnection starts a fresh control session and interrupts unfinished transfers; Retry sends the file from the beginning. Presence expires after 45 seconds without a poll. Only one tab may control a device session.

Polling has database/function costs and is intended for an initial deployment. Place the database and Vercel function in nearby regions and monitor connection limits. This implementation does not claim high-concurrency load validation. Do not point the custom Node server and Vercel HTTP mode at the same live device sessions: their signaling modes are distinct deployments.

## Optional accounts

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel, then configure Supabase Auth:

- Site URL: `https://neardrops.vercel.app`
- Sign-in redirect: `https://neardrops.vercel.app/auth/sign-in`
- Recovery redirect: `https://neardrops.vercel.app/auth/reset-password`

Guest pairing does not require accounts, but it does require the working database and API. `SUPABASE_SERVICE_ROLE_KEY` is not used by this HTTP adapter.

## Interpreting connection errors

- **You’re offline**: the browser reports no network connection.
- **Server unavailable**: a backend/network request failed while the browser still reports connectivity. Read the accompanying error and retry.
- **404 on registration**: deployment is missing the API route; repeated requests cannot fix it.
- **503**: check database connectivity, migrations, and APP_ORIGIN.
- **ERR_NAME_NOT_RESOLVED / ERR_ADDRESS_UNREACHABLE / ERR_NETWORK_CHANGED**: browser or network-level failures can also affect page assets. The application cannot repair DNS or routing, but it can recover when connectivity returns.

Use `node scripts/check-database.mjs` for a credential-safe database connectivity check. Local `.env` values are not automatically copied into Vercel settings.
