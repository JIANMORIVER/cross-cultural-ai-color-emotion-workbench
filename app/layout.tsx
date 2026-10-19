import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const title = "Chromalab 3006 · 连续色彩分布距离版 — 情绪—颜色实验与数据分析平台";
  const description = "实时模型采用 20＋11 整组提交；Gemini 使用可查询、可审计的 Native Batch API，并统一保存为逐项数据。";
  return {
    title,
    description,
    icons: { icon: "/favicon.svg" },
    openGraph: { title, description, type: "website", url: origin, images: [{ url: `${origin}/og-analysis.png`, width: 1729, height: 910, alt: "Chromalab 情绪—颜色实验与数据分析平台" }] },
    twitter: { card: "summary_large_image", title, description, images: [`${origin}/og-analysis.png`] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
