# QuranData.md
# HifzAI — Quran Data Structure, Sources, and Arabic Text Rules
# Read this before writing any code that touches Arabic text, Quran data,
# or the alignment engine. Arabic Unicode is non-obvious — this file
# explains every critical detail.

---

## 1. DATA SOURCES

### Primary: api.quran.com (Quran Foundation API)
- URL: https://api.quran.com/api/v4
- No API key required for content endpoints
- Fetched ONCE at Python backend startup by backend/quran/loader.py
- Saved to backend/quran/quran_data.json
- Loaded fully into memory — never re-fetched at runtime
- Same data that powers Quran.com — text matches perfectly for integration

### Secondary: frontend/public/surah_index.json
- Generated once by: python backend/quran/generate_surah_index.py
- 114 records — names and Ayah counts only
- Served as static file by Next.js
- Used for client-side search only — never for word text

### Backup: tanzil.net
- Provides downloadable Uthmani XML if api.quran.com is unavailable
- Same text — use only if primary source fails during development

---

## 2. QURAN TEXT STANDARD

### Script: Uthmani Only
HifzAI uses Uthmani script exclusively — the script used in the Madinah
Mushaf and on Quran.com. Never use Imlaai, IndoPak, or any other script.

### Qira'at: Hafs 'an 'Asim Only
All text is based on the Hafs 'an 'Asim narration — the most widely read
recitation globally (~95% of Muslims worldwide).

### API Field: text_uthmani
When fetching from api.quran.com, always request the `text_uthmani` field:
```
GET https://api.quran.com/api/v4/verses/by_chapter/108
  ?words=true
  &word_fields=text_uthmani
```

---

## 3. ARABIC UNICODE — CRITICAL KNOWLEDGE

This section is the most important in this file. Misunderstanding Arabic
Unicode is the single biggest source of silent bugs in this system.

### What Tashkeel Is
Tashkeel (تشكيل) are the diacritical marks placed above and below Arabic
letters to indicate short vowels and other pronunciation rules.

| Mark | Arabic Name | Unicode | Example |
|------|-------------|---------|---------|
| Fatha | فتحة | U+064E | رَ (ra with fatha) |
| Kasra | كسرة | U+0650 | رِ (ra with kasra) |
| Damma | ضمة | U+064F | رُ (ra with damma) |
| Sukun | سكون | U+0652 | رْ (ra with sukun) |
| Shadda | شدة | U+0651 | رّ (ra with shadda — doubled) |
| Tanwin fath | تنوين فتح | U+064B | رً (ra with tanwin fath) |
| Tanwin kasr | تنوين كسر | U+064D | رٍ (ra with tanwin kasr) |
| Tanwin damm | تنوين ضم | U+064C | رٌ (ra with tanwin damm) |
| Tatweel | تطويل | U+0640 | ـ (kashida — elongation) |

### The Unicode Encoding Problem
The SAME Arabic word with tashkeel can be stored as different byte sequences
that look identical on screen but are NOT equal in code. This happens because:

1. Unicode allows the same character to be encoded in multiple ways
2. NFD (Canonical Decomposition) separates base letters from combining marks
3. NFC (Canonical Composition) composes them back together
4. api.quran.com may use one encoding, ASR model output may use another

**If you compare raw Arabic strings without normalization:**
- "الرَّحِيمِ" from api.quran.com == "الرَّحِيمِ" from ASR → may return FALSE
- The user recited correctly but the system flags it as WRONG
- This is a silent bug — the text looks identical in any editor

### The Fix: Always Use unicodedata.normalize('NFD') Before Any Comparison

```python
import unicodedata

# ALWAYS normalize before comparison — never skip this step
def normalize_arabic(arabic_text):
    return unicodedata.normalize('NFD', arabic_text)

# Strip ALL tashkeel (for Stage 1 word root matching)
def strip_tashkeel(arabic_text):
    decomposed = unicodedata.normalize('NFD', arabic_text)
    return ''.join(
        char for char in decomposed
        if unicodedata.category(char) != 'Mn'
    )
```

Unicode category 'Mn' = Mark, Nonspacing — this covers ALL Arabic diacritics,
all shadda, all tanwin, all harakat. Stripping category 'Mn' characters
after NFD decomposition removes all tashkeel reliably.

### Why Two Stages of Comparison

| Stage | Purpose | Method | Returns |
|-------|---------|--------|---------|
| Stage 1 | Did user say the right word? | strip_tashkeel both sides, compare | correct / wrong_word / skipped |
| Stage 2 | What tashkeel error was made? | normalize_arabic both sides, char-by-char diff | error type string |

Stage 1 catches completely wrong words.
Stage 2 catches correct root words with wrong diacritics (the more common error for huffaz).

---

## 4. QURAN DATA STRUCTURE IN MEMORY

quran_data.json structure after fetching and processing:

```json
{
  "1": {
    "nameSimple": "Al-Fatihah",
    "nameArabic": "الفاتحة",
    "totalAyahs": 7,
    "bismillah": {
      "words": [
        { "index": 0, "text": "بِسْمِ",        "textStripped": "بسم" },
        { "index": 1, "text": "اللَّهِ",       "textStripped": "الله" },
        { "index": 2, "text": "الرَّحْمَٰنِ", "textStripped": "الرحمن" },
        { "index": 3, "text": "الرَّحِيمِ",   "textStripped": "الرحيم" }
      ]
    },
    "ayahs": [
      {
        "ayahNumber": 1,
        "words": [
          { "index": 4, "text": "الْحَمْدُ", "textStripped": "الحمد" },
          ...
        ]
      }
    ]
  },
  "2": { ... },
  ...
  "114": { ... }
}
```

### Key Design Decisions
- `text` — full Uthmani with tashkeel — used for display and Stage 2
- `textStripped` — pre-computed tashkeel-free — used for Stage 1 at runtime
- `index` — global sequential across the full session (bismillah = 0, 1, 2, 3)
- Pre-computing `textStripped` at data load time means the alignment engine
  never strips tashkeel at runtime per word — faster and consistent

---

## 5. BISMILLAH HANDLING

### Full Surah Mode
Bismillah (بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ) is included as the first
4 words of every session (indices 0–3). The alignment engine expects it
first and the user must recite it. Speed does not matter — the engine is
position-based not pace-based.

Surah At-Tawbah (Chapter 9) is the ONLY Surah without Bismillah.
The loader.py must handle this case — bismillah field will be null for Surah 9.

### Custom Range Mode
Bismillah is NOT included in custom range sessions. The session word list
starts directly at the first word of the selected start Ayah.

### Surah Al-Fatihah Special Case
In Surah Al-Fatihah, Bismillah is considered the first Ayah (Ayah 1).
The api.quran.com API returns it as part of the Surah, not as a separate
bismillah field. loader.py must handle this correctly.

---

## 6. WORD INDEX SYSTEM

Every word in a session has a unique sequential integer index starting at 0.

For a full Surah session:
- Index 0–3: Bismillah words
- Index 4+: First word of first Ayah onward

For a custom range session (e.g. Surah Al-Baqarah, Ayah 255 to 257):
- Index 0: First word of Ayah 255
- Continues sequentially through Ayah 257

The alignment engine tracks `current_word_index` (the next expected word)
and `last_confirmed_word_index` (highest confirmed correct/skipped word).
Deduplication: ignore any result with wordIndex <= last_confirmed_word_index.

---

## 7. WHAT QURAN TEXT IS NEVER MODIFIED

The Quran text is sacred. These rules are absolute:

1. Never alter, truncate, abbreviate, or transform any Quran text string
   for display purposes — render exactly as it comes from quran_data.json

2. Normalization (NFD, strip_tashkeel) is ONLY for internal comparison logic.
   The display string must always be the original unchanged text from the data.

3. Never generate, guess, or reconstruct Quran text from memory.
   Always use quran_data.json as the source of truth.

4. If quran_data.json is missing or corrupt, the backend must refuse to start
   and log a clear error. Never serve incorrect Quran text.

---

## 8. FETCH LOGIC IN loader.py

```python
# Pseudocode — actual implementation in backend/quran/loader.py

async def load_quran_data():
    # Check if cached file exists
    if quran_data.json exists on disk:
        load it into QURAN_DATA dict
        log "Quran data loaded from cache"
        return

    # Fetch from api.quran.com for all 114 surahs
    for surah_number in range(1, 115):
        response = await httpx.get(
            f"https://api.quran.com/api/v4/verses/by_chapter/{surah_number}",
            params={ "words": "true", "word_fields": "text_uthmani" }
        )
        # process and store in QURAN_DATA[str(surah_number)]

    # Save to disk for future startups
    save QURAN_DATA to quran_data.json
    log "Quran data fetched and cached"
```

Rate limiting: api.quran.com allows up to 100 requests/minute.
Fetch all 114 surahs sequentially with a 0.5s delay between requests
to stay within limits. Total time: ~60-90 seconds on first run only.

---

## 9. generate_surah_index.py

Run this script once before starting the frontend for the first time.
It reads quran_data.json and writes frontend/public/surah_index.json.

```
Input:  backend/quran/quran_data.json
Output: frontend/public/surah_index.json

Output format (114 records):
[
  { "number": 1,   "nameSimple": "Al-Fatihah", "nameArabic": "الفاتحة", "ayahCount": 7 },
  ...
  { "number": 114, "nameSimple": "An-Nas",      "nameArabic": "الناس",   "ayahCount": 6 }
]
```

Run: `python backend/quran/generate_surah_index.py`
Must be re-run if quran_data.json is ever regenerated.
