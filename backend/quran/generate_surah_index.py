import json
import os

# Paths
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QURAN_DATA_FILE = os.path.join(BACKEND_DIR, "quran", "quran_data.json")

# Ensure frontend/public exists
FRONTEND_PUBLIC_DIR = os.path.join(os.path.dirname(BACKEND_DIR), "frontend", "public")
os.makedirs(FRONTEND_PUBLIC_DIR, exist_ok=True)

SURAH_INDEX_FILE = os.path.join(FRONTEND_PUBLIC_DIR, "surah_index.json")

def generate_index():
    print(f"Reading {QURAN_DATA_FILE}...")
    
    if not os.path.exists(QURAN_DATA_FILE):
        print("ERROR: quran_data.json not found! Run the backend server once to generate it.")
        exit(1)

    with open(QURAN_DATA_FILE, "r", encoding="utf-8") as f:
        quran_data = json.load(f)

    # Convert the dict to a sorted list of 114 surahs
    index_list = []
    
    for i in range(1, 115):
        surah_id = str(i)
        if surah_id not in quran_data:
            print(f"ERROR: Missing Surah {surah_id} in quran_data.json!")
            exit(1)
            
        surah = quran_data[surah_id]
        
        # Shape required by frontend SurahSelector
        index_list.append({
            "number": i,
            "nameSimple": surah["nameSimple"],
            "nameArabic": surah["nameArabic"],
            "ayahCount": surah["totalAyahs"]
        })

    print(f"Writing {len(index_list)} surah records to {SURAH_INDEX_FILE}...")
    with open(SURAH_INDEX_FILE, "w", encoding="utf-8") as f:
        json.dump(index_list, f, ensure_ascii=False, indent=2)
        
    print("Success!")

if __name__ == "__main__":
    generate_index()
