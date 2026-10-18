-- Website bookings: people asking for a demo / meeting (face to face, Google Meet or phone call).
CREATE TABLE IF NOT EXISTS bookings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('in_person','video','phone')),
  name        text NOT NULL,
  school      text,
  email       text NOT NULL,
  phone       text,
  message     text,
  status      text NOT NULL DEFAULT 'new' CHECK (status IN ('new','confirmed','declined','done','cancelled')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- Two people can never hold the same time.
CREATE UNIQUE INDEX IF NOT EXISTS bookings_one_per_slot ON bookings (starts_at) WHERE status IN ('new','confirmed');
