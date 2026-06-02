# Database.md
# HifzAI — Database Schema and Rules
# Supabase (PostgreSQL) — all tables, all columns, all RLS policies.
# Read this before writing any code that touches Supabase.

---

## 1. RULES THAT NEVER CHANGE

1. Row Level Security (RLS) must be enabled on EVERY table before use
2. Every table must have at least one RLS policy before any code uses it
3. Never store raw audio — not even metadata about audio content
4. Never store personally identifiable information in MVP (no accounts)
5. All Supabase access from frontend uses the anon key + RLS
6. All Supabase access from Python backend uses the service role key

---

## 2. MVP TABLES

### Table: hifz_sessions

Stores anonymous session results after each Hifz session completes.
No user identity. No audio. No personal data.

```sql
CREATE TABLE hifz_sessions (
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

-- Enable RLS immediately
ALTER TABLE hifz_sessions ENABLE ROW LEVEL SECURITY;

-- Policy: anyone can insert (anonymous sessions)
CREATE POLICY "allow_anonymous_insert"
  ON hifz_sessions FOR INSERT
  TO anon
  WITH CHECK (true);

-- Policy: no one can read other sessions
-- (no SELECT policy = no one can read any row)
```

**word_results JSONB structure:**
```json
[
  { "wordIndex": 0,  "status": "correct" },
  { "wordIndex": 5,  "status": "wrong",
    "errorType": "missing_shadda",
    "expected": "أَعْطَيْنَاكَ",
    "spoken": "اعطيناك" },
  { "wordIndex": 11, "status": "skipped" }
]
```

**Status values:** `"correct"` | `"wrong"` | `"skipped"`
**errorType values:** `"missing_shadda"` | `"wrong_harakat"` | `"missing_tanwin"` | `"wrong_word"` | `"pronunciation_error"`

---

## 3. POST-MVP TABLES (DO NOT BUILD YET)

These are documented for future planning only.
Do not create these tables in MVP under any circumstance.

### Table: users (Post-MVP)
```sql
-- Managed by Supabase Auth — do not create manually
-- auth.users table is auto-created by Supabase Auth
-- Add user_id UUID FK to hifz_sessions when ready
```

### Table: user_progress (Post-MVP)
```sql
CREATE TABLE user_progress (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID    REFERENCES auth.users(id) ON DELETE CASCADE,
  surah_number INTEGER NOT NULL,
  best_score   INTEGER,           -- highest correct percentage
  attempt_count INTEGER DEFAULT 0,
  last_attempt TIMESTAMPTZ,
  memorized    BOOLEAN DEFAULT false
);
```

### Table: streaks (Post-MVP)
```sql
CREATE TABLE streaks (
  user_id       UUID  PRIMARY KEY REFERENCES auth.users(id),
  current_streak INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  last_active   DATE
);
```

---

## 4. SUPABASE CLIENT SETUP

### Frontend (lib/supabase.js)
```javascript
import { createClient } from '@supabase/supabase-js'

// Initializes the Supabase client using environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const supabaseClient = createClient(supabaseUrl, supabaseAnonKey)
```

### Backend (Python — used for session insert after session completes)
```python
from supabase import create_client
from dotenv import load_dotenv
import os

load_dotenv()

# Initializes Supabase client with service role key for backend inserts
supabase_client = create_client(
    os.getenv("SUPABASE_URL"),
    os.getenv("SUPABASE_SERVICE_ROLE_KEY")
)
```

---

## 5. HOW TO SAVE A SESSION (Pattern)

Called from Next.js API route after WebSocket sessionComplete received:

```javascript
// Saves completed session results to Supabase anonymously
async function saveSessionResult(sessionData) {
  try {
    const { error } = await supabaseClient
      .from('hifz_sessions')
      .insert({
        surah_number:  sessionData.surahNumber,
        start_ayah:    sessionData.startAyah,
        end_ayah:      sessionData.endAyah,
        total_words:   sessionData.totalWords,
        correct_count: sessionData.correctCount,
        wrong_count:   sessionData.wrongCount,
        skipped_count: sessionData.skippedCount,
        word_results:  sessionData.wordResults
      })

    if (error) {
      console.error('Failed to save session result to Supabase:', error)
      return false
    }
    return true
  } catch (error) {
    console.error('Unexpected error saving session result to Supabase:', error)
    return false
  }
}
```

Session save failure must NEVER block the summary screen from rendering.
Save in the background — user sees results regardless of DB success or failure.

---

## 6. ENVIRONMENT VARIABLES

```
frontend/.env.local
  NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
  NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here

backend/.env
  SUPABASE_URL=https://your-project.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

Never commit these files. Both are in .gitignore.
The anon key is safe to expose in browser (RLS enforces access control).
The service role key bypasses RLS — keep it server-side only, always.
