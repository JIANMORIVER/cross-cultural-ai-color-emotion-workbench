import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const title = "Chromalab — 情绪—颜色实验与数据分析平台";
  const description = "从实验采集到 HEX、Lab、ΔE、GEW 与跨来源统计的可复现情绪—颜色研究工作台。";
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
