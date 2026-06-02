import SurahSelector from "../components/SurahSelector/SurahSelector";

export default function Home() {
  return (
    <main className="min-h-screen bg-white flex flex-col items-center">
      
      {/* Header - Simple, clean, Quran.com aesthetic */}
      <header className="w-full bg-white z-10">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Logo placeholder - using text to mimic a clean brand logo */}
            <span className="text-xl font-bold text-[#2ca4ab] tracking-tight">HifzAI</span>
            <span className="text-sm font-medium text-gray-400 mt-1 ml-1 hidden sm:inline-block">
              Free Quran Memorization
            </span>
          </div>
          
          <div className="flex items-center gap-4 text-sm font-medium text-gray-500">
            <a href="https://github.com/UmairBasharti/hifzai" target="_blank" rel="noreferrer" className="hover:text-[#2ca4ab] transition-colors">
              About
            </a>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="w-full max-w-7xl mx-auto px-4 pt-12 pb-8 flex flex-col items-center text-center">
        <h1 className="text-3xl md:text-5xl font-bold text-gray-900 tracking-tight mb-4">
          Memorize the Quran
        </h1>
        <p className="text-lg text-gray-500 max-w-2xl">
          Test your memorization in real-time. Just press the mic and start reciting. 
          HifzAI will listen, hide the text, and instantly flag any mistakes.
        </p>
      </section>

      {/* Main Content Area */}
      <section className="w-full max-w-7xl mx-auto px-4 pb-20 flex-grow">
        <SurahSelector />
      </section>

    </main>
  );
}
