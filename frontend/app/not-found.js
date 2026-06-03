import Link from "next/link";
import { SearchX } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-4 text-center">
      <div className="bg-gray-100 p-4 rounded-full mb-6">
        <SearchX className="w-12 h-12 text-gray-400" />
      </div>
      
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Surah Not Found</h2>
      <p className="text-gray-500 mb-8 max-w-md">
        We couldn't find the Surah you're looking for. It might be an invalid number or the URL is incorrect.
      </p>
      
      <Link 
        href="/"
        className="bg-[#2ca4ab] hover:bg-teal-600 text-white px-8 py-3 rounded-full font-medium transition-colors"
      >
        Browse all Surahs
      </Link>
    </div>
  );
}
