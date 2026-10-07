# Supported production topology

The selected web target is **https://neardrops.vercel.app**. Follow [the Vercel deployment guide](VERCEL.md) for the Next route adapter with PostgreSQL and HTTPS signaling. Direct/TURN WebRTC is supported there; the live WebSocket file relay belongs to the separate long-running Node deployment described below. Local validation is not confirmation of a live Vercel deployment.

```text
HTTPS reverse proxy (one public origin)
  └─ one long-running Node 24 NearDrop process
       ├─ Next.js UI
       ├─ /api/v1 HTTP + /realtime WebSocket (legacy /api/v1/events accepted)
       ├─ PostgreSQL metadata
       ├─ optional Supabase Auth
       └─ STUN / optional coturn (UDP/TCP/TLS reachability)
```

Do not deploy this custom server as Next.js serverless functions, a static export, or multiple replicas. The database does not coordinate live sockets. A graceful restart intentionally interrupts active transfers; clients reconnect and can retry.

Build with `npm ci && npm run build`. Run the private migration with `npm run db:migrate`. Start with `npm start`. Set secrets through the hosting environment, not source control. `NEXT_PUBLIC_SUPABASE_*` must exist at build time. Docker's build accepts these public values as arguments.

At the reverse proxy:

- Preserve WebSocket Upgrade and Connection headers and allow at least 75-second read timeouts.
- Forward Host and trusted X-Forwarded-For. If enabling TRUST_PROXY, overwrite rather than append untrusted inbound headers.
- Redirect HTTP to HTTPS; enable HSTS after HTTPS validation.
- Route every client to the one instance and allow `/api/v1/events` upgrades.
- Avoid logs containing query strings on `/api/v1/events`; the query contains an ephemeral ticket.
- Limit simultaneous anonymous connections and upstream request volume. Keep PostgreSQL private.
- Liveness: `/api/v1/health`. Add external monitoring for DB and email rather than treating liveness as full readiness.

For coturn REST credentials, use `use-auth-secret`, a strong `static-auth-secret` matching TURN_SECRET, correct realm/external IP, and UDP/TCP/TLS listening ports. Expose permitted relay port range in your firewall. Set TURN_URLS to comma-separated URLs such as `turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349?transport=tcp`. Credentials issued by NearDrop expire after one hour. Verify TURN across separate networks and with UDP blocked.

For Supabase:

1. Enable email confirmation and configure a real SMTP provider.
2. Add `https://your-domain/auth/sign-in` and `/auth/reset-password` to allowed redirects.
3. Use provider templates compatible with the JS client's PKCE flow. Test confirmation and password recovery in the browser initiating the flow; opening recovery links in another browser may require a token-hash callback implementation.
4. Enforce minimum password length 12 in the provider as well as the client.
5. Optionally host PostgreSQL on Supabase, but connect the server using a backend database role. Browser anon credentials must have no metadata-table grants.

No real provider is configured by the repository defaults. Public deployment, actual account emails, PostgreSQL persistence, and live TURN operation require those environments and runtime checks.
