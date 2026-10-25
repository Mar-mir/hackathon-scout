-- Hackathon Scout D1 schema
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  organizer TEXT DEFAULT '',
  status TEXT DEFAULT '',
  type TEXT DEFAULT '',
  build_window TEXT DEFAULT '',
  start_date TEXT,
  deadline TEXT,
  prize_text TEXT DEFAULT 'Prize TBA',
  prize_amount INTEGER,
  requirements TEXT DEFAULT '',
  links TEXT DEFAULT '[]',
  updated_at TEXT DEFAULT (datetime('now'))
);
