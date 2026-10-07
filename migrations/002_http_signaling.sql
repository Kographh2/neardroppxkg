-- Shared serverless state. Application connections must use the database owner
-- (or a dedicated backend role); these tables have no public client policies.
BEGIN;
CREATE INDEX IF NOT EXISTS devices_session_hash ON devices ((data->>'tokenHash'));
CREATE TABLE IF NOT EXISTS nd_presence (
  device_id uuid PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  next_event bigint NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS nd_pairings (
  id uuid PRIMARY KEY, initiator_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  joiner_id uuid REFERENCES devices(id) ON DELETE CASCADE,
  code_hash text UNIQUE NOT NULL, expires_at timestamptz NOT NULL, status text NOT NULL
);
CREATE INDEX IF NOT EXISTS nd_pairings_initiator ON nd_pairings(initiator_id);
CREATE TABLE IF NOT EXISTS nd_events (
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  sequence bigint NOT NULL, data jsonb NOT NULL, expires_at timestamptz NOT NULL,
  PRIMARY KEY(device_id, sequence)
);
CREATE INDEX IF NOT EXISTS nd_events_expiry ON nd_events(expires_at);
CREATE TABLE IF NOT EXISTS nd_rate_limits (
  key text PRIMARY KEY, hits integer NOT NULL, expires_at timestamptz NOT NULL
);
ALTER TABLE nd_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE nd_pairings ENABLE ROW LEVEL SECURITY;
ALTER TABLE nd_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE nd_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON nd_presence, nd_pairings, nd_events, nd_rate_limits FROM PUBLIC;
-- Only control messages are stored here. File bytes never enter these tables.
COMMIT;
