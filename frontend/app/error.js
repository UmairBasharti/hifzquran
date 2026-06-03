"use client";

import { useEffect } from "react";
import { AlertCircle, RefreshCcw } from "lucide-react";
import Link from "next/link";

export default function Error({ error, reset }) {
  useEffect(() => {
    // Log the error to an error reporting service if needed
    console.error("Page Error:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-4 text-center">
      <div className="bg-red-50 p-4 rounded-full mb-6">
        <AlertCircle className="w-12 h-12 text-red-500" />
      </div>
      
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Something went wrong</h2>
      <p className="text-gray-500 mb-8 max-w-md">
        We encountered an issue loading this page. 
        {error.message && <span className="block mt-2 text-sm text-gray-400 font-mono break-all">{error.message}</span>}
      </p>
      
      <div className="flex gap-4">
        <button
          onClick={() => reset()}
          className="flex items-center gap-2 bg-[#2ca4ab] hover:bg-teal-600 text-white px-6 py-2.5 rounded-full font-medium transition-colors"
        >
          <RefreshCcw className="w-4 h-4" />
          Try again
        </button>
        <Link 
          href="/"
          className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 px-6 py-2.5 rounded-full font-medium transition-colors"
        >
          Go Home
        </Link>
      </div>
    </div>
  );
}
