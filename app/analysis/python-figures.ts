import type { CanonicalColorRow } from "./engine";

// Port 3006 has its own renderer. Sharing it with other platform clones
// caused new Task 2 payloads to be interpreted by stale Python code.
const PYTHON_FIGURE_URL = "http://127.0.0.1:8773";

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
  return renderPublicationFigure({
    scope: "task1",
    kind,
    rows,
    options: { columns, width, scale, showTitle, title: emotion ? `${kind === "hs-polar" ? "Hue–Saturation" : "Value–Saturation"} Distribution: ${emotion}` : undefined, format: "png" },
  });
}

export type PublicationFigureFormat = "png" | "svg";

export async function analyzeBidirectional(payload: { colorRows: unknown[]; gewRows: unknown[]; permutations: number; tau: number; sourceOrder: string[] }) {
  let response: Response;
  try {
    response = await fetch(`${PYTHON_FIGURE_URL}/bidirectional-analysis`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("双向分析服务未启动。请重新启动 3006 后再试。");
  }
  const result = await response.json().catch(() => ({})) as Record<string, unknown> & { message?: string };
  if (!response.ok) throw new Error(result.message || `双向分析失败（HTTP ${response.status}）。`);
  return result;
}

export async function renderPublicationFigure({
  scope,
  kind,
  rows = [],
  data = [],
  cells = [],
  clusters = [],
  options,
}: {
  scope: "task1" | "task2" | "bidirectional";
  kind: string;
  rows?: unknown[];
  data?: unknown[];
  cells?: unknown[];
  clusters?: unknown[];
  options: { columns: number; width: number; scale: number; showTitle: boolean; format: PublicationFigureFormat; title?: string; metric?: string; qMetric?: string; sourceOrder?: string[]; pairingMode?: "all" | "cross-cohort"; sourceCohorts?: Record<string, string>; selectedColor?: string; selectedEmotion?: string; selectedSource?: string; sourceA?: string; sourceB?: string; displayView?: "wheel" | "dots"; compositeMetric?: string; overlapMode?: "raw" | "labels" | "rings" | "bubbles" | "density"; pointEmphasis?: "normal" | "core70" | "proximity"; showClusters?: boolean; showCentroids?: boolean; showLabDensity?: boolean; labCoordinateSystem?: "cartesian" | "polar" };
}) {
  let response: Response;
  try {
    response = await fetch(`${PYTHON_FIGURE_URL}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope,
        kind,
        rows,
        data,
        cells,
        clusters,
        options,
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

export function downloadFigureBlob(blob: Blob, fileName: string) {
  downloadPngBlob(blob, fileName);
}
