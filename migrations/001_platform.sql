BEGIN;
CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY,
  user_id uuid,
  expires_at timestamptz NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS devices_user ON devices(user_id);
CREATE TABLE IF NOT EXISTS device_relationships (
  id text PRIMARY KEY,
  device_a uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  device_b uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  data jsonb NOT NULL,
  CHECK(device_a <> device_b)
);
CREATE TABLE IF NOT EXISTS transfer_sessions (
  id uuid PRIMARY KEY,
  sender_id uuid NOT NULL,
  receiver_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS transfers_sender ON transfer_sessions(sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transfers_receiver ON transfer_sessions(receiver_id, created_at DESC);
-- These tables are accessed ONLY by the backend database role. No public policies.
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfer_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON devices, device_relationships, transfer_sessions FROM PUBLIC;
COMMIT;
