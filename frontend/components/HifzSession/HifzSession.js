"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { Mic, Square, SkipForward, AlertCircle, Loader2 } from "lucide-react";
import WordRenderer from "./WordRenderer";
import SessionSummary from "./SessionSummary";
import { AudioRecorder } from "../../lib/audio";
import { openHifzSession } from "../../lib/websocket";
import { useRouter } from "next/navigation";

// Diagnostic helper — logs each chunk's size + peak amplitude so the browser console shows
// whether the mic is capturing non-silent audio and reaching an OPEN socket. Remove later.
function logAudioChunk(float32Chunk, socketIsOpen) {
  let peakAmplitude = 0;
  for (let sampleIndex = 0; sampleIndex < float32Chunk.length; sampleIndex++) {
    const amplitude = Math.abs(float32Chunk[sampleIndex]);
    if (amplitude > peakAmplitude) peakAmplitude = amplitude;
  }
  console.debug(`[audio→ws] ${float32Chunk.length} samples peak=${peakAmplitude.toFixed(4)} socketOpen=${socketIsOpen}`);
}

export default function HifzSession({ surahData, surahNumber }) {
  const router = useRouter();
  const [isRecording, setIsRecording] = useState(false);
  const [sessionMode, setSessionMode] = useState("hifz"); // "hifz" or "reading"
  const [results, setResults] = useState({});
  const [silenceAlert, setSilenceAlert] = useState(false);
  const [error, setError] = useState(null);
  const [volume, setVolume] = useState(0);
  const [reconnecting, setReconnecting] = useState(false);

  // Custom ayah-range selection (defaults to the whole Surah).
  const firstAyahNumber = surahData?.ayahs?.[0]?.ayahNumber ?? 1;
  const lastAyahNumber = surahData?.ayahs?.[surahData.ayahs.length - 1]?.ayahNumber ?? 1;
  const [startAyah, setStartAyah] = useState(firstAyahNumber);
  const [endAyah, setEndAyah] = useState(lastAyahNumber);

  // Full-Surah mode includes the Bismillah; custom ranges do not (PRD Feature 2).
  const isFullSurah = startAyah === firstAyahNumber && endAyah === lastAyahNumber;
  const includeBismillah = Boolean(surahData?.bismillah) && isFullSurah;

  const [isFinished, setIsFinished] = useState(false);
  const [summaryData, setSummaryData] = useState(null);

  // Refs to hold our active controllers so we can stop them
  const audioRecorderRef = useRef(null);
  const wsCleanupRef = useRef(null);
  const wsRef = useRef(null);
  const currentWordIndexRef = useRef(0);

  // 1. The exact words being tested this session: the selected ayah range, plus the
  // Bismillah only in full-Surah mode. Words outside this set stay visible.
  const sessionWords = useMemo(() => {
    if (!surahData) return [];
    const words = [];
    if (includeBismillah && surahData.bismillah) {
      words.push(...surahData.bismillah.words);
    }
    surahData.ayahs.forEach((ayah) => {
      if (ayah.ayahNumber >= startAyah && ayah.ayahNumber <= endAyah) {
        words.push(...ayah.words);
      }
    });
    return words;
  }, [surahData, includeBismillah, startAyah, endAyah]);

  // Set of global indices that belong to this session — the renderer hides only these.
  const sessionWordIndices = useMemo(
    () => new Set(sessionWords.map((word) => word.index)),
    [sessionWords]
  );

  // 2. Compute the active cursor: scan the session words until one is not yet done.
  const currentWordIndex = useMemo(() => {
    if (sessionWords.length === 0) return 0;

    let nextIndex = sessionWords[0].index;
    for (const word of sessionWords) {
      const res = results[word.index];
      if (res && (res.status === "correct" || res.status === "skipped")) {
        nextIndex = word.index + 1;
      } else {
        break;
      }
    }
    return nextIndex;
  }, [results, sessionWords]);

  // Keep a live ref of the cursor so a reconnect can resume from the right word.
  useEffect(() => {
    currentWordIndexRef.current = currentWordIndex;
  }, [currentWordIndex]);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopSession();
  }, []);

  const startSession = async () => {
    try {
      setError(null);
      setSilenceAlert(false);
      setResults({});
      setIsFinished(false);

      // 1. Open WebSocket to Python Backend
      const wsCleanup = openHifzSession({
        surahNumber,
        startAyah,
        endAyah,
        includeBismillah,
        getResumeIndex: () => currentWordIndexRef.current,
        onReady: (ws) => {
          wsRef.current = ws;
          setReconnecting(false); // (re)connected — clear the reconnecting banner
        },
        onReconnecting: () => {
          setReconnecting(true);
        },
        onWordResult: (res) => {
          setResults(prev => ({ ...prev, [res.wordIndex]: res }));
          setSilenceAlert(false); // Clear silence alert when speech is processed
        },
        onSilenceAlert: () => {
          setSilenceAlert(true);
        },
        onSessionComplete: (summary) => {
          setSummaryData(summary);
          setIsFinished(true);
          stopSession();
        },
        onError: (err) => {
          setError(err.message);
          stopSession();
        }
      });
      wsCleanupRef.current = wsCleanup;

      // 2. Start Microphone Capture (16kHz Float32 chunks) + Volume Tracking
      const recorder = new AudioRecorder(
        (float32Chunk) => {
          const socketIsOpen = wsRef.current && wsRef.current.readyState === WebSocket.OPEN;
          if (socketIsOpen) {
            // Send raw binary array buffer
            wsRef.current.send(float32Chunk.buffer);
          }
          logAudioChunk(float32Chunk, socketIsOpen);
        },
        (rmsVolume) => {
          setVolume(rmsVolume);
        }
      );
      await recorder.start();
      audioRecorderRef.current = recorder;
      
      setIsRecording(true);

    } catch (err) {
      console.error(err);
      setError(err.message || "Microphone permission denied or Web Audio error.");
      stopSession();
    }
  };

  const stopSession = () => {
    if (audioRecorderRef.current) {
      audioRecorderRef.current.stop();
      audioRecorderRef.current = null;
    }
    if (wsCleanupRef.current) {
      wsCleanupRef.current();
      wsCleanupRef.current = null;
    }
    wsRef.current = null;
    setIsRecording(false);
    setReconnecting(false);
  };

  const skipCurrentWord = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "skipWord",
        wordIndex: currentWordIndex
      }));
    }
  };

  if (!surahData || sessionWords.length === 0) {
    return <div className="text-center p-10 text-gray-500">No data available.</div>;
  }

  // Calculate progress percentage
  const totalWords = sessionWords.length;
  const processedWordsCount = Object.keys(results).length;
  const progressPercent = totalWords > 0 ? (processedWordsCount / totalWords) * 100 : 0;

  if (isFinished && summaryData) {
    // Build the per-word breakdown (used for saving AND the summary list) from the
    // final results. Carry the glyph fields so the breakdown can render Mushaf text.
    const wordResults = sessionWords
      .filter((word) => results[word.index])
      .map((word) => {
        const wordResult = results[word.index];
        return {
          wordIndex: word.index,
          status: wordResult.status,
          text: word.text,
          codeV1: word.codeV1,
          page: word.page,
          audioUrl: word.audioUrl ?? null,
          spoken: wordResult.spoken ?? null,
          errorType: wordResult.errorType ?? null,
        };
      });

    return (
      <div className="w-full mt-4">
        <SessionSummary
          surahNumber={surahNumber}
          startAyah={startAyah}
          endAyah={endAyah}
          summaryData={summaryData}
          wordResults={wordResults}
        />
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col items-center">

      {/* Error Alert */}
      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md flex items-center gap-2 max-w-2xl w-full">
          <AlertCircle className="w-5 h-5" />
          <span>{error}</span>
        </div>
      )}

      {/* Reconnecting banner — connection dropped, retrying every 3s */}
      {reconnecting && (
        <div className="mb-6 bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-md flex items-center gap-2 max-w-2xl w-full animate-in fade-in slide-in-from-top-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Reconnecting… your progress is saved, keep going in a moment.</span>
        </div>
      )}

      {/* Silence Alert */}
      {silenceAlert && isRecording && (
        <div className="mb-6 bg-amber-50 border border-amber-200 text-amber-700 px-4 py-3 rounded-md flex items-center justify-between gap-2 max-w-2xl w-full animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            <span>Having trouble hearing you — try speaking a little closer to the mic.</span>
          </div>
          <button 
            onClick={skipCurrentWord}
            className="px-3 py-1 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded text-sm font-medium transition-colors"
          >
            Skip Word
          </button>
        </div>
      )}

      {/* Settings Panel — only before recitation starts */}
      {!isRecording && (
        <div className="mb-6 flex flex-col items-center gap-4">
          
          {/* Mode Selector */}
          <div className="flex bg-gray-100 p-1 rounded-lg">
            <button
              onClick={() => setSessionMode("hifz")}
              className={`px-4 py-2 rounded-md text-sm font-semibold transition-all ${
                sessionMode === "hifz" ? "bg-white text-[#2ca4ab] shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Hifz Mode
            </button>
            <button
              onClick={() => setSessionMode("reading")}
              className={`px-4 py-2 rounded-md text-sm font-semibold transition-all ${
                sessionMode === "reading" ? "bg-white text-[#2ca4ab] shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Reading Mode
            </button>
          </div>

          {/* Custom ayah range */}
          <div className="flex flex-wrap items-center justify-center gap-3 text-sm">
            <span className="font-semibold text-gray-700">Range</span>
          <div className="flex items-center gap-2">
            <label className="text-gray-400">From</label>
            <select
              value={startAyah}
              onChange={(event) => {
                const value = parseInt(event.target.value, 10);
                setStartAyah(value);
                if (value > endAyah) setEndAyah(value);
              }}
              className="border border-gray-300 rounded-md px-2 py-1.5 bg-white text-gray-900 focus:outline-none focus:border-[#2ca4ab]"
            >
              {surahData.ayahs.map((ayah) => (
                <option key={ayah.ayahNumber} value={ayah.ayahNumber}>{ayah.ayahNumber}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-gray-400">To</label>
            <select
              value={endAyah}
              onChange={(event) => {
                const value = parseInt(event.target.value, 10);
                setEndAyah(value);
                if (value < startAyah) setStartAyah(value);
              }}
              className="border border-gray-300 rounded-md px-2 py-1.5 bg-white text-gray-900 focus:outline-none focus:border-[#2ca4ab]"
            >
              {surahData.ayahs.map((ayah) => (
                <option key={ayah.ayahNumber} value={ayah.ayahNumber}>{ayah.ayahNumber}</option>
              ))}
            </select>
          </div>
          {isFullSurah ? (
            <span className="text-xs font-medium text-[#2ca4ab] bg-[#2ca4ab]/10 px-2 py-1 rounded-full">
              Full Surah · Bismillah included
            </span>
          ) : (
            <button
              onClick={() => {
                setStartAyah(firstAyahNumber);
                setEndAyah(lastAyahNumber);
              }}
              className="text-xs font-medium text-gray-500 hover:text-[#2ca4ab] underline"
            >
              Reset to full Surah
            </button>
          )}
          </div>
        </div>
      )}

      {/* The Text Renderer */}
      <WordRenderer
        surahData={surahData}
        surahNumber={surahNumber}
        currentWordIndex={currentWordIndex}
        results={results}
        sessionMode={sessionMode}
        isRecording={isRecording}
        sessionWordIndices={sessionWordIndices}
      />

      {/* Fixed Bottom Controls */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-[0_-4px_6px_-1px_rgb(0,0,0,0.05)] px-4 py-4 pb-safe z-50">
        <div className="max-w-7xl mx-auto">
          
          {/* Progress Bar */}
          <div className="w-full h-1.5 bg-gray-100 rounded-full mb-4 overflow-hidden">
            <div 
              className="h-full bg-[#2ca4ab] transition-all duration-300 ease-out"
              style={{ width: `${progressPercent}%` }}
            ></div>
          </div>

          <div className="flex items-center justify-center gap-4">
            {!isRecording ? (
              <button
                onClick={startSession}
                className="flex items-center gap-2 bg-[#2ca4ab] hover:bg-teal-600 text-white px-8 py-3.5 rounded-full font-bold text-lg shadow-sm hover:shadow transition-all duration-200 active:scale-95"
              >
                <Mic className="w-5 h-5" />
                {Object.keys(results).length > 0 ? "Resume Reciting" : "Start Reciting"}
              </button>
            ) : (
              <div className="flex items-center gap-3">
                {/* Recording — red, labelled "Stop", with a live mic-reactive dot */}
                <button
                  onClick={stopSession}
                  className="relative flex items-center gap-2.5 bg-red-500 hover:bg-red-600 text-white px-7 py-3.5 rounded-full font-bold text-lg shadow-md transition-all duration-200 active:scale-95"
                  title="Stop reciting"
                >
                  <span className="relative flex items-center justify-center w-3 h-3">
                    <span
                      className="absolute inline-flex h-full w-full rounded-full bg-white/70"
                      style={{
                        transform: `scale(${1 + Math.min(volume * 8, 1.6)})`,
                        transition: "transform 0.06s ease-out",
                      }}
                    ></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-white animate-pulse"></span>
                  </span>
                  <Square className="w-4 h-4 fill-white" />
                  Stop Reciting
                </button>

                <button
                  onClick={skipCurrentWord}
                  className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 px-5 py-3.5 rounded-full font-bold shadow-sm transition-all duration-200 active:scale-95"
                  title="Skip current word"
                >
                  <SkipForward className="w-4 h-4" />
                  Skip
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Spacer to prevent content from hiding behind the fixed footer */}
      <div className="h-32"></div>

    </div>
  );
}
