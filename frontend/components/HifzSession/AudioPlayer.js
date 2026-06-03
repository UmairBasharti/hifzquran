"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  ChevronLeft,
  Check,
  Settings2,
  Loader2,
  Volume2,
  VolumeX,
  Volume1
} from "lucide-react";

// Full reciter list
const ALL_RECITERS = [
  { id: 1,  name: "AbdulBaset AbdulSamad",        style: "Mujawwad" },
  { id: 2,  name: "AbdulBaset AbdulSamad",        style: "Murattal" },
  { id: 3,  name: "Abdur-Rahman as-Sudais",       style: "Murattal" },
  { id: 4,  name: "Abu Bakr al-Shatri",           style: "Murattal" },
  { id: 5,  name: "Hani ar-Rifai",                style: "Murattal" },
  { id: 6,  name: "Mahmoud Khalil Al-Husary",     style: "Murattal" },
  { id: 7,  name: "Mishari Rashid al-Afasy",      style: "Murattal" },
  { id: 8,  name: "Mohamed Siddiq al-Minshawi",   style: "Mujawwad" },
  { id: 9,  name: "Mohamed Siddiq al-Minshawi",   style: "Murattal" },
  { id: 10, name: "Sa\u02bfud ash-Shuraym",              style: "Murattal" },
  { id: 11, name: "Mohamed al-Tablawi",           style: "Murattal" },
  { id: 12, name: "Mahmoud Khalil Al-Husary",     style: "Muallim" },
];

function formatTime(totalSeconds) {
  if (!totalSeconds || isNaN(totalSeconds)) return "0:00";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function AudioPlayer({
  playbackData,
  selectedQariId,
  onQariChange,
  onWordActive,
  seekToWordGlobalIndex,
  onFinish
}) {
  const [showReciterPanel, setShowReciterPanel] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  
  // Virtual Timeline state
  // We keep virtualCurrentTime for React renders, but update DOM directly during playback for smoothness
  const [virtualCurrentTime, setVirtualCurrentTime] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  
  const audioRef = useRef(null);
  const currentAyahIndexRef = useRef(0);
  const animFrameRef = useRef(null);
  const lastActiveWordRef = useRef(null);
  const pendingSeekRef = useRef(0);

  // DOM Refs for high-performance scrubber updates
  const progressFillRef = useRef(null);
  const progressThumbRef = useRef(null);
  const timeTextRef = useRef(null);
  const internalVTimeRef = useRef(0);

  const selectedReciter = ALL_RECITERS.find((reciter) => reciter.id === Number(selectedQariId));

  // 1. Build the Virtual Timeline on mount or data change
  const { virtualAyahs, totalDurationSeconds } = useMemo(() => {
    if (!playbackData || playbackData.length === 0) {
      return { virtualAyahs: [], totalDurationSeconds: 0 };
    }
    
    let currentOffsetMs = 0;
    const ayahs = playbackData.map(ayah => {
      // Find the last segment's end time. If missing, assume 5 seconds (fallback).
      const lastSegment = ayah.segments[ayah.segments.length - 1];
      const durationMs = lastSegment ? lastSegment.endMs : 5000;
      
      const virtualAyah = {
        ...ayah,
        virtualStartMs: currentOffsetMs,
        virtualEndMs: currentOffsetMs + durationMs,
        durationMs,
        segments: ayah.segments.map((segment) => ({
          ...segment,
          virtualStartMs: currentOffsetMs + segment.startMs,
          virtualEndMs: currentOffsetMs + segment.endMs
        }))
      };
      currentOffsetMs += durationMs;
      return virtualAyah;
    });

    return { 
      virtualAyahs: ayahs, 
      totalDurationSeconds: currentOffsetMs / 1000 
    };
  }, [playbackData]);

  // 2. Playback core logic
  const loadAyahAndPlay = (index, seekLocalTime = 0) => {
    if (!virtualAyahs[index] || !audioRef.current) return;
    
    currentAyahIndexRef.current = index;
    const ayah = virtualAyahs[index];
    
    setIsLoading(true);
    pendingSeekRef.current = seekLocalTime;
    
    audioRef.current.src = ayah.url;
    audioRef.current.load();
    
    if (isPlaying) {
      // play() can reject (autoplay policy, or load interrupted by a src change). Use async/await
      // rather than a promise .catch (AGENTS.md rule 11); fire-and-forget is fine here.
      const resumePlayback = async () => {
        try {
          await audioRef.current.play();
        } catch (playbackError) {
          if (playbackError.name !== "AbortError") {
            console.error("Audio play failed:", playbackError);
            setIsPlaying(false);
            setIsLoading(false);
          }
        }
      };
      resumePlayback();
    }
  };

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  // Auto-start or resume when data is populated (e.g. initial load or reciter change)
  useEffect(() => {
    if (virtualAyahs.length > 0) {
      if (virtualCurrentTime > 0) {
        const targetMs = virtualCurrentTime * 1000;
        let targetIndex = 0;
        for (let i = 0; i < virtualAyahs.length; i++) {
          if (targetMs >= virtualAyahs[i].virtualStartMs && targetMs <= virtualAyahs[i].virtualEndMs) {
            targetIndex = i;
            break;
          }
        }
        const ayah = virtualAyahs[targetIndex];
        if (ayah) {
          const localTime = (targetMs - ayah.virtualStartMs) / 1000;
          loadAyahAndPlay(targetIndex, localTime);
        }
      } else {
        currentAyahIndexRef.current = 0;
        setVirtualCurrentTime(0);
        internalVTimeRef.current = 0;
        loadAyahAndPlay(0);
      }
    }
  }, [virtualAyahs]);

  const updateScrubberDOM = (vTime, totalTime) => {
    if (!totalTime) return;
    const percent = Math.min(100, Math.max(0, (vTime / totalTime) * 100));
    if (progressFillRef.current) {
      progressFillRef.current.style.width = `${percent}%`;
    }
    if (progressThumbRef.current) {
      progressThumbRef.current.style.left = `calc(${percent}% - 7px)`;
    }
    if (timeTextRef.current) {
      const formatted = formatTime(vTime);
      if (timeTextRef.current.textContent !== formatted) {
        timeTextRef.current.textContent = formatted;
      }
    }
  };

  // Sync virtual time & word highlighting (requestAnimationFrame for high precision)
  useEffect(() => {
    if (!isPlaying) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      return;
    }

    const updateLoop = () => {
      if (!audioRef.current || isDragging) {
        animFrameRef.current = requestAnimationFrame(updateLoop);
        return;
      }

      const ayah = virtualAyahs[currentAyahIndexRef.current];
      if (!ayah) return;

      const localTimeMs = audioRef.current.currentTime * 1000;
      const vTime = (ayah.virtualStartMs + localTimeMs) / 1000;
      
      internalVTimeRef.current = vTime;
      updateScrubberDOM(vTime, totalDurationSeconds);

      // Check for word highlight
      let activeWordGlobalIndex = null;
      for (const segment of ayah.segments) {
        if (localTimeMs >= segment.startMs && localTimeMs <= segment.endMs) {
          activeWordGlobalIndex = segment.globalIndex;
          break;
        }
      }

      if (activeWordGlobalIndex !== null && activeWordGlobalIndex !== lastActiveWordRef.current) {
        lastActiveWordRef.current = activeWordGlobalIndex;
        onWordActive(activeWordGlobalIndex);
      }

      // Gapless transition: if we exceed this ayah's known segment duration, jump to next instantly
      if (localTimeMs > ayah.durationMs && currentAyahIndexRef.current + 1 < virtualAyahs.length) {
        loadAyahAndPlay(currentAyahIndexRef.current + 1);
      }

      animFrameRef.current = requestAnimationFrame(updateLoop);
    };

    animFrameRef.current = requestAnimationFrame(updateLoop);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isPlaying, virtualAyahs, isDragging, onWordActive, totalDurationSeconds]);

  // External word seeking (when user clicks a word in WordRenderer)
  useEffect(() => {
    if (seekToWordGlobalIndex === null || virtualAyahs.length === 0) return;
    
    const ayahIndex = virtualAyahs.findIndex((candidateAyah) => candidateAyah.globalWordIndices?.includes(seekToWordGlobalIndex));
    if (ayahIndex !== -1) {
      const ayah = virtualAyahs[ayahIndex];
      const matchingSegment = ayah.segments.find((segment) => segment.globalIndex === seekToWordGlobalIndex);

      let localSeekTimeMs = 0;
      if (matchingSegment) {
        localSeekTimeMs = matchingSegment.startMs;
      } else {
        // Fallback: if this reciter has no specific segment for this word, use the closest
        // preceding segment, or just the ayah start time (0).
        const precedingSegments = ayah.segments.filter((segment) => segment.globalIndex < seekToWordGlobalIndex);
        if (precedingSegments.length > 0) {
          const lastPrecedingSegment = precedingSegments[precedingSegments.length - 1];
          localSeekTimeMs = lastPrecedingSegment.endMs || lastPrecedingSegment.startMs;
        }
      }
      
      const vTime = (ayah.virtualStartMs + localSeekTimeMs) / 1000;
      setVirtualCurrentTime(vTime);
      internalVTimeRef.current = vTime;
      updateScrubberDOM(vTime, totalDurationSeconds);
      setIsPlaying(true);
      loadAyahAndPlay(ayahIndex, localSeekTimeMs / 1000);
    }
  }, [seekToWordGlobalIndex, virtualAyahs, totalDurationSeconds]);

  // Play/Pause button. play() returns a promise that can reject (browser autoplay policy, or a
  // load interrupted by a src change), so we await it and only mark the UI "playing" once playback
  // actually starts — otherwise the button could show Pause while nothing is playing.
  const handlePlayPause = async () => {
    const audioElement = audioRef.current;
    if (!audioElement) return;

    if (isPlaying) {
      audioElement.pause();
      setIsPlaying(false);
      setVirtualCurrentTime(internalVTimeRef.current);
      return;
    }

    // Resuming with no source yet (rare — autostart usually preloads): load the current ayah at the
    // saved position first. loadAyahAndPlay won't auto-play here because isPlaying is still false.
    if (!audioElement.src) {
      const resumeVirtualTimeMs = (internalVTimeRef.current || virtualCurrentTime) * 1000;
      const ayahStartMs = virtualAyahs[currentAyahIndexRef.current]?.virtualStartMs || 0;
      const localSeekSeconds = Math.max(0, (resumeVirtualTimeMs - ayahStartMs) / 1000);
      loadAyahAndPlay(currentAyahIndexRef.current, localSeekSeconds);
    }

    try {
      await audioElement.play();
      setIsPlaying(true);
    } catch (playbackError) {
      // Autoplay blocked or load interrupted — stay paused so the button matches reality.
      console.error("Could not start playback:", playbackError);
      setIsPlaying(false);
    }
  };

  // Scrubber seeking
  const handleScrubberChange = (event) => {
    const newVTime = Number(event.target.value);
    setVirtualCurrentTime(newVTime);
    internalVTimeRef.current = newVTime;
    updateScrubberDOM(newVTime, totalDurationSeconds);
    
    const targetMs = newVTime * 1000;
    let targetIndex = 0;
    for (let i = 0; i < virtualAyahs.length; i++) {
      if (targetMs >= virtualAyahs[i].virtualStartMs && targetMs <= virtualAyahs[i].virtualEndMs) {
        targetIndex = i;
        break;
      }
    }
    
    const ayah = virtualAyahs[targetIndex];
    if (ayah) {
      const localTime = (targetMs - ayah.virtualStartMs) / 1000;
      loadAyahAndPlay(targetIndex, localTime);
    }
  };

  const handleRewind = () => {
    const vTime = internalVTimeRef.current || virtualCurrentTime;
    const newTime = Math.max(0, vTime - 10);
    handleScrubberChange({ target: { value: newTime } });
  };

  const handleSkipForward = () => {
    const vTime = internalVTimeRef.current || virtualCurrentTime;
    const newTime = Math.min(totalDurationSeconds, vTime + 10);
    handleScrubberChange({ target: { value: newTime } });
  };

  const isLoaded = virtualAyahs.length > 0;
  
  // Initial fallback percent for React render
  const progressPercent = totalDurationSeconds > 0 ? (virtualCurrentTime / totalDurationSeconds) * 100 : 0;

  return (
    <>
      <audio
        ref={audioRef}
        onCanPlay={() => setIsLoading(false)}
        onPlaying={() => setIsLoading(false)}
        onLoadedMetadata={() => {
          if (pendingSeekRef.current > 0) {
            audioRef.current.currentTime = pendingSeekRef.current;
            pendingSeekRef.current = 0;
          }
        }}
        onEnded={() => {
          if (currentAyahIndexRef.current + 1 < virtualAyahs.length) {
            loadAyahAndPlay(currentAyahIndexRef.current + 1);
          } else {
            setIsPlaying(false);
            setVirtualCurrentTime(0);
            internalVTimeRef.current = 0;
            updateScrubberDOM(0, totalDurationSeconds);
            currentAyahIndexRef.current = 0;
            if (onFinish) onFinish();
          }
        }}
      />
      {/* Reciter Panel */}
      {showReciterPanel && (
        <div className="fixed inset-0 z-[60] flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm cursor-pointer" onClick={() => setShowReciterPanel(false)} />
          <div className="relative z-10 bg-white rounded-t-3xl max-h-[75vh] flex flex-col shadow-2xl pb-4">
            <div className="flex items-center gap-3 px-6 py-5 border-b border-gray-100">
              <button onClick={() => setShowReciterPanel(false)} aria-label="Close reciter list" className="text-gray-500 hover:text-gray-900 transition-colors p-2 cursor-pointer">
                <ChevronLeft className="w-6 h-6" />
              </button>
              <span className="text-gray-900 font-bold text-lg">Select Reciter</span>
            </div>
            <div className="overflow-y-auto flex-1 py-2 px-2">
              {ALL_RECITERS.map((reciter) => {
                const isSelected = reciter.id === Number(selectedQariId);
                return (
                  <button
                    key={reciter.id}
                    onClick={() => {
                      onQariChange(String(reciter.id));
                      setShowReciterPanel(false);
                    }}
                    className={`w-full flex items-center justify-between px-6 py-4 text-left transition-colors rounded-xl cursor-pointer ${
                      isSelected ? "bg-[#2ca4ab]/10 text-[#2ca4ab]" : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <div>
                      <span className={`font-semibold text-base ${isSelected ? "text-[#2ca4ab]" : ""}`}>
                        {reciter.name}
                      </span>
                      {reciter.style && (
                        <span className="text-gray-500 text-sm ml-2">— {reciter.style}</span>
                      )}
                    </div>
                    {isSelected && <Check className="w-5 h-5 text-[#2ca4ab]" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Light-Themed Bottom Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 shadow-[0_-4px_25px_-5px_rgb(0,0,0,0.05)] select-none">
        {/* Scrubber */}
        <div className="relative w-full h-2 bg-gray-100 group cursor-pointer">
          <div
            ref={progressFillRef}
            className="absolute top-0 left-0 h-full bg-[#2ca4ab] pointer-events-none"
            style={{ width: `${progressPercent}%` }}
          />
          <input
            type="range"
            aria-label="Seek through recitation"
            min="0"
            max={totalDurationSeconds || 100}
            step="0.1"
            value={isDragging ? virtualCurrentTime : internalVTimeRef.current}
            onChange={handleScrubberChange}
            onMouseDown={() => setIsDragging(true)}
            onMouseUp={() => {
              setIsDragging(false);
              setVirtualCurrentTime(internalVTimeRef.current);
            }}
            onTouchStart={() => setIsDragging(true)}
            onTouchEnd={() => {
              setIsDragging(false);
              setVirtualCurrentTime(internalVTimeRef.current);
            }}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
          />
          <div
            ref={progressThumbRef}
            className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-[#2ca4ab] shadow-md pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-0"
            style={{ left: `calc(${progressPercent}% - 7px)` }}
          />
        </div>

        {/* Controls Container */}
        <div className="flex items-center justify-between px-6 py-4 max-w-7xl mx-auto">
          {/* Left: Reciter Info */}
          <button
            onClick={() => setShowReciterPanel(true)}
            aria-label="Select reciter"
            className="flex items-center gap-3 text-left min-w-0 group flex-1 cursor-pointer"
          >
            <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center group-hover:bg-[#2ca4ab]/10 transition-colors">
              <Settings2 className="w-5 h-5 text-gray-400 group-hover:text-[#2ca4ab] shrink-0 transition-colors" />
            </div>
            <div className="min-w-0">
              <p className="text-gray-900 text-sm md:text-base font-semibold truncate leading-tight">
                {selectedReciter?.name ?? "Select Reciter"}
              </p>
              {selectedReciter?.style && (
                <p className="text-gray-500 text-xs md:text-sm leading-tight mt-0.5">{selectedReciter.style}</p>
              )}
            </div>
          </button>

          {/* Center: Core Player Controls */}
          <div className="flex items-center justify-center gap-4 md:gap-6 shrink-0 flex-1">
            <span ref={timeTextRef} className="text-gray-500 text-xs md:text-sm w-12 text-right tabular-nums hidden sm:block font-medium">
              {formatTime(virtualCurrentTime)}
            </span>

            <button
              onClick={handleRewind}
              disabled={!isLoaded}
              aria-label="Rewind 10 seconds"
              className="p-2 md:p-3 text-gray-400 hover:text-gray-900 transition-colors disabled:opacity-30 hover:bg-gray-50 rounded-full cursor-pointer"
            >
              <SkipBack className="w-5 h-5 md:w-6 md:h-6" />
            </button>

            <button
              onClick={handlePlayPause}
              disabled={!isLoaded}
              aria-label={isPlaying ? "Pause" : "Play"}
              className="w-14 h-14 md:w-16 md:h-16 rounded-full bg-[#2ca4ab] hover:bg-teal-500 flex items-center justify-center shadow-lg hover:shadow-xl transition-all active:scale-95 disabled:opacity-50 cursor-pointer group"
            >
              {isLoading && isPlaying
                ? <Loader2 className="w-6 h-6 md:w-7 md:h-7 text-white animate-spin" />
                : isPlaying
                ? <Pause className="w-6 h-6 md:w-7 md:h-7 text-white" />
                : <Play className="w-6 h-6 md:w-7 md:h-7 text-white ml-1.5" />}
            </button>

            <button
              onClick={handleSkipForward}
              disabled={!isLoaded}
              aria-label="Forward 10 seconds"
              className="p-2 md:p-3 text-gray-400 hover:text-gray-900 transition-colors disabled:opacity-30 hover:bg-gray-50 rounded-full cursor-pointer"
            >
              <SkipForward className="w-5 h-5 md:w-6 md:h-6" />
            </button>

            <span className="text-gray-500 text-xs md:text-sm w-12 tabular-nums hidden sm:block font-medium">
              {formatTime(totalDurationSeconds)}
            </span>
          </div>

          {/* Right: Volume & Restart */}
          <div className="flex-1 flex justify-end items-center gap-2 md:gap-6">
            
            {/* Volume Control (Hidden on very small screens) */}
            <div className="hidden md:flex items-center gap-2 group cursor-pointer">
              <button
                onClick={() => setIsMuted(!isMuted)}
                aria-label={isMuted ? "Unmute" : "Mute"}
                className="p-2 text-gray-400 hover:text-[#2ca4ab] transition-colors rounded-full cursor-pointer"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-5 h-5" />
                ) : volume < 0.5 ? (
                  <Volume1 className="w-5 h-5" />
                ) : (
                  <Volume2 className="w-5 h-5" />
                )}
              </button>
              <input
                type="range"
                aria-label="Volume"
                min="0"
                max="1"
                step="0.01"
                value={isMuted ? 0 : volume}
                onChange={(event) => {
                  setVolume(Number(event.target.value));
                  if (isMuted && Number(event.target.value) > 0) setIsMuted(false);
                }}
                className="w-20 h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-[#2ca4ab]"
              />
            </div>

            <button
              onClick={() => handleScrubberChange({ target: { value: 0 } })}
              disabled={!isLoaded}
              aria-label="Restart from the beginning"
              className="flex items-center gap-2 text-gray-500 hover:text-gray-900 text-xs md:text-sm font-semibold transition-colors disabled:opacity-30 p-2 md:px-4 md:py-2 hover:bg-gray-50 rounded-full cursor-pointer"
            >
              <RotateCcw className="w-5 h-5" />
              <span className="hidden sm:inline">Restart</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
