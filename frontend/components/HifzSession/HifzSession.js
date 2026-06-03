"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Mic, Square, SkipForward, AlertCircle, Loader2, Check, ArrowLeft } from "lucide-react";
import Link from "next/link";
import AudioPlayer from "./AudioPlayer";
import WordRenderer from "./WordRenderer";
import SessionSummary from "./SessionSummary";
import { AudioRecorder } from "../../lib/audio";
import { openHifzSession } from "../../lib/websocket";

// Diagnostic helper — logs each chunk's size + peak amplitude so the browser console shows
// whether the mic is capturing non-silent audio and reaching an OPEN socket. Dev-only: the
// early return below is statically eliminated in production builds, so the per-sample peak
// scan never runs for real users (it fires every 0.8s on a chunk of up to 96k samples).
function logAudioChunk(float32Chunk, socketIsOpen) {
  if (process.env.NODE_ENV === "production") return;
  let peakAmplitude = 0;
  for (let sampleIndex = 0; sampleIndex < float32Chunk.length; sampleIndex++) {
    const amplitude = Math.abs(float32Chunk[sampleIndex]);
    if (amplitude > peakAmplitude) peakAmplitude = amplitude;
  }
  console.debug(`[audio→ws] ${float32Chunk.length} samples peak=${peakAmplitude.toFixed(4)} socketOpen=${socketIsOpen}`);
}

export default function HifzSession({ surahData, surahNumber }) {
  const [isRecording, setIsRecording] = useState(false);
  const [sessionMode, setSessionMode] = useState("hifz"); // default to the headline Memorize mode; "listen"/"reading" are opt-in
  const [selectedQari, setSelectedQari] = useState("1"); // Default to AbdulBaset Mujawwad
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

  const [listenCursorIndex, setListenCursorIndex] = useState(null);
  const [listenPlaybackData, setListenPlaybackData] = useState([]);
  const [seekToWordGlobalIndex, setSeekToWordGlobalIndex] = useState(null);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);

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
  const computedCursorIndex = useMemo(() => {
    if (sessionWords.length === 0) return 0;

    let nextIndex = sessionWords[0].index;
    for (const word of sessionWords) {
      const wordResult = results[word.index];
      if (wordResult && (wordResult.status === "correct" || wordResult.status === "skipped")) {
        nextIndex = word.index + 1;
      } else {
        break;
      }
    }
    return nextIndex;
  }, [results, sessionWords]);

  // Listen mode highlights words via listenCursorIndex (passed straight to the renderer), so the
  // recitation cursor is simply the next-unconfirmed word in every mode.
  const currentWordIndex = computedCursorIndex;

  // Keep a live ref of the cursor so a reconnect can resume from the right word.
  useEffect(() => {
    currentWordIndexRef.current = currentWordIndex;
  }, [currentWordIndex]);

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
        onWordResult: (wordResult) => {
          setResults((previousResults) => ({ ...previousResults, [wordResult.wordIndex]: wordResult }));
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
        onError: (connectionError) => {
          setError(connectionError.message);
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


  // --- Listen Mode Fetch Logic ---

  // Fetches verse audio + word-level timestamps from Quran.com, then starts playback.
  const startListenMode = useCallback(async (abortSignal) => {
    setIsLoadingAudio(true);
    setError(null);
    try {
      const apiUrl = `https://api.quran.com/api/v4/verses/by_chapter/${surahNumber}?words=true&audio=${selectedQari}&per_page=300`;
      const response = await fetch(apiUrl, { signal: abortSignal });
      if (!response.ok) {
        throw new Error(`Quran.com API returned ${response.status}`);
      }
      const data = await response.json();

      // Build the ordered playback queue: one entry per ayah in the selected range.
      const playbackQueue = [];
      data.verses.forEach((verse) => {
        const isInRange = verse.verse_number >= startAyah && verse.verse_number <= endAyah;
        if (!isInRange || !verse.audio) return;

        const ourAyah = surahData.ayahs.find((ayah) => ayah.ayahNumber === verse.verse_number);
        if (!ourAyah || ourAyah.words.length === 0) return;

        // Each api.quran.com segment is [wordIndex0Based, segmentNumber, startMs, endMs] and every
        // value arrives as a STRING. Coerce to numbers here so the AudioPlayer timeline math adds
        // them instead of string-concatenating ("0" + "1500" -> "01500"). Word index is 0-based.
        const mappedSegments = (verse.audio.segments || []).flatMap((segment) => {
          const wordPositionInVerse = Number(segment[0]);
          const isValidWordPosition =
            Number.isInteger(wordPositionInVerse) &&
            wordPositionInVerse >= 0 &&
            wordPositionInVerse < ourAyah.words.length;
          if (!isValidWordPosition) return [];
          return [{
            globalIndex: ourAyah.words[wordPositionInVerse].index,
            startMs: Number(segment[2]),
            endMs: Number(segment[3]),
          }];
        });

        playbackQueue.push({
          ayahNumber: verse.verse_number,
          globalWordIndices: ourAyah.words.map((word) => word.index),
          url: `https://verses.quran.com/${verse.audio.url}`,
          segments: mappedSegments,
        });
      });

      // A newer request superseded this one (reciter/range changed) — drop this stale result.
      if (abortSignal?.aborted) return;

      setListenPlaybackData(playbackQueue);
      setIsLoadingAudio(false);

      if (playbackQueue.length === 0) {
        setError("No audio data available for this reciter and range. Try a different reciter.");
      }
    } catch (fetchError) {
      // An aborted request is expected when the user switches reciter/range — ignore it silently.
      if (fetchError.name === "AbortError") return;
      console.error("Failed to fetch listen mode audio:", fetchError);
      setIsLoadingAudio(false);
      setError("Failed to load recitation audio. Check your internet connection and try again.");
    }
  }, [surahNumber, selectedQari, startAyah, endAyah, surahData]);

  // Fetch audio data whenever dependencies change
  useEffect(() => {
    if (sessionMode !== "listen") {
      setListenPlaybackData([]);
      setListenCursorIndex(null);
      return;
    }
    // Abort any in-flight fetch when the reciter/range changes or we leave listen mode, so a slow
    // earlier response can never overwrite the latest selection.
    const listenFetchController = new AbortController();
    setListenPlaybackData([]);
    startListenMode(listenFetchController.signal);
    return () => listenFetchController.abort();
  }, [sessionMode, startListenMode]);

  const skipCurrentWord = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "skipWord",
        wordIndex: currentWordIndex
      }));
    }
  };

  const handleFinishLocally = () => {
    // Nothing recited yet — don't open an empty 0% summary.
    if (Object.keys(results).length === 0) return;
    stopSession();

    let correctWords = 0;
    let wrongWords = 0;
    let skippedWords = 0;
    
    sessionWords.forEach((word) => {
      const wordResult = results[word.index];
      if (wordResult) {
        if (wordResult.status === "correct") correctWords++;
        else if (wordResult.status === "wrong") wrongWords++;
        else if (wordResult.status === "skipped") skippedWords++;
      }
    });

    setSummaryData({
      totalWords: sessionWords.length,
      correctWords,
      wrongWords,
      skippedWords
    });
    setIsFinished(true);
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
          tashkeelError: wordResult.tashkeelError ?? null,
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
          onResumeSession={() => setIsFinished(false)}
        />
      </div>
    );
  }

  const modeLabel = sessionMode === "listen" 
    ? "Listen Mode" 
    : sessionMode === "reading" 
      ? "Read Mode" 
      : "Memorize Mode";

  return (
    <div className="w-full flex flex-col items-center relative">
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
              <span className="relative z-10 text-xs font-bold text-gray-700">{surahNumber}</span>
            </span>
            <div className="flex flex-col leading-tight min-w-0">
              <span className="font-bold text-gray-900 text-sm truncate">{surahData.nameSimple}</span>
              <span className="text-[11px] text-gray-400 font-medium">
                {surahData.totalAyahs} Ayahs · {modeLabel}
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

      <div className="w-full max-w-7xl mx-auto px-4 py-8 flex flex-col items-center">
        {/* Listen mode: fetching recitation audio + word timings from api.quran.com */}
        {sessionMode === "listen" && isLoadingAudio && (
          <div className="mb-6 flex items-center gap-2 text-gray-500 text-sm" role="status">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Loading recitation audio…</span>
          </div>
        )}

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
          <div className="flex bg-gray-100 p-1 rounded-lg w-full max-w-lg shadow-inner">
            <button
              onClick={() => setSessionMode("listen")}
              className={`flex-1 px-4 py-2.5 rounded-md text-sm font-bold transition-all ${
                sessionMode === "listen" ? "bg-white text-[#2ca4ab] shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              1. Listen
            </button>
            <button
              onClick={() => setSessionMode("reading")}
              className={`flex-1 px-4 py-2.5 rounded-md text-sm font-bold transition-all ${
                sessionMode === "reading" ? "bg-white text-[#2ca4ab] shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              2. Read
            </button>
            <button
              onClick={() => setSessionMode("hifz")}
              className={`flex-1 px-4 py-2.5 rounded-md text-sm font-bold transition-all ${
                sessionMode === "hifz" ? "bg-white text-[#2ca4ab] shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              3. Memorize
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
        isListenActive={sessionMode === "listen"}
        listenCursorIndex={listenCursorIndex}
        sessionWordIndices={sessionWordIndices}
        startAyah={startAyah}
        endAyah={endAyah}
        includeBismillah={includeBismillah}
        onWordClick={(globalIndex) => {
          if (sessionMode === "listen") {
            setSeekToWordGlobalIndex(globalIndex);
          }
        }}
      />

      </div>

      {/* Listen Mode: Professional audio player bar replaces the standard controls */}
      {sessionMode === "listen" && (
        <AudioPlayer
          playbackData={listenPlaybackData}
          selectedQariId={selectedQari}
          onQariChange={setSelectedQari}
          onWordActive={setListenCursorIndex}
          seekToWordGlobalIndex={seekToWordGlobalIndex}
          onFinish={() => setListenCursorIndex(null)}
        />
      )}

      {/* Read / Memorize mode: Standard mic controls at the bottom */}
      {sessionMode !== "listen" && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-[0_-4px_6px_-1px_rgb(0,0,0,0.05)] px-4 py-4 pb-safe z-50">
          <div className="max-w-7xl mx-auto">
            {/* Progress Bar */}
            <div className="w-full h-1.5 bg-gray-100 rounded-full mb-4 overflow-hidden">
              <div
                className="h-full bg-[#2ca4ab] transition-all duration-300 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
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
                      />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-white animate-pulse" />
                    </span>
                    <Square className="w-4 h-4 fill-white" />
                    Stop
                  </button>

                  <button
                    onClick={skipCurrentWord}
                    className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 px-5 py-3.5 rounded-full font-bold shadow-sm transition-all duration-200 active:scale-95"
                    title="Skip current word"
                  >
                    <SkipForward className="w-4 h-4" />
                    Skip
                  </button>

                  <button
                    onClick={handleFinishLocally}
                    disabled={processedWordsCount === 0}
                    className="flex items-center gap-2 bg-[#2ca4ab] hover:bg-teal-600 text-white px-5 py-3.5 rounded-full font-bold shadow-sm transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
                    title={processedWordsCount === 0 ? "Recite at least one word to finish" : "Finish session and view summary"}
                  >
                    <Check className="w-4 h-4" />
                    Finish
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Spacer so content is not hidden behind the fixed footer */}
      <div className="h-32" />

    </div>
  );
}
