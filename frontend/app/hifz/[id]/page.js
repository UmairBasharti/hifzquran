import { notFound } from "next/navigation";
import HifzSession from "../../../components/HifzSession/HifzSession";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

async function getSurahData(id) {
  // Server Components run on the Node.js server, so they securely fetch
  // directly from the Python backend instead of routing through the Next.js API proxy.
  const backendUrl = process.env.PYTHON_BACKEND_URL || 
                     process.env.NEXT_PUBLIC_PYTHON_BACKEND_URL || 
                     "http://127.0.0.1:8000";
                     
  const res = await fetch(`${backendUrl}/surah/${id}`, { cache: "no-store" });
  
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Failed to fetch surah data: ${res.status}`);
  }
  
  return res.json();
}

export default async function HifzPage({ params }) {
  const { id } = await params;
  const surahData = await getSurahData(id);

  if (!surahData) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-white flex flex-col">
      {/* Quran.com-style top bar */}
      <header className="w-full bg-white/90 backdrop-blur border-b border-gray-100 z-30 sticky top-0">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <Link
            href="/"
            className="flex items-center text-gray-500 hover:text-[#2ca4ab] transition-colors shrink-0"
            title="Back to Surahs"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="font-medium text-sm ml-2 hidden sm:inline">Back</span>
          </Link>

          <div className="flex items-center gap-3 min-w-0">
            <span className="relative w-7 h-7 shrink-0 flex items-center justify-center">
              <span className="absolute inset-0 bg-gray-100 rotate-45 rounded-sm" />
              <span className="relative z-10 text-xs font-bold text-gray-700">{id}</span>
            </span>
            <div className="flex flex-col leading-tight min-w-0">
              <span className="font-bold text-gray-900 text-sm truncate">{surahData.nameSimple}</span>
              <span className="text-[11px] text-gray-400 font-medium">
                {surahData.totalAyahs} Ayahs · Hifz Mode
              </span>
            </div>
          </div>

          <span
            className="font-uthmanic text-2xl text-gray-800 shrink-0 hidden sm:block leading-none pb-1"
            dir="rtl"
            lang="ar"
          >
            {surahData.nameArabic}
          </span>
        </div>
      </header>

      {/* Main Content Area - Mounts the interactive client component */}
      <div className="flex-grow w-full max-w-7xl mx-auto px-4 py-8">
        <HifzSession surahData={surahData} surahNumber={parseInt(id, 10)} />
      </div>
    </main>
  );
}
