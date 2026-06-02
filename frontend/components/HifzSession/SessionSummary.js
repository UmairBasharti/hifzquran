"use client";

import { useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, XCircle, SkipForward, Save, ArrowLeft, Loader2, Volume2 } from "lucide-react";

// Human-readable labels for the backend tajweed error types (API.md §errorType).
const ERROR_LABELS = {
  missing_shadda: "Missing shadda",
  wrong_harakat: "Wrong vowel",
  missing_tanwin: "Missing tanwin",
  wrong_word: "Wrong word",
  pronunciation_error: "Pronunciation error",
};

const ERROR_TIPS = {
  missing_shadda: "Hold this sound slightly longer to emphasize the double consonant.",
  wrong_harakat: "Pay closer attention to the vowel (Fatha/Damma/Kasra).",
  missing_tanwin: "Ensure you pronounce the 'n' sound at the end of the word.",
  wrong_word: "The spoken word did not match the text.",
  pronunciation_error: "The pronunciation was unclear or incorrect.",
};

export default function SessionSummary({
  surahNumber,
  startAyah,
  endAyah,
  summaryData,
  wordResults = [],
}) {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);

  const playingAudioRef = useRef(null);
  const [playingWordIdx, setPlayingWordIdx] = useState(null);

  const playAudio = (url, idx) => {
    if (playingAudioRef.current) {
      playingAudioRef.current.pause();
    }
    if (!url) return;
    
    setPlayingWordIdx(idx);
    const audio = new Audio(url);
    playingAudioRef.current = audio;
    
    audio.onended = () => setPlayingWordIdx(null);
    audio.play().catch(err => {
      console.error("Playback failed:", err);
      setPlayingWordIdx(null);
    });
  };

  // Derive counts from the per-word results, which persist across reconnects — after a
  // mid-session WebSocket drop the backend summary only reflects post-reconnect words, while
  // wordResults holds the full session. totalWords (the range size) stays from the backend
  // summary with a safe fallback.
  const correctCount = wordResults.filter((word) => word.status === "correct").length;
  const wrongCount = wordResults.filter((word) => word.status === "wrong").length;
  const skippedCount = wordResults.filter((word) => word.status === "skipped").length;
  const totalWords = summaryData?.totalWords ?? wordResults.length;
  const completionRate = totalWords > 0 ? Math.round((correctCount / totalWords) * 1000) / 10 : 0;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Proxy to our Next.js API route which forwards to the Python backend.
      // Body shape must match API.md §POST /session exactly.
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          surahNumber,
          startAyah,
          endAyah,
          totalWords,
          correctCount,
          wrongCount,
          skippedCount,
          wordResults: wordResults.map((word) => ({
            wordIndex: word.wordIndex,
            status: word.status,
            expected: word.text,
            spoken: word.spoken,
            errorType: word.errorType,
          })),
        })
      });

      if (res.ok) {
        setSaveStatus("success");
        setTimeout(() => router.push("/"), 1500);
      } else {
        setSaveStatus("error");
      }
    } catch (err) {
      setSaveStatus("error");
    } finally {
      setIsSaving(false);
    }
  };

  const pagesUsed = useMemo(() => {
    const pageSet = new Set(wordResults.map((w) => w.page).filter(Boolean));
    return Array.from(pageSet).sort((a, b) => a - b);
  }, [wordResults]);

  const fontFaceCss = useMemo(
    () =>
      pagesUsed
        .map(
          (page) =>
            `@font-face{font-family:'qcf-p${page}';src:url('/fonts/qcf/p${page}.woff2') format('woff2');font-display:block;}`
        )
        .join(""),
    [pagesUsed]
  );

  return (
    <div className="w-full max-w-2xl mx-auto bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden animate-in fade-in zoom-in-95 duration-300">
      <style>{fontFaceCss}</style>
      {/* Header */}
      <div className="bg-gray-50 px-8 py-6 border-b border-gray-100 text-center">
        <h2 className="text-2xl font-bold text-gray-900">Session Complete</h2>
        <p className="text-gray-500 mt-1">Here is how you performed.</p>
      </div>

      <div className="p-8 flex flex-col items-center">
        
        {/* Circular Progress Ring */}
        <div className="relative w-40 h-40 flex items-center justify-center mb-8">
          <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="45" fill="none" stroke="#F3F4F6" strokeWidth="8" />
            <circle 
              cx="50" cy="50" r="45" 
              fill="none" 
              stroke="#2ca4ab" 
              strokeWidth="8" 
              strokeLinecap="round"
              strokeDasharray="283"
              strokeDashoffset={283 - (283 * completionRate) / 100}
              className="transition-all duration-1000 ease-out"
            />
          </svg>
          <div className="absolute flex flex-col items-center justify-center">
            <span className="text-3xl font-bold text-gray-900">{completionRate}%</span>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Accuracy</span>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="w-full grid grid-cols-3 gap-4 mb-10">
          <div className="flex flex-col items-center p-4 bg-emerald-50 rounded-xl border border-emerald-100">
            <CheckCircle className="w-6 h-6 text-emerald-500 mb-2" />
            <span className="text-2xl font-bold text-emerald-700">{correctCount}</span>
            <span className="text-xs font-medium text-emerald-600 uppercase">Correct</span>
          </div>
          
          <div className="flex flex-col items-center p-4 bg-red-50 rounded-xl border border-red-100">
            <XCircle className="w-6 h-6 text-red-500 mb-2" />
            <span className="text-2xl font-bold text-red-700">{wrongCount}</span>
            <span className="text-xs font-medium text-red-600 uppercase">Mistakes</span>
          </div>

          <div className="flex flex-col items-center p-4 bg-gray-50 rounded-xl border border-gray-200">
            <SkipForward className="w-6 h-6 text-gray-400 mb-2" />
            <span className="text-2xl font-bold text-gray-700">{skippedCount}</span>
            <span className="text-xs font-medium text-gray-500 uppercase">Skipped</span>
          </div>
        </div>

        {/* Word Breakdown */}
        {wordResults.length > 0 && (
          <div className="w-full mb-10 border-t border-gray-100 pt-8 flex flex-col items-center">
            <h3 className="text-lg font-bold text-gray-900 mb-6 text-center">Word-by-Word Breakdown</h3>
            <div className="flex flex-wrap justify-center gap-x-3 gap-y-6" dir="rtl" lang="ar">
              {wordResults.map((word, idx) => {
                let colorClass = "text-gray-400";
                if (word.status === "correct") colorClass = "text-emerald-600";
                else if (word.status === "wrong") colorClass = "text-red-500";
                else if (word.status === "skipped") colorClass = "text-amber-500";

                const hasGlyph = Boolean(word.codeV1 && word.page);

                return (
                  <div key={idx} className="flex flex-col items-center">
                    <span
                      className={`text-2xl md:text-3xl leading-none ${colorClass} ${hasGlyph ? "" : "font-uthmanic"}`}
                      style={hasGlyph ? { fontFamily: `qcf-p${word.page}` } : undefined}
                    >
                      {hasGlyph ? word.codeV1 : word.text}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Mistakes Breakdown Cards */}
        {(wrongCount > 0 || skippedCount > 0) && (
          <div className="w-full mb-10 pt-8 flex flex-col items-center">
            <h3 className="text-lg font-bold text-gray-900 mb-6 text-center">Detailed Mistakes & Skips</h3>
            <div className="w-full flex flex-col gap-6">
              {wordResults.filter(w => w.status === "wrong" || w.status === "skipped").map((word, idx) => {
                const hasGlyph = Boolean(word.codeV1 && word.page);
                const isSkipped = word.status === "skipped";
                const title = isSkipped ? "Skipped Word" : (ERROR_LABELS[word.errorType] || "Pronunciation Error");
                const tip = isSkipped ? "You skipped this word before it was confirmed." : (ERROR_TIPS[word.errorType] || ERROR_TIPS["pronunciation_error"]);
                
                return (
                  <div key={idx} className="bg-[#fef9f4] border border-[#f5e6d3] rounded-2xl p-6 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-lg font-bold text-gray-900">{title}</h4>
                      <span className={`text-xs font-semibold uppercase tracking-wider px-3 py-1 rounded-full text-right ${
                        isSkipped 
                          ? "text-amber-800 bg-amber-100/50" 
                          : ["wrong_word", "pronunciation_error"].includes(word.errorType)
                            ? "text-red-800 bg-red-100/50"
                            : "text-orange-800 bg-orange-100/50"
                      }`} dir={isSkipped || ["wrong_word", "pronunciation_error"].includes(word.errorType) ? "ltr" : "rtl"}>
                        {isSkipped ? "Skipped" : ["wrong_word", "pronunciation_error"].includes(word.errorType) ? "Wrong word" : "خطأ تجويد"}
                      </span>
                    </div>

                    {/* Actual Word Box */}
                    <div className="bg-white border border-gray-200 rounded-xl p-6 mb-4 flex items-center justify-between relative h-32">
                      <div className="absolute top-4 left-4">
                        <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Correct word / Listen</span>
                      </div>
                      <div className="flex-1 flex justify-center mt-4">
                        <span
                          className={`text-5xl text-gray-900 ${hasGlyph ? "" : "font-uthmanic"}`}
                          style={hasGlyph ? { fontFamily: `qcf-p${word.page}` } : undefined}
                          dir="rtl"
                          lang="ar"
                        >
                          {hasGlyph ? word.codeV1 : word.text}
                        </span>
                      </div>
                      {word.audioUrl && (
                        <button
                          onClick={() => playAudio(word.audioUrl, idx)}
                          className={`absolute right-6 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full flex items-center justify-center transition-colors shadow-sm border ${
                            playingWordIdx === idx 
                              ? "bg-teal-50 text-teal-600 border-teal-200" 
                              : "bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-200"
                          }`}
                          title="Play correct pronunciation"
                        >
                          {playingWordIdx === idx ? (
                            <Loader2 className="w-5 h-5 ml-0.5 animate-spin" />
                          ) : (
                            <Volume2 className="w-5 h-5 ml-0.5" />
                          )}
                        </button>
                      )}
                    </div>

                    <div className="w-full mb-4">
                      {/* You Said Box */}
                      <div className={`${isSkipped ? "bg-amber-50/30 border-amber-100" : "bg-red-50/30 border-red-100"} rounded-xl p-4 flex flex-col items-center justify-center`}>
                        <span className={`text-[10px] font-bold uppercase tracking-widest mb-3 self-start ${isSkipped ? "text-amber-500" : "text-red-400"}`}>You Said</span>
                        <span className="text-3xl font-medium text-gray-900" dir="rtl" lang="ar">
                          {word.spoken || "—"}
                        </span>
                      </div>
                    </div>

                    {/* How to fix it */}
                    <div className="bg-white border border-gray-200 rounded-xl p-4">
                      <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">How to fix it</span>
                      <p className="text-sm text-gray-700 font-medium">
                        <span className="font-semibold text-gray-900">Rule:</span> {tip}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="w-full flex flex-col sm:flex-row gap-3">
          <button 
            onClick={() => router.push("/")}
            className="flex-1 flex items-center justify-center gap-2 px-6 py-3.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-full font-semibold transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Discard
          </button>
          
          <button 
            onClick={handleSave}
            disabled={isSaving || saveStatus === "success"}
            className="flex-1 flex items-center justify-center gap-2 px-6 py-3.5 bg-[#2ca4ab] hover:bg-teal-600 text-white rounded-full font-bold shadow-sm transition-colors disabled:opacity-70"
          >
            {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
            {saveStatus === "success" ? "Saved!" : "Save Session"}
          </button>
        </div>

        {saveStatus === "error" && (
          <p className="text-red-500 text-sm mt-4">Failed to save session. Please try again.</p>
        )}

      </div>
    </div>
  );
}
