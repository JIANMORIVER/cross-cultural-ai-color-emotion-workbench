import type { CanonicalColorRow } from "./engine";

const PYTHON_FIGURE_URL = "http://127.0.0.1:8765";

export async function renderPythonHsvPng({
  kind,
  emotion,
  rows,
  groups,
  columns,
  width,
  scale,
  showTitle,
}: {
  kind: "hs-polar" | "vs-density";
  emotion: string;
  rows: CanonicalColorRow[];
  groups: string[];
  columns: number;
  width: number;
  scale: number;
  showTitle: boolean;
}) {
  let response: Response;
  try {
    response = await fetch(`${PYTHON_FIGURE_URL}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        emotion,
        groups,
        columns,
        width,
        scale,
        showTitle,
        rows: rows.map(row => ({
          source: row.source,
          emotion: row.emotion,
          hex: row.hex,
          hsvH: row.hsvH,
          hsvS: row.hsvS,
          hsvV: row.hsvV,
        })),
      }),
    });
  } catch {
    throw new Error("Python 图片服务未启动。请重新启动本地网页后再导出。");
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(error.message || `Python 绘图失败（HTTP ${response.status}）。`);
  }
  return response.blob();
}

export function downloadPngBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

