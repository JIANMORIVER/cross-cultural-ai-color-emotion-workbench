"use client";

export type FigureExportStyle = {
  columns: number;
  width: number;
  scale: number;
  showTitle: boolean;
};

export function FigureExportControls({
  value,
  onChange,
  onExport,
  exportLabel = "导出当前视图 PNG",
  disabled = false,
  busy = false,
  batchAction,
}: {
  value: FigureExportStyle;
  onChange: (value: FigureExportStyle) => void;
  onExport: () => void;
  exportLabel?: string;
  disabled?: boolean;
  busy?: boolean;
  batchAction?: { label: string; onClick: () => void; disabled?: boolean };
}) {
  return <div className="figure-export-controls">
    <span>论文图片样式</span>
    <label>每行分面
      <select value={value.columns} onChange={event => onChange({ ...value, columns: Number(event.target.value) })}>
        {[2, 3, 4, 5].map(columns => <option key={columns} value={columns}>{columns} 图</option>)}
      </select>
    </label>
    <label>版心宽度
      <select value={value.width} onChange={event => onChange({ ...value, width: Number(event.target.value) })}>
        <option value={1200}>1200 px</option>
        <option value={1800}>1800 px</option>
        <option value={2400}>2400 px</option>
        <option value={2850}>参考图尺寸 · 2850 px</option>
      </select>
    </label>
    <label>输出清晰度
      <select value={value.scale} onChange={event => onChange({ ...value, scale: Number(event.target.value) })}>
        <option value={2}>论文标准 · 2×</option>
        <option value={3}>高精印刷 · 3×</option>
      </select>
    </label>
    <label className="figure-title-toggle">
      <input type="checkbox" checked={value.showTitle} onChange={event => onChange({ ...value, showTitle: event.target.checked })} />
      保留标题与说明
    </label>
    {batchAction ? <button className="secondary" disabled={disabled || busy || batchAction.disabled} onClick={batchAction.onClick}>{batchAction.label}</button> : null}
    <button className="primary" disabled={disabled || busy} onClick={onExport}>{busy ? "正在生成…" : exportLabel}</button>
  </div>;
}
