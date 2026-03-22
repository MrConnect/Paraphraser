"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { FaSearch, FaBroom, FaCloudDownloadAlt, FaStar, FaBan } from "react-icons/fa";
import dynamic from "next/dynamic";
import PlaylistItem from "@/components/PlaylistItem";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchWithTimeout } from "@/lib/fetch";

const InlinePlayer = dynamic(() => import("@/components/InlinePlayer"), { ssr: false });

interface MediaFile {
  path: string;
  name: string;
  type: "video" | "audio";
  ext: string;
  size: number;
  duration: number;
  thumbnail: string | null;
  dir: string;
}

const PAGE_SIZE = 30;

export default function PlayerPage() {
  const router = useRouter();
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchFiles = useCallback(async () => {
    // Abort previous request
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetchWithTimeout("/api/files", {}, ctrl.signal);
      const data = await res.json();
      const mediaFiles = data.files || [];
      setFiles(mediaFiles);

      if (mediaFiles.length === 0) {
        try {
          const goodRes = await fetchWithTimeout("/api/good", {}, ctrl.signal);
          const goodData = await goodRes.json();
          if (goodData.files && goodData.files.length > 0) { router.replace("/good"); return; }
        } catch {}
      }
    } catch (err: any) {
      if (err.name !== "AbortError") console.error("Failed to load");
    }
    finally { setLoading(false); }
  }, [router]);

  // Cleanup on unmount
  useEffect(() => {
    fetchFiles();
    return () => { abortRef.current?.abort(); };
  }, [fetchFiles]);

  const filtered = useMemo(() => files.filter(f => f.name.toLowerCase().includes(search.toLowerCase())), [files, search]);
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [search]);

  useEffect(() => {
    if (!sentinelRef.current) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && visibleCount < filtered.length) setVisibleCount(p => Math.min(p + 20, filtered.length));
    }, { threshold: 0.1 });
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, [visibleCount, filtered.length]);

  const visibleItems = filtered.slice(0, visibleCount);
  const activeFile = activeIndex >= 0 && activeIndex < files.length ? files[activeIndex] : null;
  const playIndex = (i: number) => { setActiveIndex(files.indexOf(filtered[i])); };

  const handleEnded = useCallback(() => {
    if (activeIndex < files.length - 1) setActiveIndex(p => p + 1);
  }, [activeIndex, files.length]);

  const handleDelete = async (file: MediaFile) => {
    if (!confirm(`حذف "${file.name}"؟`)) return;
    try {
      await fetchWithTimeout("/api/files", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: file.path }) });
      const idx = files.indexOf(file);
      if (idx <= activeIndex) setActiveIndex(p => Math.max(p - 1, -1));
      await fetchFiles();
    } catch { alert("فشل الحذف"); }
  };

  const handleMark = async (file: MediaFile, target: "good" | "bad") => {
    try {
      const res = await fetchWithTimeout("/api/files", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filePath: file.path, target }) });
      if (res.ok) {
        const idx = files.indexOf(file);
        if (idx <= activeIndex) setActiveIndex(p => Math.max(p - 1, -1));
        await fetchFiles();
      }
    } catch { alert("فشل النقل"); }
  };

  const handleDeleteAll = async () => {
    if (!confirm("حذف كل الملفات نهائياً؟")) return;
    try {
      await fetchWithTimeout("/api/files", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deleteAll: true }) });
      setActiveIndex(-1);
      await fetchFiles();
    } catch { alert("فشل"); }
  };

  const videoCount = files.filter(f => f.type === "video").length;
  const audioCount = files.filter(f => f.type === "audio").length;

  if (loading) return <main className="min-h-screen flex items-center justify-center"><div className="text-text-muted animate-pulse text-lg">جاري التحميل...</div></main>;

  if (files.length === 0) return (
    <main className="min-h-screen flex items-center justify-center p-4" dir="rtl">
      <div className="text-center space-y-4">
        <FaCloudDownloadAlt className="text-5xl text-text-muted mx-auto" />
        <p className="text-text-secondary">لا توجد ملفات.</p>
        <Link href="/" className="inline-block bg-accent hover:bg-accent-hover text-white px-6 py-3 rounded-xl font-bold transition-colors">صفحة التحميل</Link>
      </div>
    </main>
  );

  return (
    <main className="min-h-screen p-3 md:p-6" dir="rtl">
      <div className="max-w-[1600px] mx-auto flex flex-col lg:flex-row-reverse lg:items-start gap-4" dir="rtl">
        <div className="flex-1 min-w-0"><InlinePlayer file={activeFile} onEnded={handleEnded} /></div>

        <div className="lg:w-[440px] shrink-0 flex flex-col bg-surface-raised rounded-2xl border border-border overflow-hidden lg:max-h-[calc(56.25vw*0.65+120px)] lg:sticky lg:top-6">
          <div className="p-4 border-b border-border space-y-3">
            <div className="relative">
              <FaSearch className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted text-xs" />
              <input type="text" placeholder="بحث..." value={search} onChange={e => setSearch(e.target.value)}
                className="w-full bg-surface border border-border rounded-lg pr-9 pl-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 transition" />
            </div>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex gap-2 text-[11px] text-text-muted">
                <span>{files.length} ملف</span>
                {videoCount > 0 && <span>🎬 {videoCount}</span>}
                {audioCount > 0 && <span>🎵 {audioCount}</span>}
              </div>
              <div className="flex gap-2 items-center">
                <Link href="/good" className="text-[11px] text-green-400 hover:text-green-300 flex items-center gap-1 transition"><FaStar /> Good</Link>
                <Link href="/bad" className="text-[11px] text-red-400 hover:text-red-300 flex items-center gap-1 transition"><FaBan /> Bad</Link>
                <Link href="/" className="text-[11px] text-accent hover:text-accent-hover transition">+ تحميل</Link>
                <button onClick={handleDeleteAll} className="text-[11px] text-danger hover:text-danger-hover flex items-center gap-1 transition"><FaBroom /> حذف الكل</button>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {filtered.length === 0 ? (
              <div className="text-center py-8 text-text-muted text-sm">لا توجد نتائج</div>
            ) : (
              <>
                {visibleItems.map((file, i) => (
                  <PlaylistItem key={file.path} file={file} isActive={files.indexOf(file) === activeIndex}
                    onClick={() => playIndex(i)} onDelete={() => handleDelete(file)}
                    onMarkGood={() => handleMark(file, "good")} onMarkBad={() => handleMark(file, "bad")} />
                ))}
                {visibleCount < filtered.length && (
                  <div ref={sentinelRef} className="text-center py-3 text-text-muted text-xs">جاري تحميل المزيد... ({visibleCount}/{filtered.length})</div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
