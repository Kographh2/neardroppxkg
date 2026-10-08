BEGIN;
CREATE TABLE IF NOT EXISTS nd_chat_keys (
  device_id uuid PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  public_key jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS nd_chat_messages (
  id uuid PRIMARY KEY,
  sender_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  receiver_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
  CHECK(sender_id <> receiver_id)
);
CREATE INDEX IF NOT EXISTS nd_chat_conversation ON nd_chat_messages(sender_id,receiver_id,created_at DESC);
CREATE INDEX IF NOT EXISTS nd_chat_expiry ON nd_chat_messages(expires_at);
ALTER TABLE nd_chat_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE nd_chat_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON nd_chat_keys, nd_chat_messages FROM PUBLIC;
COMMIT;
