"use client";

const STORAGE_PREFIX = "chromalab:figure-sources:";
const PAIRING_STORAGE_PREFIX = "chromalab:figure-pairing:";
export type FigurePairingMode = "all" | "cross-cohort";

export function readFigureSourceSelection(key: string): string[] | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const value = JSON.parse(window.localStorage.getItem(`${STORAGE_PREFIX}${key}`) || "null");
    return Array.isArray(value) ? value.map(String) : undefined;
  } catch { return undefined; }
}

export function saveFigureSourceSelection(key: string, sources: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(sources));
}

export function readFigurePairingMode(key: string): FigurePairingMode | undefined {
  if (typeof window === "undefined") return undefined;
  return window.localStorage.getItem(`${PAIRING_STORAGE_PREFIX}${key}`) === "cross-cohort" ? "cross-cohort" : window.localStorage.getItem(`${PAIRING_STORAGE_PREFIX}${key}`) === "all" ? "all" : undefined;
}

export function saveFigurePairingMode(key: string, mode: FigurePairingMode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`${PAIRING_STORAGE_PREFIX}${key}`, mode);
}

export function normalizeFigureSources(available: string[], selected?: string[]) {
  if (!selected) return [...available];
  return selected.filter(source => available.includes(source));
}

export function orderFigureRows<T>(rows: T[], order: string[], sourceOf: (row: T) => string) {
  const allowed = new Set(order);
  const rank = new Map(order.map((source, index) => [source, index]));
  return rows.map((row, index) => ({ row, index }))
    .filter(item => allowed.has(sourceOf(item.row)))
    .sort((a, b) => (rank.get(sourceOf(a.row)) ?? 9999) - (rank.get(sourceOf(b.row)) ?? 9999) || a.index - b.index)
    .map(item => item.row);
}

export function FigureSourceSelector({
  available,
  selected,
  onChange,
  pairingMode,
  onPairingModeChange,
  compact = false,
}: {
  available: string[];
  selected: string[];
  onChange: (sources: string[]) => void;
  pairingMode?: FigurePairingMode;
  onPairingModeChange?: (mode: FigurePairingMode) => void;
  compact?: boolean;
}) {
  const toggle = (source: string) => onChange(selected.includes(source) ? selected.filter(item => item !== source) : [...selected, source]);
  const move = (source: string, direction: -1 | 1) => {
    const next = [...selected], index = next.indexOf(source), target = index + direction;
    if (index < 0 || target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  return <details className={`figure-source-selector ${compact ? "compact" : ""}`}>
    <summary>图中数据组 <b>{selected.length}/{available.length}</b> · 调整顺序</summary>
    <div className="figure-source-selector-actions"><button type="button" onClick={() => onChange([...available])}>全选</button><button type="button" onClick={() => onChange([])}>清空</button></div>
    {pairingMode && onPairingModeChange ? <div className="figure-pairing-mode"><span>组对</span><button type="button" className={pairingMode === "all" ? "active" : ""} onClick={() => onPairingModeChange("all")}>全部组对</button><button type="button" className={pairingMode === "cross-cohort" ? "active" : ""} onClick={() => onPairingModeChange("cross-cohort")}>仅人类–AI</button></div> : null}
    <div className="figure-source-selector-list">{available.map(source => {
      const index = selected.indexOf(source), checked = index >= 0;
      return <div key={source} className={checked ? "selected" : ""}><label><input type="checkbox" checked={checked} onChange={() => toggle(source)} /><span>{source}</span></label><em>{checked ? index + 1 : "—"}</em><button type="button" disabled={!checked || index === 0} onClick={() => move(source, -1)}>↑</button><button type="button" disabled={!checked || index === selected.length - 1} onClick={() => move(source, 1)}>↓</button></div>;
    })}</div>
    {!selected.length ? <p>当前图未选择任何数据组，因此不会生成图像。</p> : <p>网页预览、当前图 CSV、PNG 和 SVG 均按此顺序。</p>}
  </details>;
}
