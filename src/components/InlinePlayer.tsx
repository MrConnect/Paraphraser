"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import {
  FaPlay,
  FaPause,
  FaVolumeUp,
  FaVolumeMute,
  FaExpand,
  FaStepForward,
  FaStepBackward,
} from "react-icons/fa";

interface MediaFile {
  path: string;
  name: string;
  type: string;
  ext: string;
}

export default function InlinePlayer({
  file,
  onEnded,
}: {
  file: MediaFile | null;
  onEnded?: () => void;
}) {
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  const src = file ? `/api/stream?path=${encodeURIComponent(file.path)}` : "";
  const isVideo = file?.type === "video";

  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
  }, [file]);

  const togglePlay = useCallback(() => {
    const el = mediaRef.current;
    if (!el) return;
    if (el.paused) { el.play(); setPlaying(true); }
    else { el.pause(); setPlaying(false); }
  }, []);

  const seek = useCallback((val: number) => {
    const el = mediaRef.current;
    if (!el) return;
    el.currentTime = val;
    setCurrent(val);
  }, []);

  const skip = useCallback((secs: number) => {
    const el = mediaRef.current;
    if (!el) return;
    seek(Math.min(Math.max(el.currentTime + secs, 0), duration));
  }, [duration, seek]);

  const toggleMute = useCallback(() => {
    const el = mediaRef.current;
    if (!el) return;
    el.muted = !el.muted;
    setMuted(el.muted);
  }, []);

  const changeVolume = useCallback((v: number) => {
    const el = mediaRef.current;
    if (!el) return;
    el.volume = v;
    setVolume(v);
    if (v === 0) { el.muted = true; setMuted(true); }
    else if (el.muted) { el.muted = false; setMuted(false); }
  }, []);

  const goFullscreen = useCallback(() => {
    const el = mediaRef.current;
    if (el && "requestFullscreen" in el) (el as HTMLVideoElement).requestFullscreen();
  }, []);

  const fmt = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === " ") { e.preventDefault(); togglePlay(); }
      if (e.key === "ArrowRight") skip(5);
      if (e.key === "ArrowLeft") skip(-5);
      if (e.key === "f" || e.key === "F") goFullscreen();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [togglePlay, skip, goFullscreen]);

  if (!file) {
    return (
      <div className="bg-surface-raised rounded-2xl border border-border aspect-video flex items-center justify-center">
        <p className="text-text-muted text-sm">اختر ملف من القائمة للتشغيل</p>
      </div>
    );
  }

  const commonProps = {
    ref: mediaRef as any,
    src,
    autoPlay: true,
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onTimeUpdate: () => { if (mediaRef.current) setCurrent(mediaRef.current.currentTime); },
    onLoadedMetadata: () => { if (mediaRef.current) { setDuration(mediaRef.current.duration); setPlaying(true); } },
    onEnded: () => { setPlaying(false); onEnded?.(); },
  };

  return (
    <div className="bg-surface-raised rounded-2xl border border-border overflow-hidden" dir="ltr">
      {/* Media */}
      <div className={`bg-black flex items-center justify-center relative ${isVideo ? "aspect-video" : "h-44"}`}>
        {isVideo ? (
          <video {...commonProps} className="w-full h-full object-contain" />
        ) : (
          <>
            <audio {...commonProps} />
            <div className="flex items-center justify-center">
              <div className="w-20 h-20 bg-purple-500/10 rounded-full flex items-center justify-center">
                <FaVolumeUp className="text-3xl text-purple-400" />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Controls */}
      <div className="px-4 py-3 space-y-2">
        {/* Seek bar */}
        <div className="flex items-center gap-3 text-xs text-text-secondary">
          <span className="w-12 text-left font-mono">{fmt(currentTime)}</span>
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={0.1}
            value={currentTime}
            onChange={(e) => seek(parseFloat(e.target.value))}
            className="flex-1"
            style={{
              background: `linear-gradient(to right, var(--color-accent) ${(currentTime / (duration || 1)) * 100}%, var(--color-surface-overlay) ${(currentTime / (duration || 1)) * 100}%)`,
            }}
          />
          <span className="w-12 text-right font-mono">{fmt(duration)}</span>
        </div>

        {/* Buttons */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button onClick={() => skip(-10)} className="text-text-secondary hover:text-text-primary p-2 rounded-lg transition text-sm" title="-10 ثانية">
              <FaStepBackward />
            </button>
            <button
              onClick={togglePlay}
              className="bg-accent hover:bg-accent-hover text-white w-10 h-10 rounded-full flex items-center justify-center transition text-sm"
            >
              {playing ? <FaPause /> : <FaPlay />}
            </button>
            <button onClick={() => skip(10)} className="text-text-secondary hover:text-text-primary p-2 rounded-lg transition text-sm" title="+10 ثانية">
              <FaStepForward />
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button onClick={toggleMute} className="text-text-secondary hover:text-text-primary p-2 rounded-lg transition text-sm">
              {muted || volume === 0 ? <FaVolumeMute /> : <FaVolumeUp />}
            </button>
            <input
              type="range"
              min={0} max={1} step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => changeVolume(parseFloat(e.target.value))}
              className="w-20"
              style={{
                background: `linear-gradient(to right, var(--color-accent) ${(muted ? 0 : volume) * 100}%, var(--color-surface-overlay) ${(muted ? 0 : volume) * 100}%)`,
              }}
            />
            {isVideo && (
              <button onClick={goFullscreen} className="text-text-secondary hover:text-text-primary p-2 rounded-lg transition text-sm" title="ملء الشاشة">
                <FaExpand />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Title */}
      <div className="px-4 pb-3 border-t border-border pt-2" dir="rtl">
        <h2 className="text-sm font-semibold text-text-primary truncate">{file.name}</h2>
      </div>
    </div>
  );
}
