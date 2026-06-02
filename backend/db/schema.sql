-- HifzAI — Supabase schema (MVP)
-- Source of truth: docs/Database.md §2. Run this once in the Supabase SQL editor.
-- Safe to re-run (idempotent guards added).
--
-- Stores ONE row per completed Hifz session. No user identity, no audio, no PII.

-- 1. Table -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hifz_sessions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  surah_number  INTEGER     NOT NULL CHECK (surah_number BETWEEN 1 AND 114),
  start_ayah    INTEGER     NOT NULL CHECK (start_ayah >= 1),
  end_ayah      INTEGER     NOT NULL CHECK (end_ayah >= start_ayah),
  total_words   INTEGER     NOT NULL CHECK (total_words > 0),
  correct_count INTEGER     NOT NULL DEFAULT 0,
  wrong_count   INTEGER     NOT NULL DEFAULT 0,
  skipped_count INTEGER     NOT NULL DEFAULT 0,
  word_results  JSONB       NOT NULL DEFAULT '[]'
);

-- word_results shape (per element):
--   { "wordIndex": 0,  "status": "correct" }
--   { "wordIndex": 5,  "status": "wrong", "errorType": "missing_shadda",
--     "expected": "أَعْطَيْنَاكَ", "spoken": "اعطيناك" }
--   { "wordIndex": 11, "status": "skipped" }
-- status:    "correct" | "wrong" | "skipped"
-- errorType: "missing_shadda" | "wrong_harakat" | "missing_tanwin" | "wrong_word" | "pronunciation_error"

-- 2. Row Level Security (mandatory on every table) ---------------------------
ALTER TABLE hifz_sessions ENABLE ROW LEVEL SECURITY;

-- Anyone may INSERT an anonymous session. No SELECT policy exists, so NO ONE can
-- read rows back — the data is write-only from any client. The Python backend
-- writes with the service-role key, which bypasses RLS regardless.
DROP POLICY IF EXISTS "allow_anonymous_insert" ON hifz_sessions;
CREATE POLICY "allow_anonymous_insert"
  ON hifz_sessions FOR INSERT
  TO anon
  WITH CHECK (true);

-- Deliberately NO SELECT / UPDATE / DELETE policy = those are all denied.
