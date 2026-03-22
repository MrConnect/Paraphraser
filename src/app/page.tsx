"use client";

import { useState } from "react";
import { FaCloudDownloadAlt, FaSpinner, FaPlayCircle } from "react-icons/fa";
import Link from "next/link";

interface LogEntry {
  time: string;
  text: string;
  isError?: boolean;
}

export default function DownloadPage() {
  const [url, setUrl] = useState("");
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [done, setDone] = useState(false);

  const addLog = (text: string, isError = false) => {
    const time = new Date().toLocaleTimeString("ar-EG", { hour12: false });
    setLogs((prev) => [...prev, { time, text, isError }]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || processing) return;
    setProcessing(true);
    setProgress(0);
    setLogs([]);
    setDone(false);

    try {
      const res = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });

      if (!res.body) throw new Error("No stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let hasError = false;

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        const lines = decoder.decode(value, { stream: true }).split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const d = JSON.parse(line);
            if (d.message) addLog(d.message, d.isError);
            if (typeof d.progress === "number" && d.progress >= 0) setProgress(d.progress);
            if (d.isError) hasError = true;
          } catch {}
        }
      }

      if (!hasError) {
        setUrl("");
        setDone(true);
      }
    } catch {
      addLog("فشل الاتصال بالسيرفر", true);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-2xl space-y-6">
        {/* Header */}
        <div className="text-center space-y-3">
          <h1 className="text-3xl md:text-4xl font-extrabold bg-gradient-to-l from-accent to-purple-400 bg-clip-text text-transparent">
            مستخرج الميديا
          </h1>
          <p className="text-text-secondary text-sm">
            ضع رابط ملف مضغوط (ZIP / RAR) وسنقوم بتحميله وفك ضغطه وتجهيز الفيديوهات تلقائياً
          </p>
        </div>

        {/* Form */}
        <div className="bg-surface-raised rounded-2xl border border-border p-6 space-y-5">
          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
            <input
              type="url"
              placeholder="الصق رابط الملف هنا..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={processing}
              required
              className="flex-1 bg-surface border border-border rounded-xl px-4 py-3 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition disabled:opacity-40"
            />
            <button
              type="submit"
              disabled={processing}
              className="bg-accent hover:bg-accent-hover text-white px-6 py-3 rounded-xl font-bold flex items-center justify-center gap-2 whitespace-nowrap transition-colors disabled:opacity-40"
            >
              {processing ? (
                <><FaSpinner className="animate-spin" /> جاري المعالجة</>
              ) : (
                <><FaCloudDownloadAlt /> تحميل واستخراج</>
              )}
            </button>
          </form>

          {/* Progress + Logs */}
          {(processing || logs.length > 0) && (
            <div className="bg-surface rounded-xl border border-border p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex-1 h-2.5 bg-surface-overlay rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-l from-accent to-purple-500 rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <span className="text-xs text-text-secondary font-mono w-10 text-left">{progress}%</span>
              </div>

              <div className="bg-black/40 rounded-lg p-3 max-h-48 overflow-y-auto font-mono text-xs space-y-1 border border-border/50">
                {logs.map((log, i) => (
                  <div key={i} className={`flex gap-2 ${log.isError ? "text-danger" : "text-green-400"}`}>
                    <span className="text-text-muted shrink-0">[{log.time}]</span>
                    <span>{log.text}</span>
                  </div>
                ))}
                <div ref={(el) => el?.scrollIntoView({ behavior: "smooth" })} />
              </div>
            </div>
          )}
        </div>

        {/* Success CTA */}
        {done && (
          <Link
            href="/player"
            className="flex items-center justify-center gap-3 bg-green-600 hover:bg-green-700 text-white py-4 rounded-2xl font-bold text-lg transition-colors"
          >
            <FaPlayCircle className="text-2xl" /> اذهب إلى المشغل ▸
          </Link>
        )}

        {/* Player Link */}
        <div className="text-center">
          <Link href="/player" className="text-text-muted hover:text-accent text-sm transition-colors">
            لديك ملفات بالفعل؟ اذهب للمشغل ←
          </Link>
        </div>
      </div>
    </main>
  );
}
