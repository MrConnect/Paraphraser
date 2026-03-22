import type { Metadata } from "next";
import { Cairo } from "next/font/google";
import "./globals.css";

const cairo = Cairo({ subsets: ["arabic", "latin"] });

export const metadata: Metadata = {
  title: "ميديا بلاير — مستخرج ومشغل الوسائط",
  description: "حمّل ملفات ZIP و RAR واستعرض وشغّل الفيديوهات والأصوات مباشرة",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className={`${cairo.className} antialiased`}>{children}</body>
    </html>
  );
}
