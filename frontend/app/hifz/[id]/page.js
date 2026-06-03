import { notFound } from "next/navigation";
import HifzSession from "../../../components/HifzSession/HifzSession";
import { Loader2 } from "lucide-react";
import Link from "next/link";

async function getSurahData(id) {
  // Server Components run on the Node.js server, so they securely fetch
  // directly from the Python backend instead of routing through the Next.js API proxy.
  const backendUrl = process.env.PYTHON_BACKEND_URL || 
                     process.env.NEXT_PUBLIC_PYTHON_BACKEND_URL || 
                     "http://127.0.0.1:8000";
                     
  const res = await fetch(`${backendUrl}/surah/${id}`, { cache: "no-store" });
  
  if (res.ok) {
    return await res.json();
  }
  
  if (res.status === 404) {
    return null;
  }
  
  if (res.status === 503) {
    return { isWarmingUp: true };
  }
  
  // Only throw on genuine errors (non-503, non-404)
  throw new Error(`Failed to fetch surah data: ${res.status}`);
}

export default async function HifzPage({ params }) {
  const { id } = await params;
  const surahData = await getSurahData(id);

  if (!surahData) {
    notFound();
  }

  if (surahData.isWarmingUp) {
    return (
      <main className="min-h-screen bg-white flex flex-col items-center justify-center p-4">
        <div className="bg-amber-50 p-8 rounded-2xl max-w-md text-center border border-amber-100 shadow-sm">
           <Loader2 className="w-10 h-10 animate-spin text-amber-500 mx-auto mb-4" />
           <h2 className="text-xl font-bold text-gray-900 mb-2">Warming up the recogniser…</h2>
           <p className="text-gray-600 mb-8 text-sm">
             The AI model is currently loading into memory. This usually takes about 10–15 seconds on the first request.
           </p>
           <Link href={`/hifz/${id}`} className="inline-block bg-[#2ca4ab] hover:bg-teal-600 text-white font-semibold py-2.5 px-8 rounded-full transition-colors">
             Refresh Page
           </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white flex flex-col">
      {/* Main Content Area - Mounts the interactive client component */}
      <div className="flex-grow w-full">
        <HifzSession surahData={surahData} surahNumber={parseInt(id, 10)} />
      </div>
    </main>
  );
}
