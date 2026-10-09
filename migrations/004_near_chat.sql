BEGIN;
CREATE TABLE IF NOT EXISTS nc_profiles (
 id uuid PRIMARY KEY, username text UNIQUE NOT NULL, display_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS nc_sessions (
 id uuid PRIMARY KEY, token_hash text UNIQUE NOT NULL, user_id uuid NOT NULL REFERENCES nc_profiles(id) ON DELETE CASCADE,
 name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS nc_links (
 id uuid PRIMARY KEY, code_hash text UNIQUE NOT NULL, poll_hash text NOT NULL,
 name text NOT NULL, user_id uuid REFERENCES nc_profiles(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL, consumed boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS nc_rooms (
 id uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('direct','group')), name text NOT NULL,
 owner_id uuid NOT NULL REFERENCES nc_profiles(id), direct_key text UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS nc_members (
 room_id uuid NOT NULL REFERENCES nc_rooms(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES nc_profiles(id) ON DELETE CASCADE,
 last_read bigint NOT NULL DEFAULT 0, PRIMARY KEY(room_id,user_id)
);
CREATE TABLE IF NOT EXISTS nc_messages (
 id uuid PRIMARY KEY, room_id uuid NOT NULL REFERENCES nc_rooms(id) ON DELETE CASCADE,
 sender_id uuid NOT NULL REFERENCES nc_profiles(id), body text NOT NULL,
 sequence bigserial UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nc_messages_room ON nc_messages(room_id,sequence DESC);
CREATE INDEX IF NOT EXISTS nc_members_user ON nc_members(user_id);
CREATE INDEX IF NOT EXISTS nc_sessions_expiry ON nc_sessions(expires_at);
CREATE INDEX IF NOT EXISTS nc_links_expiry ON nc_links(expires_at);
ALTER TABLE nc_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE nc_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE nc_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE nc_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE nc_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE nc_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON nc_profiles,nc_sessions,nc_links,nc_rooms,nc_members,nc_messages FROM PUBLIC;
COMMIT;
