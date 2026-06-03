import pytest
import json
import os
from quran import loader
from alignment.engine import create_session, process_transcription, skip_word

@pytest.fixture(autouse=True)
def setup_quran_data():
    if not loader.QURAN_LOADED:
        data_path = os.path.join(os.path.dirname(__file__), "quran", "quran_data.json")
        with open(data_path, "r", encoding="utf-8") as f:
            loader.QURAN_DATA = json.load(f)
        loader.QURAN_LOADED = True


def test_correct_reveal():
    # Surah 112, Ayah 1: قُلْ هُوَ ٱللَّهُ أَحَدٌ (indices 4..7)
    session = create_session(112, 1, 1, include_bismillah=False)
    results = process_transcription(session, "قل")
    assert len(results) == 1
    assert results[0]["status"] == "correct"
    assert results[0]["wordIndex"] == 4
    assert session.current_word_index == 1


def test_complete():
    session = create_session(112, 1, 1, include_bismillah=False)
    results = process_transcription(session, "قل هو الله احد")
    assert len(results) == 4
    assert all(r["status"] == "correct" for r in results)
    assert session.is_complete


def test_fuzzy_match_tolerates_asr_error():
    # Al-Fatihah Ayah 2: ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَـٰلَمِينَ. ASR mishears "العالمين" as "العادمين"
    # (one-letter slip) — fuzzy matching must still reveal it correct.
    session = create_session(1, 2, 2, include_bismillah=False)
    results = process_transcription(session, "الحمد لله رب العادمين")
    assert session.is_complete
    assert all(r["status"] == "correct" for r in results)


def test_dagger_alef_both_spellings_match():
    # Surah 108: أَعْطَيْنَٰكَ (dagger-alef) must match the ASR's "اعطيناك" (full alef).
    session = create_session(108, 1, 1, include_bismillah=False)  # إِنَّآ أَعْطَيْنَٰكَ ٱلْكَوْثَرَ
    results = process_transcription(session, "انا اعطيناك الكوثر")
    assert session.is_complete
    assert all(r["status"] == "correct" for r in results)


def test_unmatched_token_does_not_advance():
    # "الارض" (al-ard) vs expected "قل" (qul): completely different word.
    # a single noisy/unclear chunk must NOT falsely advance and must NOT flag a hard error.
    session = create_session(112, 1, 1, include_bismillah=False)
    results = process_transcription(session, "الارض")
    assert results == []
    assert session.current_word_index == 0


def test_stuck_word_eventually_flagged_wrong():
    # Repeatedly failing to advance past a word (genuinely stuck) flags it wrong after a few chunks.
    session = create_session(112, 1, 1, include_bismillah=False)
    process_transcription(session, "الحمد لله", current_time=0.0)
    process_transcription(session, "الحمد لله", current_time=1.0)
    results = process_transcription(session, "الحمد لله", current_time=3.0) # > 2.5s triggers stuck chunk
    assert any(r["status"] == "wrong" and r["wordIndex"] == 4 for r in results)
    assert session.current_word_index == 0


def test_wrong_then_correct_advance():
    session = create_session(112, 1, 1, include_bismillah=False)
    process_transcription(session, "الارض", current_time=0.0)
    process_transcription(session, "الارض", current_time=1.0)
    process_transcription(session, "الارض", current_time=3.0)  # gets flagged wrong
    results = process_transcription(session, "قل", current_time=4.0)  # now said correctly
    assert results[0]["status"] == "correct"
    assert session.current_word_index == 1


def test_resync_follows_when_word_missed():
    # Bismillah revealed up to الرحمن; الرحيم is missed at a window boundary; the reciter continues.
    # The engine must skip الرحيم and follow along, not freeze.
    session = create_session(108, 1, 3, include_bismillah=True)
    process_transcription(session, "بسم الله الرحمن")  # reveals indices 0,1,2 -> cursor 3 (الرحيم)
    results = process_transcription(session, "انا اعطيناك الكوثر")
    statuses = {r["wordIndex"]: r["status"] for r in results}
    assert statuses[3] == "skipped"          # الرحيم skipped
    assert statuses[4] == "correct"           # إنا
    assert statuses[6] == "correct"           # الكوثر
    assert session.current_word_index == 7


def test_overlap_echo_ignored():
    # Overlapping windows re-send already-confirmed words — they must not re-reveal or mis-match.
    session = create_session(112, 1, 1, include_bismillah=False)
    first = process_transcription(session, "قل هو")
    assert len(first) == 2 and session.current_word_index == 2
    second = process_transcription(session, "قل هو الله")  # قل هو are echoes; only الله is new
    assert [r["wordIndex"] for r in second] == [6]
    assert second[0]["status"] == "correct"


def test_skip():
    session = create_session(112, 1, 1, include_bismillah=False)
    result = skip_word(session, 4)
    assert result["status"] == "skipped"
    assert result["wordIndex"] == 4
    assert session.current_word_index == 1


def test_custom_range():
    # Surah 112, Ayah 2: ٱللَّهُ ٱلصَّمَدُ (indices 8, 9)
    session = create_session(112, 2, 2, include_bismillah=False)
    assert len(session.words) == 2
    assert session.words[0]["index"] == 8
    results = process_transcription(session, "الله الصمد")
    assert len(results) == 2
    assert session.is_complete

def test_repeated_words_bug():
    # Surah 114, Ayahs 1-2.
    # Ayah 1: قُلْ أَعُوذُ بِرَبِّ ٱلنَّاسِ (indices 4..7)
    # Ayah 2: مَلِكِ ٱلنَّاسِ (indices 8..9)
    # "ٱلنَّاسِ" (An-Nas) is repeated. The engine should not ignore the second occurrence.
    session = create_session(114, 1, 2, include_bismillah=False)
    
    res1 = process_transcription(session, "قل اعوذ برب الناس")
    assert len(res1) == 4
    assert session.current_word_index == 4
    
    # The reciter says Ayah 2
    res2 = process_transcription(session, "ملك الناس")
    
    # Due to Bug F1 (global confirmed_forms), "الناس" is ignored as an echo of Ayah 1.
    assert len(res2) == 2, f"Expected 2 words revealed, got {len(res2)}. Bug F1 (Repeated Words)!"
    assert res2[0]["wordIndex"] == 8
    assert res2[1]["wordIndex"] == 9
    assert session.current_word_index == 6

def test_wrong_word_token_picking():
    # If the user says "قل هو الارض" when expected is "الله", it should report "الارض" as the spoken token,
    # NOT "قل" or "هو" which are confirmed echoes (Bug F3).
    session = create_session(112, 1, 1, include_bismillah=False)
    process_transcription(session, "قل هو")
    assert session.current_word_index == 2  # expecting "الله"
    
    process_transcription(session, "قل هو الارض", current_time=0.0)
    process_transcription(session, "قل هو الارض", current_time=1.0)
    results = process_transcription(session, "قل هو الارض", current_time=3.0) # > 2.5s triggers wrong
    
    wrong_results = [r for r in results if r["status"] == "wrong"]
    assert len(wrong_results) == 1
    assert wrong_results[0]["spoken"] == "الارض"

def test_short_word_intolerance_fixed():
    # A short word like "قل" (len 2 stripped) with 1 mistake "خل" should be accepted now,
    # because the dynamic threshold drops to 0.5 for words <= 3 characters (Bug F8).
    session = create_session(112, 1, 1, include_bismillah=False)

    # "خل" vs "قل" -> edit distance 1. length 2. similarity = 1.0 - (1/2) = 0.5.
    res = process_transcription(session, "خل")
    assert len(res) == 1
    assert res[0]["status"] == "correct"
    assert res[0]["wordIndex"] == 4
    assert session.current_word_index == 1


def test_backtracking_fixes_skipped_word():
    # Surah 114 ayahs 1-2: قُل(4) أَعُوذُ(5) بِرَبِّ(6) ٱلنَّاسِ(7) مَلِكِ(8) ٱلنَّاسِ(9).
    # The reciter skips بِرَبِّ, then goes BACK to re-recite it — it must turn correct again
    # and the cursor must resume from just after it.
    session = create_session(114, 1, 2, include_bismillah=False)
    process_transcription(session, "قل اعوذ")        # positions 0,1 correct; cursor at بِرَبِّ
    process_transcription(session, "الناس")            # بِرَبِّ (idx6) skipped, ٱلنَّاسِ (idx7) revealed
    assert session.results[6]["status"] == "skipped"

    results = process_transcription(session, "برب")     # reciter returns to fix بِرَبِّ
    fixed = [result for result in results if result["wordIndex"] == 6]
    assert len(fixed) == 1 and fixed[0]["status"] == "correct"
    assert session.results[6]["status"] == "correct"
    assert session.current_word_index == 3              # resumes just after the fixed word


def test_forward_recitation_leaves_skipped_word_alone():
    # If the reciter skips a word and simply keeps reciting forward (does NOT go back),
    # backtracking must not fire: the skipped word stays skipped, untouched.
    session = create_session(114, 1, 2, include_bismillah=False)
    process_transcription(session, "قل اعوذ")        # cursor at بِرَبِّ
    process_transcription(session, "الناس")            # بِرَبِّ skipped, cursor at مَلِكِ
    results = process_transcription(session, "ملك الناس")  # continues forward into ayah 2
    assert session.results[6]["status"] == "skipped"   # still skipped — never auto-corrected
    assert session.is_complete
    assert all(result["wordIndex"] in (8, 9) for result in results)
