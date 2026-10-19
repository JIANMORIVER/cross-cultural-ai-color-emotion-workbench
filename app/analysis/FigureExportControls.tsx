"use client";

export type FigureExportStyle = {
  columns: number;
  width: number;
  scale: number;
  showTitle: boolean;
  format: "png" | "svg";
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
  onExport: (format: FigureExportStyle["format"]) => void;
  exportLabel?: string;
  disabled?: boolean;
  busy?: boolean;
  batchAction?: { label: string; onClick: () => void; disabled?: boolean };
}) {
  const format = value.format || "png";
  return <div className="figure-export-controls">
    <span>论文图片样式</span>
    <label>每行分面
      <select value={value.columns} onChange={event => onChange({ ...value, columns: Number(event.target.value) })}>
        {[2, 3, 4, 5].map(columns => <option key={columns} value={columns}>{columns} 图</option>)}
      </select>
    </label>
    <label>版心宽度（px）
      <input
        type="number"
        min={1200}
        max={7200}
        step={100}
        list="publication-figure-widths"
        value={value.width}
        onChange={event => {
          const width = Number(event.target.value);
          if (Number.isFinite(width)) onChange({ ...value, width: Math.max(1200, Math.min(7200, Math.round(width / 100) * 100)) });
        }}
      />
      <datalist id="publication-figure-widths">
        <option value="2400" />
        <option value="3600" />
        <option value="4200" />
        <option value="5400" />
        <option value="7200" />
      </datalist>
      <small>可自定 1200–7200；推荐 4200</small>
    </label>
    <label>输出清晰度
      <select value={value.scale} onChange={event => onChange({ ...value, scale: Number(event.target.value) })}>
        <option value={2}>论文标准 · 2×</option>
        <option value={3}>高精印刷 · 3×</option>
      </select>
    </label>
    <label>文件格式
      <select value={format} onChange={event => onChange({ ...value, format: event.target.value as FigureExportStyle["format"] })}>
        <option value="png">PNG · 300 dpi</option>
        <option value="svg">SVG · 可编辑矢量</option>
      </select>
    </label>
    <label className="figure-title-toggle">
      <input type="checkbox" checked={value.showTitle} onChange={event => onChange({ ...value, showTitle: event.target.checked })} />
      保留标题与说明
    </label>
    {batchAction ? <button className="secondary" disabled={disabled || busy || batchAction.disabled} onClick={batchAction.onClick}>{batchAction.label}</button> : null}
    <button className="primary" disabled={disabled || busy} onClick={() => onExport(format)}>{busy ? "正在生成…" : `${exportLabel} ${format.toUpperCase()}`}</button>
  </div>;
}
