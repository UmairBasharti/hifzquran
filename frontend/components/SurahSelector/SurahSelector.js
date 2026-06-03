"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { fetchSurahIndex, filterSurahs } from "../../lib/quran";
import { surahMeanings } from "../../lib/surah_meanings";

export default function SurahSelector() {
  const router = useRouter();
  const [surahs, setSurahs] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      const data = await fetchSurahIndex();
      setSurahs(data);
      setIsLoading(false);
    }
    loadData();
  }, []);

  const filteredSurahs = filterSurahs(searchQuery, surahs);

  return (
    <div className="w-full max-w-7xl mx-auto px-4 md:px-0">
      
      {/* Search Bar */}
      <div className="relative mb-8 max-w-2xl mx-auto">
        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
          <Search className="h-5 w-5 text-gray-400" />
        </div>
        <input
          type="text"
          className="block w-full pl-11 pr-4 py-3 bg-white border border-gray-300 rounded-full text-base placeholder-gray-400 text-gray-900 focus:outline-none focus:border-[#2ca4ab] focus:ring-1 focus:ring-[#2ca4ab] transition-colors"
          placeholder="What do you want to memorize? (e.g. Yaseen, 36, يس)"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Tabs placeholder to match Quran.com */}
      <div className="border-b border-gray-200 mb-6 flex items-center gap-6">
        <button className="pb-3 border-b-2 border-[#2ca4ab] font-semibold text-gray-900 text-sm">Surah</button>
        <button className="pb-3 border-b-2 border-transparent text-gray-500 font-medium text-sm hover:text-gray-900">Juz</button>
        <button className="pb-3 border-b-2 border-transparent text-gray-500 font-medium text-sm hover:text-gray-900">Revelation Order</button>
      </div>

      {/* Loading Skeleton */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(12)].map((_, i) => (
            <div key={i} className="bg-white border border-gray-200 rounded h-20 animate-pulse"></div>
          ))}
        </div>
      )}

      {/* Surah Grid */}
      {!isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredSurahs.map((surah) => (
            <div
              key={surah.number}
              onClick={() => router.push(`/hifz/${surah.number}`)}
              className="group flex items-center justify-between p-4 bg-white border border-gray-200 hover:border-[#2ca4ab] rounded transition-colors duration-150 cursor-pointer"
            >
              {/* Left Side: Number & English Name */}
              <div className="flex items-center gap-5">
                {/* Quran.com style Diamond Number Badge */}
                <div className="relative w-9 h-9 flex items-center justify-center ml-1">
                  <div className="absolute inset-0 bg-gray-100 group-hover:bg-[#2ca4ab] transform rotate-45 rounded-sm transition-colors duration-150"></div>
                  <span className="relative z-10 text-sm font-bold text-gray-800 group-hover:text-white transition-colors duration-150">
                    {surah.number}
                  </span>
                </div>
                
                <div className="flex flex-col justify-center">
                  <h3 className="text-base font-bold text-gray-900 leading-tight">
                    {surah.nameSimple}
                  </h3>
                  <span className="text-[13px] text-gray-500 font-medium mt-0.5">
                    {surahMeanings[surah.number] || `Surah ${surah.number}`}
                  </span>
                </div>
              </div>

              {/* Right Side: Arabic Name & Ayah Count */}
              <div className="flex flex-col items-end justify-center">
                <span 
                  className="text-2xl font-uthmanic text-gray-800 leading-none" 
                  dir="rtl" 
                  lang="ar"
                >
                  {surah.nameArabic}
                </span>
                <span className="text-[12px] font-semibold text-gray-500 group-hover:text-[#2ca4ab] mt-1 transition-colors duration-150">
                  {surah.ayahCount} Ayahs
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && filteredSurahs.length === 0 && (
        <div className="text-center py-20">
          <p className="text-gray-500 text-lg">No Surahs found matching "{searchQuery}"</p>
        </div>
      )}

    </div>
  );
}
