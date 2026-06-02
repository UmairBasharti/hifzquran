"use client";

import { useMemo } from "react";
import { surahMeanings } from "../../lib/surah_meanings";

// Renders the Surah in the authentic Madani-Mushaf layout using Quran.com's QCF v1
// page fonts: every word is a single glyph drawn with its own page's font, grouped
// into the exact Mushaf lines. In "hifz" mode each word slot is kept but hidden, and
// revealed (coloured) only as the reciter gets it right.
export default function WordRenderer({
  surahData,
  surahNumber,
  currentWordIndex,
  results,
  sessionMode = "hifz",
  isRecording = false,
  sessionWordIndices,
}) {

  // Every Mushaf page used by this Surah — so we can declare its @font-face once.
  const pagesUsed = useMemo(() => collectPages(surahData), [surahData]);

  // One @font-face per page, served same-origin so it can never be blocked.
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

  // Group the ayah words + end markers into the exact Mushaf lines (page + line).
  const mushafLines = useMemo(() => groupIntoMushafLines(surahData), [surahData]);

  if (!surahData) return null;

  return (
    <div className="w-full max-w-3xl mx-auto px-3">
      <style>{fontFaceCss}</style>

      {/* Ornamental Surah name header */}
      <div className="flex flex-col items-center pt-2 pb-8">
        <div className="flex items-center justify-center gap-4 w-full max-w-sm mb-3">
          <span className="h-px flex-1 bg-gradient-to-l from-gray-300 to-transparent" />
          <h1
            className="font-uthmanic text-4xl md:text-5xl text-gray-900 leading-none pb-1"
            dir="rtl"
            lang="ar"
          >
            {surahData.nameArabic}
          </h1>
          <span className="h-px flex-1 bg-gradient-to-r from-gray-300 to-transparent" />
        </div>
        <p className="text-xs md:text-sm font-semibold tracking-[0.2em] text-[#2ca4ab] uppercase">
          {surahMeanings[surahNumber] || surahData.nameSimple}
        </p>
      </div>

      {/* Bismillah (rendered with its page-1 glyphs) */}
      {surahData.bismillah && (
        <div className="flex flex-wrap justify-center items-center gap-x-1 mb-10" dir="rtl" lang="ar">
          {surahData.bismillah.words.map((word) => (
            <WordGlyph
              key={word.index}
              word={word}
              results={results}
              currentWordIndex={currentWordIndex}
              sessionMode={sessionMode}
              isRecording={isRecording}
              sessionWordIndices={sessionWordIndices}
              bismillah
            />
          ))}
        </div>
      )}

      {/* Ayahs — one row per Mushaf line, justified edge-to-edge like the printed
          Mushaf. The final (short) line of the Surah is centred, not stretched. */}
      <div dir="rtl" lang="ar" className="flex flex-col gap-y-2.5">
        {mushafLines.map((line, lineIndex) => {
          const isLastLine = lineIndex === mushafLines.length - 1;
          return (
            <div
              key={lineIndex}
              className={`flex items-center leading-[1.7] ${
                isLastLine ? "justify-center gap-x-2" : "justify-between"
              }`}
            >
              {line.map((token) =>
                token.type === "end" ? (
                  <EndGlyph key={`end-${token.ayahNumber}`} token={token} />
                ) : (
                  <WordGlyph
                    key={token.word.index}
                    word={token.word}
                    results={results}
                    currentWordIndex={currentWordIndex}
                    sessionMode={sessionMode}
                    isRecording={isRecording}
                    sessionWordIndices={sessionWordIndices}
                  />
                )
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Gather the set of Mushaf pages used across bismillah, words, and end markers.
function collectPages(surahData) {
  if (!surahData) return [];
  const pageSet = new Set();
  const add = (page) => {
    if (page) pageSet.add(page);
  };
  if (surahData.bismillah) {
    surahData.bismillah.words.forEach((word) => add(word.page));
  }
  surahData.ayahs.forEach((ayah) => {
    ayah.words.forEach((word) => add(word.page));
    if (ayah.end) add(ayah.end.page);
  });
  return Array.from(pageSet).sort((first, second) => first - second);
}

// Walk all ayah words (and their end markers) and split them into Mushaf lines,
// starting a new line whenever the page or line number changes.
function groupIntoMushafLines(surahData) {
  if (!surahData) return [];
  const lines = [];
  let currentLine = null;

  const appendToken = (token) => {
    const lineKey = `${token.page}-${token.line}`;
    if (!currentLine || currentLine.key !== lineKey) {
      currentLine = { key: lineKey, tokens: [] };
      lines.push(currentLine);
    }
    currentLine.tokens.push(token);
  };

  surahData.ayahs.forEach((ayah) => {
    ayah.words.forEach((word) => {
      appendToken({ type: "word", word, page: word.page, line: word.line });
    });
    if (ayah.end) {
      appendToken({
        type: "end",
        ayahNumber: ayah.ayahNumber,
        codeV1: ayah.end.codeV1,
        page: ayah.end.page,
        line: ayah.end.line,
      });
    }
  });

  return lines.map((line) => line.tokens);
}

// A single recitable word, drawn as its QCF page glyph (or text fallback).
function WordGlyph({ word, results, currentWordIndex, sessionMode, isRecording, bismillah, sessionWordIndices }) {
  const result = results[word.index];
  // Words outside the selected range are never hidden — only session words react to hifz mode.
  const inSession = !sessionWordIndices || sessionWordIndices.has(word.index);
  const isActive = isRecording && inSession && word.index === currentWordIndex && !result;
  const isHidden = isRecording && sessionMode === "hifz" && inSession && !result && word.index >= currentWordIndex;

  let colorClass = "text-gray-900";
  if (result) {
    if (result.status === "correct") colorClass = "text-emerald-600";
    else if (result.status === "wrong") colorClass = "text-red-500";
    else if (result.status === "skipped") colorClass = "text-amber-500";
  } else if (isRecording && sessionMode === "reading" && inSession && word.index >= currentWordIndex) {
    colorClass = "text-gray-300";
  }

  const hasGlyph = Boolean(word.codeV1 && word.page);
  const sizeClass = bismillah ? "text-xl md:text-2xl" : "text-2xl md:text-[2rem]";

  return (
    <span className="relative inline-block">
      <span
        className={`${sizeClass} leading-none ${colorClass} ${isHidden ? "invisible" : "visible"} ${
          hasGlyph ? "" : "font-uthmanic"
        }`}
        style={hasGlyph ? { fontFamily: `qcf-p${word.page}` } : undefined}
      >
        {hasGlyph ? word.codeV1 : word.text}
      </span>
      {isActive && (
        <span className="absolute left-0 right-0 -bottom-1 h-[3px] rounded-full bg-[#2ca4ab] animate-pulse" />
      )}
    </span>
  );
}

// The decorative end-of-ayah glyph (the ornate number circle) — always visible.
function EndGlyph({ token }) {
  const hasGlyph = Boolean(token.codeV1 && token.page);
  if (!hasGlyph) return null;
  return (
    <span
      className="text-2xl md:text-[2rem] leading-none text-[#2ca4ab] mx-0.5"
      style={{ fontFamily: `qcf-p${token.page}` }}
    >
      {token.codeV1}
    </span>
  );
}
