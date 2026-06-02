import re
import unicodedata

# Matches all Arabic diacritics, Quranic small high signs, combining marks, and tatweel.
# This covers everything that should be stripped for root-word comparison.
_DIACRITICS_PATTERN = re.compile(
    "["
    "\u0610-\u061A"   # Arabic extended marks (small high signs etc.)
    "\u064B-\u065F"   # Harakat: fatha, kasra, damma, shadda, sukun, tanwin, etc.
    "\u0670"          # Arabic letter superscript alef
    "\u06D6-\u06DC"   # Quranic annotation signs
    "\u06DF-\u06E4"   # More Quranic signs
    "\u06E7\u06E8"    # Arabic small high yeh / noon
    "\u06EA-\u06ED"   # More Quranic marks
    "\u0640"          # Arabic tatweel (kashida — elongation mark)
    "]"
)

# Maps variant Arabic letter forms to their base equivalents for comparison.
# Critical fix: ٱ (alef-wasla U+0671) must fold to ا — the docs' Mn-only strip_tashkeel
# does NOT handle this, causing most ال words to fail Stage 1 matching.
_LETTER_FOLD_TABLE = str.maketrans({
    "\u0623": "\u0627",  # أ → ا (alef with hamza above)
    "\u0625": "\u0627",  # إ → ا (alef with hamza below)
    "\u0622": "\u0627",  # آ → ا (alef with madda)
    "\u0671": "\u0627",  # ٱ → ا (alef wasla — the critical fix, Doc Correction 2)
    "\u0629": "\u0647",  # ة → ه (ta marbuta)
    "\u0649": "\u064A",  # ى → ي (alef maqsura)
})

# Stage 1 — strips ALL diacritics and folds letter variants for root-word matching.
# Use this to compare whether the user said the right word regardless of tashkeel.
# Pre-compute this as textStripped in quran_data.json to avoid runtime overhead.
def normalize_for_match(arabic_text):
    # Remove leading zero-width no-break space if present (common in API responses)
    cleaned_text = arabic_text.lstrip("\uFEFF")
    # Strip all diacritics and Quranic marks
    stripped_text = _DIACRITICS_PATTERN.sub("", cleaned_text)
    # Fold variant letter forms (أإآٱ → ا, ة → ه, ى → ي)
    folded_text = stripped_text.translate(_LETTER_FOLD_TABLE)
    # Normalize whitespace
    return " ".join(folded_text.split())

# Like normalize_for_match, but renders the Quran's dagger-alef (ٰ U+0670, a written long-vowel
# mark) as a regular alef ا instead of dropping it. The ASR often transcribes that long vowel as
# a full alef (e.g. "أعطيناك" for "أَعْطَيْنَٰكَ"), so a word is accepted if the spoken token matches
# EITHER this form or the plain normalize_for_match form. Keeping both avoids conflating genuinely
# distinct words such as قُل ("qul") and قَالَ ("qaala").
def normalize_for_match_alef(arabic_text):
    return normalize_for_match(arabic_text.replace("ٰ", "ا"))

# Stage 2 — preserves diacritics but folds letter variants and standardizes encoding.
# Use this in tajweed/checker.py to classify WHAT TYPE of tashkeel error was made.
def normalize_for_tashkeel(arabic_text):
    # Remove leading zero-width no-break space if present
    cleaned_text = arabic_text.lstrip("\uFEFF")
    # NFC compose to get consistent diacritic encoding before comparison
    composed_text = unicodedata.normalize("NFC", cleaned_text)
    # Fold letter forms (keeps diacritics intact — only base letters change)
    folded_text = composed_text.translate(_LETTER_FOLD_TABLE)
    # Normalize whitespace
    return " ".join(folded_text.split())
