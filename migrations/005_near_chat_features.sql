BEGIN;
ALTER TABLE nc_profiles ADD COLUMN IF NOT EXISTS phone text UNIQUE;
ALTER TABLE nc_profiles ADD COLUMN IF NOT EXISTS avatar text;
ALTER TABLE nc_profiles ADD COLUMN IF NOT EXISTS about text NOT NULL DEFAULT 'Hey there! I am using NearChat.';
ALTER TABLE nc_profiles ADD COLUMN IF NOT EXISTS read_receipts boolean NOT NULL DEFAULT true;
ALTER TABLE nc_profiles ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS nc_numbers (
  phone text PRIMARY KEY,
  country text NOT NULL,
  owner_id uuid REFERENCES nc_profiles(id) ON DELETE SET NULL,
  reserved_for text,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz
);
CREATE INDEX IF NOT EXISTS nc_numbers_owner ON nc_numbers(owner_id);

CREATE TABLE IF NOT EXISTS nc_contacts (
  owner_id uuid NOT NULL REFERENCES nc_profiles(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES nc_profiles(id) ON DELETE CASCADE,
  alias text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id, contact_id),
  CHECK(owner_id <> contact_id)
);

CREATE TABLE IF NOT EXISTS nc_statuses (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES nc_profiles(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'text' CHECK(kind IN ('text','image')),
  body text NOT NULL,
  caption text NOT NULL DEFAULT '',
  bg text NOT NULL DEFAULT '#177d69',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours'
);
CREATE INDEX IF NOT EXISTS nc_statuses_user ON nc_statuses(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS nc_statuses_expiry ON nc_statuses(expires_at);

ALTER TABLE nc_messages ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'text';
ALTER TABLE nc_messages ADD COLUMN IF NOT EXISTS attachment text;
ALTER TABLE nc_messages ADD COLUMN IF NOT EXISTS reply_to uuid;
ALTER TABLE nc_messages ADD COLUMN IF NOT EXISTS forwarded boolean NOT NULL DEFAULT false;
ALTER TABLE nc_messages ADD COLUMN IF NOT EXISTS deleted boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS nc_calls (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES nc_rooms(id) ON DELETE CASCADE,
  caller_id uuid NOT NULL REFERENCES nc_profiles(id) ON DELETE CASCADE,
  callee_id uuid NOT NULL REFERENCES nc_profiles(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'audio',
  status text NOT NULL DEFAULT 'ringing',
  offer text,
  answer text,
  caller_ice jsonb NOT NULL DEFAULT '[]'::jsonb,
  callee_ice jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nc_calls_room ON nc_calls(room_id, created_at DESC);

ALTER TABLE nc_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE nc_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE nc_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE nc_calls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON nc_numbers,nc_contacts,nc_statuses,nc_calls FROM PUBLIC;
COMMIT;
