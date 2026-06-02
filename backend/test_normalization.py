import pytest
from quran.normalization import normalize_for_match, normalize_for_tashkeel

def test_alef_wasla():
    # ٱ (alef-wasla) should fold to ا
    # ٱلْكَوۡثَرَ
    text = '\u0671\u0644\u0652\u0643\u064e\u0648\u0652\u062b\u064e\u0631\u064e'
    expected = '\u0627\u0644\u0643\u0648\u062b\u0631'
    assert normalize_for_match(text) == expected

def test_dagger_alef():
    # Dagger alef (\u0670) should be stripped
    # ذَٰلِكَ (thal, fatha, dagger-alef, lam, kasra, kaf, fatha)
    text = '\u0630\u064e\u0670\u0644\u0650\u0643\u064e'
    expected = '\u0630\u0644\u0643'
    assert normalize_for_match(text) == expected

def test_hamza_variants():
    # أ, إ, آ should fold to ا
    assert normalize_for_match('أحمد') == 'احمد'
    assert normalize_for_match('إيمان') == 'ايمان'
    assert normalize_for_match('آية') == 'ايه'

def test_tatweel():
    # Tatweel (\u0640) should be stripped
    assert normalize_for_match('بــــســــم') == 'بسم'

def test_ta_marbuta():
    # ة (\u0629) should fold to ه (\u0647)
    assert normalize_for_match('مَكَّةَ') == 'مكه'

def test_tanwin_and_harakat():
    # Tanwin (ً ٌ ٍ) and Harakat (َ ِ ُ ّ ْ) should be stripped
    assert normalize_for_match('مُحَمَّدٌ') == 'محمد'

def test_normalize_for_tashkeel_keeps_diacritics():
    # Stage 2 keeps kasra/harakat but folds letters
    # ٱلرحيمِ -> الرَّحِيمِ
    text = '\u0671\u0644\u0631\u064e\u0651\u062d\u0650\u064a\u0645\u0650'
    expected = '\u0627\u0644\u0631\u064e\u0651\u062d\u0650\u064a\u0645\u0650'
    assert normalize_for_tashkeel(text) == expected

    # ta marbuta folded but keeps diacritic
    # مَكَّةَ -> مَكَّهَ
    text = '\u0645\u064e\u0643\u064e\u0651\u0629\u064e'
    expected = '\u0645\u064e\u0643\u064e\u0651\u0647\u064e'
    assert normalize_for_tashkeel(text) == expected
