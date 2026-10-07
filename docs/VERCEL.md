# Vercel target: https://neardrops.vercel.app

The intended public web origin is `https://neardrops.vercel.app`. This is a web address, not a TURN endpoint. Do not set TURN_URLS to `turn:neardrops.vercel.app`.

## Configuration values for the intended deployment

```dotenv
APP_ORIGIN=https://neardrops.vercel.app
STUN_URLS=stun:stun.l.google.com:19302
TURN_URLS=
TURN_SECRET=
```

These values describe the production target; **they do not migrate the current backend to Vercel**. Keep local development APP_ORIGIN matching the local browser origin. Configure production values in Vercel's project environment settings rather than changing the local origin.

When Supabase Auth is configured, use:

- Site URL: `https://neardrops.vercel.app`
- Allowed redirect: `https://neardrops.vercel.app/auth/sign-in`
- Allowed recovery redirect: `https://neardrops.vercel.app/auth/reset-password`

DATABASE_URL and Supabase configuration still require actual services. TURN can remain unconfigured, but direct transfer and the existing fallback are usable only when an operational signaling/relay backend is present.

## Current code status

`npm start` runs `server/index.ts`, which owns the HTTP API, authenticated WebSocket upgrade, cleanup timers and live relay. `server/store.ts` holds pairing codes, tickets, relationships and active metadata in process memory, with PostgreSQL persistence for selected records. Live socket routing is also process-local.

A standard Next.js deployment does not expose these `/api/v1` handlers: they are intercepted by the custom server, not implemented as Next.js route handlers. Deploying the UI successfully is not proof that device registration, pairing or transfer works. No Vercel backend migration or deployment was performed when documenting this target.

## Available Vercel integration path

As checked on 2026-10-07, Vercel documents WebSocket support in beta with Fluid compute. Next.js can use `experimental_upgradeWebSocket()` from `@vercel/functions`. Connections have a Function duration limit, and different connections may reach different instances. Shared state and pub/sub must therefore live outside process memory. See [Vercel WebSockets](https://vercel.com/docs/functions/websockets) and [the distributed Next.js example](https://vercel.com/kb/guide/real-time-chat-websockets).

Required application changes before claiming Vercel compatibility:

1. Expose authenticated HTTP handlers through Next.js routes or a Vercel-compatible backend entry point.
2. Integrate the supported WebSocket upgrade API and preserve single-use ticket authentication and Origin validation.
3. Move ephemeral pairing, credential lookup, atomic transfer coordination, limits, presence and socket message routing to shared infrastructure. Independent in-memory Maps are insufficient.
4. Handle Function lifetime disconnections without claiming unfinished transfers completed. Long-file relay needs a compatible delivery/recovery design and runtime verification.
5. Validate actual two-device direct and fallback transfers on the deployed domain, plus email callbacks and database authorization.

This path does not require a self-managed VPS, but it does require the backend adaptation and configured managed services. Another option is Vercel for the UI with a separately hosted persistent backend; that would also require endpoint/authentication integration, not merely setting APP_ORIGIN.

## TURN is separate

Vercel WebSocket support is not a coturn service. TURN_URLS/TURN_SECRET come from an actual compatible TURN provider or a separately operated coturn server. A provider using API-issued username/password credentials may need an adapter instead of the current coturn shared-secret integration. No TURN service is provisioned by owning the Vercel domain.
