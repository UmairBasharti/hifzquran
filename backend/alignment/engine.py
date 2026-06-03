import Levenshtein
import os
import time
from quran.loader import get_word_list
from quran.normalization import normalize_for_match, normalize_for_match_alef
from tajweed.checker import classify_error

# A spoken token counts as a match when its normalized edit-similarity to a reference word is at
# least this. Fuzzy (not exact) matching absorbs the base model's imperfect transcription.
# We use a dynamic threshold: short words (<=3 letters) get a lower threshold (0.5) to tolerate
# exactly 1 edit, while longer words use the standard 0.7.
def get_match_threshold(word_len):
    return 0.5 if word_len <= 3 else 0.7
    
# Skipping forward past a missed word needs a HIGHER confidence than a normal current-word match.
SKIP_MATCH_THRESHOLD = 0.82
# Never skip more than this many words at once. Deliberately tiny: position tracking stays strictly
# local and sequential so a coincidental match to a far repeated word (very common in long surahs
# like Al-Baqarah) can never race the cursor ahead of the reciter.
MAX_LOCAL_SKIP = 2
# Flag the current word wrong only after this much wall-clock time (seconds) passes without
# advancing past it — a conservative "you're stuck on this word" signal that doesn't fire too fast
# when the GPU does back-to-back inferences in <1s.
STUCK_TIME_SECONDS = 2.5
# How far back the reciter may jump to fix an earlier wrong/skipped word. Bounded so a coincidental
# match to a far-back repeated word can never yank the cursor backwards across the passage.
BACKWARD_LOOKBACK = 5



class HifzSession:
    def __init__(self, surah_number, start_ayah, end_ayah, include_bismillah, resume_from_word_index=0):
        # Flat ordered word list for the exact requested range.
        self.words = get_word_list(surah_number, start_ayah, end_ayah, include_bismillah)
        if not self.words:
            raise ValueError(f"No words found for Surah {surah_number} ayahs {start_ayah}-{end_ayah}")

        self.current_word_index = 0
        self.last_confirmed_word_index = -1
        # Results keyed by global word index so a word is never duplicated.
        self.results = {}
        self.is_complete = False
        # Timestamp (time.time()) when the cursor first got stuck on the current word
        self.stuck_since = None

        # After a dropped connection the browser reconnects and tells us where the reciter was.
        if resume_from_word_index > 0:
            self._resume_at(resume_from_word_index)

    # Move the cursor to the given global word index (used on reconnect).
    def _resume_at(self, global_word_index):
        for list_position, word in enumerate(self.words):
            if word["index"] == global_word_index:
                self.current_word_index = list_position
                self.last_confirmed_word_index = global_word_index - 1
                return
        # Past the end of the range → the session was already finished.
        self.current_word_index = len(self.words)
        self.is_complete = True


def create_session(surah_number, start_ayah, end_ayah, include_bismillah, resume_from_word_index=0):
    """Initialize a Hifz session for the requested range (resume fast-forwards after a reconnect)."""
    return HifzSession(surah_number, start_ayah, end_ayah, include_bismillah, resume_from_word_index)


# Both accepted normalized forms of a word: the plain stripped form and the dagger-alef-as-alef
# form (cached on the word). Matching against either absorbs the ASR's long-vowel spelling.
def _word_match_forms(word):
    cached = word.get("_matchForms")
    if cached is not None:
        return cached
    forms = (word["textStripped"], normalize_for_match_alef(word["text"]))
    word["_matchForms"] = forms
    return forms


# Edit-distance similarity (0..1) between two normalized strings.
def _similarity(first, second):
    if not first or not second:
        return 0.0
    return 1.0 - Levenshtein.distance(first, second) / max(len(first), len(second))


# Best similarity between a spoken token and either accepted form of a reference word.
def _word_similarity(word, spoken_norm):
    return max(_similarity(form, spoken_norm) for form in _word_match_forms(word))


# Normalized forms of recently CONFIRMED-CORRECT words, used to ignore overlapping-window echoes.
# We limit the lookback to the last 3-4 words (the size of a sliding window overlap) to avoid
# suppressing legitimate repeated words further down the Surah. Only "correct" words are included:
# a recently wrong/skipped word must stay re-matchable so the reciter can go back and fix it.
def _confirmed_word_forms(session):
    confirmed = set()
    start_position = max(0, session.current_word_index - 4)
    for position in range(start_position, session.current_word_index):
        word = session.words[position]
        existing = session.results.get(word["index"])
        if existing and existing["status"] == "correct":
            confirmed.update(_word_match_forms(word))
    return confirmed


# The nearest word within a SHORT forward reach (1..max_skip) that the token strongly matches, or
# -1. Bounded and high-threshold so a coincidental match to a far repeated word can never jump the
# cursor ahead of where the reciter actually is.
def _find_near_match(session, spoken_norm, max_skip, threshold):
    start = session.current_word_index + 1
    end = min(start + max_skip, len(session.words))
    for position in range(start, end):
        if _word_similarity(session.words[position], spoken_norm) >= threshold:
            return position
    return -1


# The reciter may go back to re-recite an earlier word they got wrong or skipped. Find the nearest
# such word within a short BACKWARD window that the token strongly matches, or -1. High threshold +
# bounded lookback so a coincidental match can't drag the cursor backwards across the passage.
def _find_backward_correction(session, spoken_norm, max_lookback, threshold):
    start = session.current_word_index - 1
    end = max(0, session.current_word_index - max_lookback)
    for position in range(start, end - 1, -1):
        word = session.words[position]
        existing = session.results.get(word["index"])
        if existing and existing["status"] in ("wrong", "skipped"):
            if _word_similarity(word, spoken_norm) >= threshold:
                return position
    return -1


# Re-mark a previously wrong/skipped word correct (the reciter went back to fix it) and move the
# cursor to just after it, so recitation naturally continues forward from that point.
def _correct_backward(session, position, spoken_token, new_results):
    word = session.words[position]
    result = {
        "type": "wordResult",
        "wordIndex": word["index"],
        "status": "correct",
        "word": word["text"],
        "spoken": spoken_token,
    }
    session.results[word["index"]] = result
    new_results.append(result)
    session.current_word_index = position + 1
    session.last_confirmed_word_index = max(session.last_confirmed_word_index, word["index"])
    session.stuck_since = None


# Mark the current word correct, advance the cursor, and reset the stuck counter.
def _reveal_correct(session, word, spoken_token, new_results):
    result = {
        "type": "wordResult",
        "wordIndex": word["index"],
        "status": "correct",
        "word": word["text"],
        "spoken": spoken_token,
    }

    session.results[word["index"]] = result
    new_results.append(result)
    session.last_confirmed_word_index = word["index"]
    session.current_word_index += 1
    session.stuck_since = None


# Jump the cursor forward to where the reciter actually is, marking every unconfirmed word in
# between as "skipped" (could not be confirmed — usually missed at a sliding-window boundary).
def _resync_forward(session, target_position, new_results):
    for position in range(session.current_word_index, target_position):
        word = session.words[position]
        existing = session.results.get(word["index"])
        if existing and existing["status"] == "correct":
            continue
        skipped_result = {
            "type": "wordResult",
            "wordIndex": word["index"],
            "status": "skipped",
            "word": word["text"],
            "spoken": None,
        }
        session.results[word["index"]] = skipped_result
        new_results.append(skipped_result)
    session.current_word_index = target_position
    session.last_confirmed_word_index = session.words[target_position - 1]["index"]


# Flag the current word wrong when the reciter is clearly stuck on it (repeat-until-correct).
def _flag_current_wrong(session, new_results, transcribed_text):
    word = session.words[session.current_word_index]
    existing = session.results.get(word["index"])
    if existing and existing["status"] in ("correct", "wrong"):
        return
        
    spoken_token = None
    error_type = "pronunciation_error"
    if transcribed_text:
        tokens = transcribed_text.split()
        if tokens:
            confirmed_forms = _confirmed_word_forms(session)
            unconfirmed = [
                t for t in tokens 
                if len(normalize_for_match(t)) >= 2 and normalize_for_match(t) not in confirmed_forms
            ]
            
            if unconfirmed:
                # Pick the unconfirmed token that is most similar to the target word,
                # as that is most likely the reciter's actual attempt.
                best_token = unconfirmed[0]
                best_sim = _word_similarity(word, normalize_for_match(best_token))
                for t in unconfirmed[1:]:
                    sim = _word_similarity(word, normalize_for_match(t))
                    if sim > best_sim:
                        best_sim = sim
                        best_token = t
                spoken_token = best_token
            else:
                # Fallback to the last token if everything somehow looks confirmed
                spoken_token = tokens[-1]
                
            error_type = classify_error(word["text"], spoken_token)

    result = {
        "type": "wordResult",
        "wordIndex": word["index"],
        "status": "wrong",
        "word": word["text"],
        "spoken": spoken_token,
        "errorType": error_type,
    }
    session.results[word["index"]] = result
    new_results.append(result)


def process_transcription(session, transcribed_text, current_time=None):
    """
    Fuzzy, monotonic, position-tracking alignment (Tarteel-style). Each recognized token is matched
    to a reference word by edit-similarity within a forward window; the cursor advances to the
    furthest confident match, missed words are marked skipped, and a word is only flagged wrong
    after the reciter is stuck on it for several chunks (never on a single noisy chunk).
    """
    if current_time is None:
        current_time = time.time()
    new_results = []
    if session.is_complete or not transcribed_text:
        return new_results

    start_cursor = session.current_word_index
    confirmed_forms = _confirmed_word_forms(session)

    for spoken_token in transcribed_text.split():
        if session.current_word_index >= len(session.words):
            break

        spoken_norm = normalize_for_match(spoken_token)
        if len(spoken_norm) < 2:
            continue  # one-letter noise
        current_word = session.words[session.current_word_index]

        # 1. Fuzzy match against the current expected word.
        # This MUST happen before the echo check so that adjacent repeated words (e.g. An-Nas)
        # are correctly accepted even if they are in the recent confirmed_forms window.
        threshold = get_match_threshold(len(current_word["textStripped"]))
        if _word_similarity(current_word, spoken_norm) >= threshold:
            _reveal_correct(session, current_word, spoken_token, new_results)
            confirmed_forms.update(_word_match_forms(current_word))
            continue

        if spoken_norm in confirmed_forms:
            continue  # overlapping-window echo of an already-confirmed word; ignore to prevent false skips

        # 2. The model may have missed 1-2 words — look only a SHORT distance ahead (with a higher
        # confidence bar) and resync there. Bounded so the cursor can never jump far ahead.
        match_position = _find_near_match(session, spoken_norm, MAX_LOCAL_SKIP, SKIP_MATCH_THRESHOLD)
        if match_position != -1:
            _resync_forward(session, match_position, new_results)
            revealed_word = session.words[session.current_word_index]
            _reveal_correct(session, revealed_word, spoken_token, new_results)
            confirmed_forms.update(_word_match_forms(revealed_word))
            continue

        # 2.5 Backtracking — the reciter went back to fix an earlier wrong/skipped word. This is
        # only reached when the token matched NEITHER the current word NOR the next 1-2 ahead, so
        # ordinary forward recitation never triggers it: if the reciter just keeps going, their
        # words match forward and the skipped word is simply left as-is. It fires only on a real
        # backward jump, re-marking that word correct and resuming the cursor from there.
        backward_position = _find_backward_correction(session, spoken_norm, BACKWARD_LOOKBACK, SKIP_MATCH_THRESHOLD)
        if backward_position != -1:
            _correct_backward(session, backward_position, spoken_token, new_results)
            confirmed_forms.update(_word_match_forms(session.words[backward_position]))
            continue

        # 3. Unmatched token — ASR noise or an unclear word. Ignore it (never churn a false error).

    # Conservative stuck detection: if a chunk didn't advance the cursor, we mark the wall-clock time.
    # After several seconds of not advancing, the current word is flagged wrong.
    if not session.is_complete and session.current_word_index == start_cursor:
        if session.stuck_since is None:
            session.stuck_since = current_time
        elif current_time - session.stuck_since >= STUCK_TIME_SECONDS:
            _flag_current_wrong(session, new_results, transcribed_text)
    else:
        session.stuck_since = None

    if session.current_word_index >= len(session.words):
        session.is_complete = True
    return new_results


def skip_word(session, word_global_index):
    """Manually skip a word (Skip button) — mark it skipped and advance the cursor past it."""
    if word_global_index in session.results and session.results[word_global_index]["status"] == "correct":
        return None  # cannot skip a word already confirmed correct

    skipped_word_text = ""
    for list_position, word in enumerate(session.words):
        if word["index"] == word_global_index:
            skipped_word_text = word["text"]
            session.current_word_index = max(session.current_word_index, list_position + 1)
            session.last_confirmed_word_index = max(session.last_confirmed_word_index, word_global_index)
            break

    result = {
        "type": "wordResult",
        "wordIndex": word_global_index,
        "status": "skipped",
        "word": skipped_word_text,
        "spoken": None,
    }
    session.results[word_global_index] = result
    session.stuck_since = None

    if session.current_word_index >= len(session.words):
        session.is_complete = True
    return result
