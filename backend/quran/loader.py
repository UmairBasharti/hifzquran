import asyncio
import json
import os

import httpx

from quran.normalization import normalize_for_match

# Module-level shared state — loaded once at startup, shared across all requests.
# Never access QURAN_DATA before QURAN_LOADED is True.
QURAN_DATA = {}
QURAN_LOADED = False

# Path to the cached JSON file on disk — lives next to this file
DATA_FILE_PATH = os.path.join(os.path.dirname(__file__), "quran_data.json")

# Delay between API requests to stay within api.quran.com's 100 req/min rate limit
DELAY_BETWEEN_REQUESTS_SECONDS = 0.5


# Load all Quran data at startup — called once from main.py lifespan event.
# If quran_data.json exists on disk, load from cache (fast path).
# Otherwise fetch all 114 surahs from api.quran.com and save to disk.
# Raises on any failure — server must refuse to start with missing or corrupt Quran data.
async def load_quran_data():
    global QURAN_DATA, QURAN_LOADED

    quran_api_base_url = os.getenv("QURAN_API_BASE_URL", "https://api.quran.com/api/v4")

    # Fast path: load from disk cache if it exists
    if os.path.exists(DATA_FILE_PATH):
        try:
            with open(DATA_FILE_PATH, "r", encoding="utf-8") as cache_file:
                QURAN_DATA = json.load(cache_file)
            QURAN_LOADED = True
            print(f"Quran data loaded from cache ({len(QURAN_DATA)} surahs).")
            return
        except Exception as cache_error:
            print(f"Cache file is corrupt — re-fetching from API. Error: {cache_error}")

    # Slow path: fetch from api.quran.com (runs once, ~60-90 seconds)
    print("Fetching Quran data from api.quran.com (this takes ~60-90s on first run only)...")

    async with httpx.AsyncClient(timeout=30.0) as http_client:

        # Fetch all 114 chapter names in a single request
        chapter_info_map = await fetch_all_chapter_info(http_client, quran_api_base_url)
        await asyncio.sleep(DELAY_BETWEEN_REQUESTS_SECONDS)

        # Process Surah 1 (Al-Fatihah) first — we extract its verse 1 words as the
        # basmala source for all other surahs. Surah 1 itself gets bismillah = null
        # because in Hafs numbering the basmala IS Ayah 1 (7 total ayahs).
        surah_1_verses = await fetch_chapter_verses(http_client, 1, quran_api_base_url)
        basmala_word_objects = extract_basmala_from_verse_1(surah_1_verses)

        QURAN_DATA["1"] = build_surah_entry(
            chapter_info=chapter_info_map[1],
            verses=surah_1_verses,
            bismillah=None,       # Surah 1: basmala IS ayah 1, not a separate header
            first_word_index=0    # No bismillah prefix, so ayah words start at index 0
        )
        print("Processed Surah 1 of 114")
        await asyncio.sleep(DELAY_BETWEEN_REQUESTS_SECONDS)

        # Fetch and process the remaining 113 surahs
        for surah_number in range(2, 115):
            try:
                verses = await fetch_chapter_verses(http_client, surah_number, quran_api_base_url)

                # Surah 9 (At-Tawbah) has no bismillah — unique in the entire Quran
                if surah_number == 9:
                    bismillah_data = None
                    first_word_index = 0
                else:
                    # All other surahs use the 4 basmala words sourced from Surah 1 verse 1.
                    # Never reconstruct basmala from memory — always use this source.
                    bismillah_data = {"words": basmala_word_objects}
                    first_word_index = 4  # Bismillah occupies indices 0-3

                QURAN_DATA[str(surah_number)] = build_surah_entry(
                    chapter_info=chapter_info_map[surah_number],
                    verses=verses,
                    bismillah=bismillah_data,
                    first_word_index=first_word_index
                )
                print(f"Processed Surah {surah_number} of 114")

            except Exception as surah_error:
                error_message = f"Quran data fetch failed at Surah {surah_number}: {surah_error}"
                print(f"ERROR: {error_message}")
                raise RuntimeError(error_message)

            await asyncio.sleep(DELAY_BETWEEN_REQUESTS_SECONDS)

    # Save processed data to disk for all future startups
    try:
        with open(DATA_FILE_PATH, "w", encoding="utf-8") as output_file:
            json.dump(QURAN_DATA, output_file, ensure_ascii=False, indent=2)
        print("Quran data saved to cache successfully.")
    except Exception as save_error:
        raise RuntimeError(f"Failed to save quran_data.json to disk: {save_error}")

    QURAN_LOADED = True
    print(f"Quran data fully loaded and ready ({len(QURAN_DATA)} surahs).")


# Fetch chapter names and metadata for all 114 surahs in a single API call.
# Returns a dict keyed by surah number (integer).
async def fetch_all_chapter_info(http_client, quran_api_base_url):
    chapters_url = f"{quran_api_base_url}/chapters?language=en"
    response = await http_client.get(chapters_url)

    if response.status_code != 200:
        raise RuntimeError(
            f"Failed to fetch chapter metadata from {chapters_url}: HTTP {response.status_code}"
        )

    chapters_list = response.json().get("chapters", [])
    chapter_info_map = {}

    for chapter in chapters_list:
        chapter_number = chapter["id"]
        chapter_info_map[chapter_number] = {
            "nameSimple": chapter["name_simple"],
            "nameArabic": chapter["name_arabic"],
            "totalAyahs": chapter["verses_count"]
        }

    if len(chapter_info_map) != 114:
        raise RuntimeError(
            f"Expected 114 chapters from API, got {len(chapter_info_map)}"
        )

    return chapter_info_map


# Fetch all verses for a single surah with their Uthmani word data.
# Uses per_page=300 which covers Al-Baqarah (286 verses — the longest surah).
async def fetch_chapter_verses(http_client, surah_number, quran_api_base_url):
    # text_uthmani drives ASR alignment; code_v1 + v1_page + line_number drive the
    # exact Madani-Mushaf QCF glyph rendering (each word is one page-specific glyph).
    verses_url = (
        f"{quran_api_base_url}/verses/by_chapter/{surah_number}"
        "?words=true&word_fields=text_uthmani,code_v1,v1_page,line_number,audio_url&per_page=300"
    )
    response = await http_client.get(verses_url)

    if response.status_code != 200:
        raise RuntimeError(
            f"Failed to fetch verses for Surah {surah_number}: HTTP {response.status_code}"
        )

    return response.json().get("verses", [])


# Build one display+alignment word object from a raw API word.
# text/textStripped are for ASR alignment; codeV1/page/line are for QCF glyph display.
def build_word_object(raw_word, index):
    return {
        "index": index,
        "text": raw_word["text_uthmani"],
        "textStripped": normalize_for_match(raw_word["text_uthmani"]),
        "codeV1": raw_word.get("code_v1"),
        "page": raw_word.get("v1_page"),
        "line": raw_word.get("line_number"),
        "audioUrl": f"https://verses.quran.com/{raw_word['audio_url']}" if raw_word.get("audio_url") else None,
    }


# Build the QCF glyph object for a verse-end marker (the decorative ayah-number symbol).
def build_end_marker(raw_word):
    return {
        "codeV1": raw_word.get("code_v1"),
        "page": raw_word.get("v1_page"),
        "line": raw_word.get("line_number"),
    }


# Extract the 4 basmala words from Surah 1 Verse 1.
# These are used as the bismillah field for all surahs except 1 and 9.
# Raises if the verse does not yield exactly 4 words — fail-closed by design.
def extract_basmala_from_verse_1(surah_1_verses):
    if not surah_1_verses:
        raise RuntimeError("Cannot extract basmala: Surah 1 returned no verses from API")

    verse_1 = surah_1_verses[0]
    raw_words = verse_1.get("words", [])
    basmala_words = []
    basmala_index = 0

    for raw_word in raw_words:
        # Doc Correction 4: drop the verse-end glyph (char_type_name == "end")
        if raw_word.get("char_type_name") != "word":
            continue

        basmala_words.append(build_word_object(raw_word, basmala_index))
        basmala_index += 1

    if len(basmala_words) != 4:
        raise RuntimeError(
            f"Expected exactly 4 basmala words from Surah 1 Verse 1, got {len(basmala_words)}"
        )

    return basmala_words


# Build the complete structured surah entry from raw API verse data.
# Assigns sequential global word indices starting from first_word_index.
# Recitable words (char_type_name == "word") go in ayah.words; the verse-end glyph
# is kept separately as ayah.end so it can be rendered but never treated as a word.
def build_surah_entry(chapter_info, verses, bismillah, first_word_index):
    running_word_index = first_word_index
    processed_ayahs = []

    for verse in verses:
        ayah_number = verse.get("verse_number")
        raw_words = verse.get("words", [])
        processed_words = []
        end_marker = None

        for raw_word in raw_words:
            if raw_word.get("char_type_name") == "end":
                # The decorative ayah-number glyph — display only, never recited.
                end_marker = build_end_marker(raw_word)
                continue
            if raw_word.get("char_type_name") != "word":
                continue

            processed_words.append(build_word_object(raw_word, running_word_index))
            running_word_index += 1

        processed_ayahs.append({
            "ayahNumber": ayah_number,
            "words": processed_words,
            "end": end_marker
        })

    return {
        "nameSimple": chapter_info["nameSimple"],
        "nameArabic": chapter_info["nameArabic"],
        "totalAyahs": chapter_info["totalAyahs"],
        "bismillah": bismillah,
        "ayahs": processed_ayahs
    }


# Return the full structured data dict for a surah number (1-114).
# Returns None if data is not loaded or surah number is invalid.
def get_surah(surah_number):
    if not QURAN_LOADED:
        return None
    return QURAN_DATA.get(str(surah_number))


# Return a flat ordered word list for the given ayah range — used by the alignment engine.
# include_bismillah=True adds basmala words at the front (full surah mode).
# include_bismillah=False starts directly at the first word of start_ayah (custom range mode).
def get_word_list(surah_number, start_ayah, end_ayah, include_bismillah):
    surah = get_surah(surah_number)
    if surah is None:
        return []

    word_list = []

    # Add bismillah words at the front if requested and available for this surah
    if include_bismillah and surah.get("bismillah") is not None:
        word_list.extend(surah["bismillah"]["words"])

    # Add only the words within the selected ayah range
    for ayah in surah["ayahs"]:
        if start_ayah <= ayah["ayahNumber"] <= end_ayah:
            word_list.extend(ayah["words"])

    return word_list
