import pytest
from tajweed.checker import classify_error

def test_wrong_word():
    # Base letters completely mismatch
    # "الحمد" vs "الله"
    assert classify_error("الحمد", "الله") == "wrong_word"

def test_missing_shadda():
    # Expected: مَدَّ (\u0645\u064e\u062f\u0651\u064e - Meem Fatha Dal Shadda Fatha)
    # Spoken: مَدَ (\u0645\u064e\u062f\u064e - Meem Fatha Dal Fatha)
    expected = "\u0645\u064e\u062f\u0651\u064e"
    spoken = "\u0645\u064e\u062f\u064e"
    assert classify_error(expected, spoken) == "missing_shadda"

def test_missing_tanwin():
    # Expected: أَحَدٌ (\u0623\u064e\u062d\u064e\u062f\u064c - ...Dal TanwinDamma)
    # Spoken: أَحَدُ (\u0623\u064e\u062d\u064e\u062f\u064f - ...Dal Damma)
    expected = "\u0623\u064e\u062d\u064e\u062f\u064c"
    spoken = "\u0623\u064e\u062d\u064e\u062f\u064f"
    assert classify_error(expected, spoken) == "missing_tanwin"

def test_wrong_harakat():
    # Expected: كُتِبَ (\u0643\u064f\u062a\u0650\u0628\u064e - Kaf Damma Ta Kasra Ba Fatha)
    # Spoken: كَتَبَ (\u0643\u064e\u062a\u064e\u0628\u064e - Kaf Fatha Ta Fatha Ba Fatha)
    expected = "\u0643\u064f\u062a\u0650\u0628\u064e"
    spoken = "\u0643\u064e\u062a\u064e\u0628\u064e"
    assert classify_error(expected, spoken) == "wrong_harakat"

def test_pronunciation_error():
    # Expected has vowels, but spoken has no vowels (e.g., ASR returns base word only).
    # Since expected_vowels and spoken_vowels are not BOTH truthy, it skips wrong_harakat and falls back.
    # Expected: كَتَبَ (\u0643\u064e\u062a\u064e\u0628\u064e)
    # Spoken: كتب (\u0643\u062a\u0628)
    expected = "\u0643\u064e\u062a\u064e\u0628\u064e"
    spoken = "\u0643\u062a\u0628"
    assert classify_error(expected, spoken) == "pronunciation_error"
