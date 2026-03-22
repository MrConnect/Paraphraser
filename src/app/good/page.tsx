"use client";

import { useState, useEffect, useCallback } from "react";
import { FaDownload, FaFileArchive, FaTrash, FaArrowRight, FaSpinner, FaVideo, FaVolumeUp } from "react-icons/fa";
import Link from "next/link";

interface GoodFile {
  path: string;
  name: string;
  type: string;
  ext: string;
  size: number;
  duration: number;
  thumbnail: string | null;
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
  if (bytes < 1048576) return (bytes / 1024).toFixed(0) + " KB";
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB";
  return (bytes / 1073741824).toFixed(2) + " GB";
}

export default function GoodPage() {
  const [files, setFiles] = useState<GoodFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [zipping, setZipping] = useState(false);
  const [zipInfo, setZipInfo] = useState<{ id: string; name: string; downloadUrl: string } | null>(null);

  const fetchFiles = useCallback(async () => {
    try {
      const res = await fetch("/api/good");
      const data = await res.json();
      setFiles(data.files || []);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);

  const handleDownloadSingle = (file: GoodFile) => {
    const a = document.createElement("a");
    a.href = `/api/download?file=${encodeURIComponent(file.path)}`;
    a.download = file.name;
    a.click();
  };

  const handleDownloadAll = async () => {
    setZipping(true);
    try {
      const res = await fetch("/api/download", { method: "POST" });
      const data = await res.json();
      if (data.error) { alert(data.error); return; }
      setZipInfo(data);
      // Auto-start download
      const a = document.createElement("a");
      a.href = data.downloadUrl;
      a.download = data.name;
      a.click();
    } catch { alert("فشل إنشاء الأرشيف"); }
    finally { setZipping(false); }
  };

  const handleRemove = async (file: GoodFile, permanent: boolean) => {
    const msg = permanent ? `حذف "${file.name}" نهائياً؟` : `إرجاع "${file.name}" للقائمة الرئيسية؟`;
    if (!confirm(msg)) return;
    try {
      await fetch("/api/good", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filePath: file.path, permanent }) });
      await fetchFiles();
    } catch { alert("فشل"); }
  };

  const totalSize = files.reduce((a, f) => a + f.size, 0);

  if (loading) return <main className="min-h-screen flex items-center justify-center"><div className="text-text-muted animate-pulse">جاري التحميل...</div></main>;

  return (
    <main className="min-h-screen p-4 md:p-8" dir="rtl">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">⭐ قائمة المفضلة</h1>
            <p className="text-sm text-text-muted mt-1">{files.length} ملف · {fmtSize(totalSize)}</p>
          </div>
          <Link href="/player" className="text-sm text-accent hover:text-accent-hover flex items-center gap-1 transition">
            <FaArrowRight /> الرجوع للمشغل
          </Link>
        </div>

        {/* Actions */}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleDownloadAll}
              disabled={zipping}
              className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl font-semibold flex items-center gap-2 transition-colors"
            >
              {zipping ? <><FaSpinner className="animate-spin" /> جاري الضغط...</> : <><FaFileArchive /> تحميل الكل كـ ZIP</>}
            </button>
          </div>
        )}

        {/* ZIP Link if generated */}
        {zipInfo && (
          <div className="bg-green-600/10 border border-green-500/30 p-4 rounded-xl text-sm">
            <p className="text-green-400 font-semibold">✅ تم إنشاء الأرشيف: {zipInfo.name}</p>
            <p className="text-text-muted mt-1">الرابط يدعم الاستئناف وصالح لمدة 96 ساعة</p>
            <a href={zipInfo.downloadUrl} download className="text-accent hover:underline mt-2 inline-block">اضغط هنا للتحميل مرة أخرى ↓</a>
          </div>
        )}

        {/* File list */}
        {files.length === 0 ? (
          <div className="text-center py-20 bg-surface-raised/50 rounded-2xl border border-border/30">
            <p className="text-text-secondary">لا توجد ملفات في المفضلة</p>
            <Link href="/player" className="text-accent text-sm mt-2 inline-block">اذهب للمشغل وعلّم الملفات بـ ✓</Link>
          </div>
        ) : (
          <div className="space-y-2">
            {files.map((file) => (
              <div key={file.path} className="bg-surface-raised rounded-xl border border-border p-3 flex items-center gap-3 hover:border-border-hover transition group">
                {/* Thumbnail */}
                <div className="relative w-32 h-20 rounded-lg overflow-hidden bg-surface-overlay shrink-0">
                  {file.thumbnail ? (
                    <img src={file.thumbnail} alt={file.name} className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      {file.type === "video" ? <FaVideo className="text-xl text-text-muted" /> : <FaVolumeUp className="text-xl text-purple-400" />}
                    </div>
                  )}
                  {file.duration > 0 && (
                    <span className="absolute bottom-1 left-1 bg-black/80 text-white text-[10px] px-1.5 py-0.5 rounded font-mono">{fmtDuration(file.duration)}</span>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-text-primary truncate">{file.name}</h3>
                  <p className="text-[11px] text-text-muted mt-1">{file.ext.replace(".", "").toUpperCase()} · {fmtSize(file.size)}</p>
                </div>

                {/* Actions */}
                <div className="flex gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0">
                  <button onClick={() => handleDownloadSingle(file)} className="text-accent hover:bg-accent/10 p-2 rounded-lg transition" title="تحميل">
                    <FaDownload />
                  </button>
                  <button onClick={() => handleRemove(file, false)} className="text-yellow-400 hover:bg-yellow-500/10 p-2 rounded-lg transition" title="إرجاع للقائمة">
                    <FaArrowRight />
                  </button>
                  <button onClick={() => handleRemove(file, true)} className="text-danger hover:bg-danger/10 p-2 rounded-lg transition" title="حذف نهائي">
                    <FaTrash />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
