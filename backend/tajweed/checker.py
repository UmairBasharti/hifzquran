from quran.normalization import normalize_for_tashkeel, normalize_for_match

# Arabic Diacritic Unicode Constants
SHADDA = "\u0651"
TANWIN_FATHA = "\u064B"
TANWIN_DAMMA = "\u064C"
TANWIN_KASRA = "\u064D"
TANWIN_MARKS = {TANWIN_FATHA, TANWIN_DAMMA, TANWIN_KASRA}

FATHA = "\u064E"
DAMMA = "\u064F"
KASRA = "\u0650"
HARAKAT_MARKS = {FATHA, DAMMA, KASRA}

def classify_error(expected_word: str, spoken_word: str) -> str:
    """
    Classifies the specific pronunciation error the user made.
    Called only when Stage 1 (root match) fails but similarity is high (Stage 2).
    
    Returns one of:
    - "missing_shadda"
    - "wrong_harakat"
    - "missing_tanwin"
    - "wrong_word"
    - "pronunciation_error"
    """
    # 1. Base word check
    # If the base letters are entirely different, it's a wrong word entirely.
    # (e.g., they said "Allah" instead of "Alhamdulillah")
    expected_root = normalize_for_match(expected_word)
    spoken_root = normalize_for_match(spoken_word)
    
    if expected_root != spoken_root:
        return "wrong_word"

    # 2. Tashkeel checking
    # Keep the diacritics but standardize the encoding (NFC + folded letters)
    expected_tashkeel = normalize_for_tashkeel(expected_word)
    spoken_tashkeel = normalize_for_tashkeel(spoken_word)
    
    # Check for missing Shadda
    expected_has_shadda = SHADDA in expected_tashkeel
    spoken_has_shadda = SHADDA in spoken_tashkeel
    if expected_has_shadda and not spoken_has_shadda:
        return "missing_shadda"
        
    # Check for missing Tanwin
    expected_has_tanwin = any(t in expected_tashkeel for t in TANWIN_MARKS)
    spoken_has_tanwin = any(t in spoken_tashkeel for t in TANWIN_MARKS)
    if expected_has_tanwin and not spoken_has_tanwin:
        return "missing_tanwin"
        
    # Check for Harakat (vowel) mismatches
    # We extract the harakat in order and compare them
    expected_vowels = [c for c in expected_tashkeel if c in HARAKAT_MARKS]
    spoken_vowels = [c for c in spoken_tashkeel if c in HARAKAT_MARKS]
    
    # If they supplied vowels and they don't match the expected vowels, they got a haraka wrong.
    if expected_vowels and spoken_vowels and expected_vowels != spoken_vowels:
        return "wrong_harakat"
        
    # Fallback for any other diacritic issue (e.g. they dropped a vowel entirely
    # or mispronounced a letter despite the root mapping folding it)
    return "pronunciation_error"
