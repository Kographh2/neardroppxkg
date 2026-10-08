# Deploy NearDrop to Vercel

Public origin: **https://neardrops.vercel.app**.

## Configuration repair — 2026-10-08

The reported production failure had multiple causes: an HTTP APP_ORIGIN, a database URL pasted with a duplicated `DATABASE_URL=` prefix, the missing Supabase root CA, and the missing HTTP-signaling migration. These have been repaired in code and the local configuration. The configured live database now has both migrations; real registration, pairing and presence checks passed, with verification devices removed afterward.

- Production origin resolution accepts an explicit public HTTPS APP_ORIGIN, official Vercel system domains, or this project's fixed HTTPS default. It never builds the allowlist from a request Host/Origin header. Stale HTTP/localhost values no longer take the entire API down.
- Database URL loading accepts the URI or a copied dotenv assignment. `POSTGRES_URL` is supported when DATABASE_URL is absent.
- Supabase database/pooler connections use the official public CA bundled in `server/certificates/supabase-root.json`, with certificate and hostname verification enabled. `DATABASE_CA_CERT` can supply an updated provider CA. The certificate download source is defined by [Supabase Studio](https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json); this is a public certificate, not a private key.
- Database failures now distinguish missing/invalid URL, DNS, authentication, TLS, missing tables, and permissions. Configuration failures do not trigger endless automatic retries; use Try again after fixing them.

Deploy these new files to Vercel. Local `.env` corrections do not update the Vercel dashboard. The normalization and bundled CA also apply to existing deployed values after redeployment; keeping APP_ORIGIN set to `https://neardrops.vercel.app` and DATABASE_URL set to only its URI is still recommended.

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

The earlier ENOTFOUND diagnosis on 2026-10-07 was superseded by the 2026-10-08 configuration repair above. Deployment of the new code is a separate step from the now-completed live database migration.

References: [Supabase connection methods](https://supabase.com/docs/guides/database/connecting-to-postgres), [Vercel environment variables](https://vercel.com/docs/environment-variables).

## Transfers and network requirements

This Vercel mode carries control messages over authenticated HTTPS polling. Files, text, and links travel over an encrypted WebRTC DataChannel, directly or through a configured TURN service. File contents never enter PostgreSQL or Vercel request bodies. Per-chunk acknowledgements use the DataChannel; HTTPS stores periodic progress checkpoints.

**The custom Node server's live WebSocket file relay is not available in the Vercel HTTP mode.** If direct WebRTC fails and TURN is missing, the transfer fails with an explicit explanation. It never reports a fictional relay or successful transfer. Configuring TURN is necessary for reliable transfers across restrictive networks.

For a coturn REST-compatible managed service:

```dotenv
TURN_URLS=<provider supplied comma-separated TURN URLs>
TURN_SECRET=<provider supplied shared HMAC secret>
```

The Vercel domain is not a TURN server. The Cloudflare Realtime TURN adapter is implemented: set `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_API_TOKEN` in Vercel Production environment variables, then redeploy. Leave `TURN_URLS` and `TURN_SECRET` empty. NearDrop calls Cloudflare's credential endpoint server-side and supplies temporary credentials to the authenticated browser. Never use `NEXT_PUBLIC_` for these values. A 24-hour credential lifetime supports long transfers; transfers longer than that require a new connection. The coturn configuration above remains a fallback when Cloudflare is not configured.

See [Cloudflare credential setup](https://developers.cloudflare.com/realtime/turn/generate-credentials/) and `config/cloudflare.env.example`. Set both Cloudflare variables; a provider error is shown explicitly instead of reporting the device offline. TURN allows different networks and isolated Wi-Fi clients to communicate, subject to provider availability and network firewall policies.

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
