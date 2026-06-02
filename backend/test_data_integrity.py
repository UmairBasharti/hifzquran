import json
import os
import pytest

DATA_FILE_PATH = os.path.join(os.path.dirname(__file__), "quran", "quran_data.json")

@pytest.fixture(scope="module")
def quran_data():
    with open(DATA_FILE_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

def test_has_114_surahs(quran_data):
    assert len(quran_data) == 114, "Quran data must contain exactly 114 surahs"
    for i in range(1, 115):
        assert str(i) in quran_data, f"Surah {i} is missing"

def test_bismillah_rules(quran_data):
    # Surah 1: Bismillah is None (since it's Ayah 1)
    assert quran_data["1"]["bismillah"] is None
    
    # Surah 9: Bismillah is None
    assert quran_data["9"]["bismillah"] is None
    
    # All other surahs: Bismillah must be present and contain exactly 4 words
    for i in range(2, 115):
        if i == 9:
            continue
        bismillah = quran_data[str(i)]["bismillah"]
        assert bismillah is not None, f"Surah {i} is missing Bismillah"
        words = bismillah.get("words", [])
        assert len(words) == 4, f"Surah {i} Bismillah must have exactly 4 words, got {len(words)}"
        
        # Bismillah word indices should be 0, 1, 2, 3
        for idx, w in enumerate(words):
            assert w["index"] == idx, f"Surah {i} Bismillah word {idx} has wrong index {w['index']}"

def test_sequential_unique_indices(quran_data):
    for surah_num, surah in quran_data.items():
        expected_index = 0
        if surah_num != "1" and surah_num != "9":
            expected_index = 4  # Ayahs start after 4 Bismillah words
            
        for ayah in surah["ayahs"]:
            for word in ayah["words"]:
                assert word["index"] == expected_index, f"Surah {surah_num} Ayah {ayah['ayahNumber']} expected word index {expected_index}, got {word['index']}"
                expected_index += 1

def test_word_attributes(quran_data):
    for surah_num, surah in quran_data.items():
        # Check Bismillah words
        bismillah = surah.get("bismillah")
        if bismillah:
            for word in bismillah["words"]:
                assert word.get("codeV1") is not None, f"Surah {surah_num} Bismillah missing codeV1"
                assert word.get("page") is not None, f"Surah {surah_num} Bismillah missing page"
                assert word.get("line") is not None, f"Surah {surah_num} Bismillah missing line"
                
        # Check Ayah words
        for ayah in surah["ayahs"]:
            for word in ayah["words"]:
                assert word.get("codeV1") is not None, f"Surah {surah_num} Ayah {ayah['ayahNumber']} missing codeV1"
                assert word.get("page") is not None, f"Surah {surah_num} Ayah {ayah['ayahNumber']} missing page"
                assert word.get("line") is not None, f"Surah {surah_num} Ayah {ayah['ayahNumber']} missing line"

def test_ayah_counts(quran_data):
    for surah_num, surah in quran_data.items():
        expected_total = surah["totalAyahs"]
        actual_total = len(surah["ayahs"])
        assert actual_total == expected_total, f"Surah {surah_num} expected {expected_total} ayahs, got {actual_total}"
        
        # Check ayah numbering is sequential starting from 1
        for idx, ayah in enumerate(surah["ayahs"]):
            expected_ayah_num = idx + 1
            assert ayah["ayahNumber"] == expected_ayah_num, f"Surah {surah_num} expected Ayah {expected_ayah_num}, got {ayah['ayahNumber']}"

def test_end_glyph_present(quran_data):
    for surah_num, surah in quran_data.items():
        for ayah in surah["ayahs"]:
            end_marker = ayah.get("end")
            assert end_marker is not None, f"Surah {surah_num} Ayah {ayah['ayahNumber']} missing end marker"
            assert end_marker.get("codeV1") is not None, f"Surah {surah_num} Ayah {ayah['ayahNumber']} end marker missing codeV1"
            assert end_marker.get("page") is not None, f"Surah {surah_num} Ayah {ayah['ayahNumber']} end marker missing page"
            assert end_marker.get("line") is not None, f"Surah {surah_num} Ayah {ayah['ayahNumber']} end marker missing line"
