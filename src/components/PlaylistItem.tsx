"use client";

import { FaPlay, FaTrash, FaVolumeUp, FaVideo, FaCheck } from "react-icons/fa";

interface MediaFile {
  path: string;
  name: string;
  type: string;
  ext: string;
  size: number;
  duration: number;
  thumbnail: string | null;
  dir?: string;
}

function fmtDuration(s: number): string {
  if (!s || s <= 0) return "--:--";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(0) + " KB";
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB";
  return (bytes / 1073741824).toFixed(2) + " GB";
}

export default function PlaylistItem({
  file,
  isActive,
  onClick,
  onDelete,
  onMarkGood,
  showGoodButton = true,
}: {
  file: MediaFile;
  isActive: boolean;
  onClick: () => void;
  onDelete: () => void;
  onMarkGood?: () => void;
  showGoodButton?: boolean;
}) {
  const isVideo = file.type === "video";

  return (
    <div
      onClick={onClick}
      className={`flex items-start gap-3 p-2.5 rounded-xl cursor-pointer transition-all duration-150 group ${
        isActive
          ? "bg-accent/15 border border-accent/40"
          : "bg-surface-raised border border-transparent hover:border-border hover:bg-surface-overlay"
      }`}
    >
      {/* Thumbnail — larger */}
      <div className="relative w-36 h-24 rounded-lg overflow-hidden bg-surface-overlay shrink-0">
        {file.thumbnail ? (
          <img src={file.thumbnail} alt={file.name} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {isVideo ? <FaVideo className="text-2xl text-text-muted" /> : <FaVolumeUp className="text-2xl text-purple-400" />}
          </div>
        )}
        {file.duration > 0 && (
          <span className="absolute bottom-1 left-1 bg-black/80 text-white text-[10px] px-1.5 py-0.5 rounded font-mono">
            {fmtDuration(file.duration)}
          </span>
        )}
        {isActive && (
          <div className="absolute inset-0 bg-accent/20 flex items-center justify-center">
            <FaPlay className="text-white text-lg" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 py-0.5">
        <h4 className={`text-sm font-medium leading-snug line-clamp-2 ${isActive ? "text-accent" : "text-text-primary"}`} title={file.name}>
          {file.name}
        </h4>
        <p className="text-[11px] text-text-muted mt-1.5">
          {file.ext.replace(".", "").toUpperCase()} · {fmtSize(file.size)}
          {file.dir ? ` · ${file.dir}` : ""}
        </p>

        {/* Action buttons */}
        <div className="flex gap-1 mt-2 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
          {showGoodButton && onMarkGood && (
            <button
              onClick={(e) => { e.stopPropagation(); onMarkGood(); }}
              className="text-green-400 hover:text-green-300 hover:bg-green-500/10 p-1.5 rounded-lg transition text-xs"
              title="إضافة للمفضلة"
            >
              <FaCheck />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="text-text-muted hover:text-danger hover:bg-danger/10 p-1.5 rounded-lg transition text-xs"
            title="حذف"
          >
            <FaTrash />
          </button>
        </div>
      </div>
    </div>
  );
}
