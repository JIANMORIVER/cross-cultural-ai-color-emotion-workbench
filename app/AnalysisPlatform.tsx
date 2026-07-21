"use client";

import { useMemo, useRef, useState } from "react";
import {
  colorRowsToExport,
  detectDataset,
  parseColorRows,
  parseGewRows,
  runColorClustering,
  runColorSummary,
  runDeltaE,
  runGewDescriptive,
  runGewJsd,
  runGewOmnibus,
  runGewPairwise,
  runGewQc,
  toCsv,
  type AnalysisResult,
  type DataRow,
  type ExportRow,
} from "./analysis/engine";

type SheetData = { name: string; rows: DataRow[]; columns: string[] };
type RunStatus = "idle" | "running" | "completed" | "error";
type TaskRun = { status: RunStatus; result?: AnalysisResult; error?: string };
type WorkspaceTab = "import" | "tasks" | "dashboard";

const TASKS = [
  { id: "task1-normalize", group: "实验一", title: "色彩格式标准化", description: "宽表转长表，并将 HEX、RGB、HSL、HSV 或 Lab 统一到五种标准色彩表示。", output: "标准长表" },
  { id: "task1-summary", group: "实验一", title: "来源 × 情绪描述统计", description: "汇总每个来源与情绪的样本量、平均色彩、亮度与饱和度。", output: "描述统计" },
  { id: "task1-cluster", group: "实验一", title: "最佳 K 与 Lab 聚类", description: "在 Lab 空间搜索 K=2–6，以轮廓系数选择最佳聚类并输出中心色与权重。", output: "聚类中心" },
  { id: "task1-delta", group: "实验一", title: "跨来源 ΔE 色差", description: "按情绪计算来源之间的双向最近邻 CIE76 色差，刻画模型或文化偏差。", output: "色差矩阵" },
  { id: "task2-qc", group: "实验二", title: "GEW 解析与质量控制", description: "解析 word_data.<颜色> JSON，检查无效单元格并补齐 20 情绪完整网格。", output: "QC 长表" },
  { id: "task2-descriptive", group: "实验二", title: "选择率、强度与价性", description: "按来源、颜色和情绪计算选择率、全部样本强度、已选强度与正负价性。", output: "描述统计" },
  { id: "task2-omnibus", group: "实验二", title: "来源间总体差异", description: "对每个颜色 × 情绪执行总体卡方检验，并进行 Benjamini–Hochberg FDR 校正。", output: "总体检验" },
  { id: "task2-pairwise", group: "实验二", title: "来源两两差异", description: "逐对比较来源选择率，输出效应方向、卡方、p 值与 FDR q 值。", output: "两两检验" },
  { id: "task2-jsd", group: "实验二", title: "情绪分布距离", description: "比较各来源的 20 情绪选择率分布，计算 Jensen–Shannon 距离。", output: "距离矩阵" },
] as const;

const COLOR_HEX: Record<string, string> = { J0: "#262626", A0: "#F2F2F2", G3: "#BB1F23", F17: "#00904A", C9: "#FFBC00", F29: "#007FD3", I6: "#4B2819", H35: "#6F2A78", D38: "#F38EBB", F4: "#DD4200", F0: "#808080" };

function download(name: string, content: string, type = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
}

function resultFromRows(id: string, title: string, rows: ExportRow[], summary: AnalysisResult["summary"], note?: string): AnalysisResult {
  return { id, title, kind: "table", rows, summary, note };
}

export function AnalysisPlatform() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<WorkspaceTab>("import");
  const [fileName, setFileName] = useState("");
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [sheetName, setSheetName] = useState("");
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [rowStart, setRowStart] = useState(1);
  const [rowEnd, setRowEnd] = useState(1);
  const [loadingFile, setLoadingFile] = useState(false);
  const [fileError, setFileError] = useState("");
  const [runs, setRuns] = useState<Record<string, TaskRun>>({});
  const [dashboardMode, setDashboardMode] = useState<"task1" | "task2">("task1");
  const [sourceFilter, setSourceFilter] = useState("全部来源");
  const [emotionFilter, setEmotionFilter] = useState("全部情绪");
  const [colorFilter, setColorFilter] = useState("全部颜色");
  const [metric, setMetric] = useState<"选择率" | "平均强度_全部">("选择率");

  const sheet = sheets.find(item => item.name === sheetName);
  const selectedRows = useMemo(() => {
    if (!sheet) return [];
    return sheet.rows.slice(Math.max(0, rowStart - 1), Math.min(sheet.rows.length, rowEnd)).map(row => Object.fromEntries(selectedColumns.map(column => [column, row[column]])) as DataRow);
  }, [sheet, rowStart, rowEnd, selectedColumns]);
  const detection = useMemo(() => detectDataset(selectedRows, selectedColumns), [selectedRows, selectedColumns]);
  const colorData = useMemo(() => parseColorRows(selectedRows, selectedColumns, detection.schema), [selectedRows, selectedColumns, detection.schema]);
  const gewData = useMemo(() => parseGewRows(selectedRows, selectedColumns), [selectedRows, selectedColumns]);
  const gewDescription = useMemo(() => runGewDescriptive(gewData.rows).rows, [gewData.rows]);

  const sources = useMemo(() => [...new Set((dashboardMode === "task1" ? colorData.rows.map(row => row.source) : gewData.rows.map(row => row.source)))], [dashboardMode, colorData.rows, gewData.rows]);
  const emotions = useMemo(() => [...new Set((dashboardMode === "task1" ? colorData.rows.map(row => row.emotion) : gewData.rows.map(row => row.emotion)))], [dashboardMode, colorData.rows, gewData.rows]);
  const colors = useMemo(() => [...new Set(gewData.rows.map(row => row.color))], [gewData.rows]);
  const dashboardColors = colorData.rows.filter(row => (sourceFilter === "全部来源" || row.source === sourceFilter) && (emotionFilter === "全部情绪" || row.emotion === emotionFilter));
  const dashboardGew = gewDescription.filter(row => (sourceFilter === "全部来源" || row["来源"] === sourceFilter) && (emotionFilter === "全部情绪" || row["情绪"] === emotionFilter) && (colorFilter === "全部颜色" || row["颜色"] === colorFilter));

  async function loadFiles(fileList?: FileList | File[]) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setLoadingFile(true); setFileError("");
    try {
      const XLSX = await import("xlsx"); const parsed: SheetData[] = [];
      for (const file of files) {
        const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
        workbook.SheetNames.forEach(name => {
          const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: null, raw: true }) as DataRow[];
          const rows = rawRows.map(row => ({ _source_file: file.name.replace(/\.[^.]+$/, ""), ...row }));
          const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
          parsed.push({ name: files.length > 1 ? `${file.name} · ${name}` : name, rows, columns });
        });
      }
      if (!parsed.some(item => item.rows.length)) throw new Error("文件中没有可读取的数据行。");
      const populated = parsed.filter(item => item.rows.length);
      const mergedRows = populated.flatMap(item => item.rows); const mergedColumns = [...new Set(populated.flatMap(item => item.columns))];
      const nextSheets = files.length > 1 ? [{ name: "合并全部文件", rows: mergedRows, columns: mergedColumns }, ...parsed] : parsed;
      const first = nextSheets[0];
      setFileName(files.length > 1 ? `${files.length} 个文件合并` : files[0].name); setSheets(nextSheets); setSheetName(first.name); setSelectedColumns(first.columns); setRowStart(1); setRowEnd(first.rows.length); setRuns({});
    } catch (error) { setFileError(error instanceof Error ? error.message : "无法读取该文件，请检查格式。"); }
    finally { setLoadingFile(false); }
  }

  function changeSheet(name: string) {
    const next = sheets.find(item => item.name === name); if (!next) return;
    setSheetName(name); setSelectedColumns(next.columns); setRowStart(1); setRowEnd(next.rows.length); setRuns({});
  }

  function selectAllColumns() { setSelectedColumns(sheet?.columns || []); }
  function toggleColumn(column: string) { setSelectedColumns(current => current.includes(column) ? current.filter(item => item !== column) : [...current, column]); }

  async function runTask(id: string) {
    setRuns(current => ({ ...current, [id]: { status: "running" } }));
    await new Promise(resolve => window.setTimeout(resolve, 80));
    try {
      let result: AnalysisResult;
      if (id === "task1-normalize") result = resultFromRows(id, "色彩格式标准化", colorRowsToExport(colorData.rows), [{ label: "有效色彩", value: String(colorData.rows.length) }, { label: "拒绝值", value: String(colorData.rejected) }, { label: "识别格式", value: detection.formats.join(" + ") || "—" }], "所有可解析色彩均统一输出为 HEX、RGB、HSL、HSV 与 CIE Lab。");
      else if (id === "task1-summary") result = runColorSummary(colorData.rows, colorData.rejected);
      else if (id === "task1-cluster") result = runColorClustering(colorData.rows);
      else if (id === "task1-delta") result = runDeltaE(colorData.rows);
      else if (id === "task2-qc") result = runGewQc(gewData);
      else if (id === "task2-descriptive") result = runGewDescriptive(gewData.rows);
      else if (id === "task2-omnibus") result = runGewOmnibus(gewData.rows);
      else if (id === "task2-pairwise") result = runGewPairwise(gewData.rows);
      else result = runGewJsd(gewData.rows);
      if (!result.rows.length) throw new Error("当前选择范围没有产生有效结果，请检查字段和行列范围。");
      setRuns(current => ({ ...current, [id]: { status: "completed", result } }));
    } catch (error) { setRuns(current => ({ ...current, [id]: { status: "error", error: error instanceof Error ? error.message : "分析失败" } })); }
  }

  function taskAvailable(id: string) {
    const task1 = (detection.schema === "task1-wide" || detection.schema === "task1-long" || detection.schema === "mixed") && colorData.rows.length > 0;
    const task2 = (detection.schema === "task2-gew" || detection.schema === "mixed") && gewData.rows.length > 0;
    if (id === "task1-delta") return task1 && new Set(colorData.rows.map(row => row.source)).size >= 2;
    if (["task2-omnibus", "task2-pairwise", "task2-jsd"].includes(id)) return task2 && new Set(gewData.rows.map(row => row.source)).size >= 2;
    return id.startsWith("task1") ? task1 : task2;
  }

  function exportResult(result: AnalysisResult) { download(`${fileName.replace(/\.[^.]+$/, "") || "analysis"}_${result.id}.csv`, toCsv(result.rows)); }
  function resetDashboardFilters(mode: "task1" | "task2") { setDashboardMode(mode); setSourceFilter("全部来源"); setEmotionFilter("全部情绪"); setColorFilter("全部颜色"); }

  const selectedTaskCount = TASKS.filter(task => taskAvailable(task.id)).length;
  const completeCount = Object.values(runs).filter(run => run.status === "completed").length;

  return <>
    <div className="analysis-page-title">
      <div><span className="eyebrow">步骤 07 / 07 · ANALYSIS WORKBENCH</span><h1>实验数据分析平台</h1><p>导入实验数据，确认字段与色彩格式，逐项运行可复现分析，并在筛选大屏中比较来源、情绪与颜色。</p></div>
      <div className="analysis-privacy"><span>⌁</span><p><b>浏览器本地分析</b><small>上传数据默认不离开当前设备</small></p></div>
    </div>

    <nav className="analysis-tabs" aria-label="分析工作区">
      {([["import", "01", "数据导入"], ["tasks", "02", "分析任务"], ["dashboard", "03", "数据大屏"]] as const).map(([id, number, label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}><span>{number}</span><b>{label}</b>{id === "tasks" && completeCount ? <i>{completeCount}</i> : null}</button>)}
    </nav>

    {tab === "import" ? <section className="analysis-import-layout">
      <div className="analysis-main-column">
        <section className={`analysis-dropzone ${fileName ? "loaded" : ""}`} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void loadFiles(event.dataTransfer.files); }}>
          <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" multiple onChange={event => void loadFiles(event.target.files || undefined)} />
          <div className="drop-icon">{loadingFile ? "···" : fileName ? "✓" : "↑"}</div>
          <div><span className="eyebrow">数据源</span><h2>{fileName || "上传实验数据"}</h2><p>{fileName ? `${sheets.length} 个工作表 · 当前 ${sheet?.rows.length || 0} 行 × ${sheet?.columns.length || 0} 列` : "可同时选择多个 CSV / XLS / XLSX 并自动合并；文件只在浏览器内读取。"}</p></div>
          <button className="secondary" onClick={() => inputRef.current?.click()} disabled={loadingFile}>{fileName ? "替换文件" : "选择文件"}</button>
        </section>
        {fileError ? <div className="analysis-alert error"><b>导入失败</b><span>{fileError}</span></div> : null}

        {sheet ? <>
          <section className="analysis-selection panel">
            <div className="panel-head"><div><h3>选择处理范围</h3><p>所有分析只使用这里勾选的工作表、数据行和字段列。</p></div><span className="analysis-count">{selectedRows.length} 行 × {selectedColumns.length} 列</span></div>
            <div className="analysis-range-controls">
              <label>工作表<select value={sheetName} onChange={event => changeSheet(event.target.value)}>{sheets.map(item => <option key={item.name}>{item.name}</option>)}</select></label>
              <label>起始数据行<input type="number" min="1" max={sheet.rows.length} value={rowStart} onChange={event => setRowStart(Math.min(rowEnd, Math.max(1, Number(event.target.value))))} /></label>
              <label>结束数据行<input type="number" min={rowStart} max={sheet.rows.length} value={rowEnd} onChange={event => setRowEnd(Math.min(sheet.rows.length, Math.max(rowStart, Number(event.target.value))))} /></label>
            </div>
            <div className="analysis-column-head"><div><span className="eyebrow">参与分析的列</span><b>{selectedColumns.length} / {sheet.columns.length}</b></div><div><button onClick={selectAllColumns}>全选</button><button onClick={() => setSelectedColumns([])}>清空</button></div></div>
            <div className="analysis-column-grid">{sheet.columns.map(column => <label key={column} className={selectedColumns.includes(column) ? "selected" : ""}><input type="checkbox" checked={selectedColumns.includes(column)} onChange={() => toggleColumn(column)} /><span>{column}</span></label>)}</div>
          </section>

          <section className="analysis-preview panel">
            <div className="panel-head"><div><h3>数据预览</h3><p>显示当前选择范围的前 6 行。</p></div><button className="primary" disabled={!selectedRows.length || !selectedColumns.length} onClick={() => setTab("tasks")}>进入分析任务 <span>→</span></button></div>
            <div className="analysis-table-scroll"><table><thead><tr><th>#</th>{selectedColumns.map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{selectedRows.slice(0, 6).map((row, index) => <tr key={index}><td>{rowStart + index}</td>{selectedColumns.map(column => <td key={column}>{typeof row[column] === "object" && row[column] !== null ? JSON.stringify(row[column]) : String(row[column] ?? "")}</td>)}</tr>)}</tbody></table></div>
          </section>
        </> : null}
      </div>

      <aside className="analysis-detection panel">
        <div className="panel-head"><div><span className="eyebrow">自动预检</span><h3>结构与色彩格式</h3></div><span className={`detection-score ${detection.schema === "unknown" ? "warn" : "pass"}`}>{Math.round(detection.confidence * 100)}%</span></div>
        <div className="detection-hero"><span>{detection.schema === "mixed" ? "A+B" : detection.schema === "task2-gew" ? "GEW" : detection.schema.startsWith("task1") ? "W→C" : "?"}</span><div><small>数据结构</small><b>{detection.schemaLabel}</b></div></div>
        <div className="format-section"><span className="eyebrow">识别到的色彩格式</span>{detection.formats.length ? <div>{detection.formats.map(format => <b key={format}>{format}</b>)}</div> : <p>任务二使用固定色码，或当前列中未识别到颜色通道。</p>}</div>
        <div className="detection-list">{detection.evidence.map((item, index) => <p key={index}><i>✓</i><span>{item}</span></p>)}{detection.warnings.map((item, index) => <p className="warning" key={index}><i>!</i><span>{item}</span></p>)}</div>
        <div className="detection-foot"><b>解析预估</b><span>{detection.schema === "mixed" ? `任务一 ${colorData.rows.length} 个色彩 · 任务二 ${gewData.rows.length} 行网格` : detection.schema.startsWith("task1") ? `${colorData.rows.length} 个有效色彩 · ${colorData.rejected} 个拒绝值` : detection.schema === "task2-gew" ? `${gewData.rows.length} 行完整网格 · ${gewData.invalidCells} 个无效 JSON` : "等待匹配字段"}</span></div>
      </aside>
    </section> : null}

    {tab === "tasks" ? <section className="analysis-task-workspace">
      <div className="analysis-status-strip"><div><span className="eyebrow">当前数据源</span><b>{fileName || "尚未导入文件"}</b><small>{detection.schemaLabel} · {selectedRows.length} 行 × {selectedColumns.length} 列</small></div><div><strong>{selectedTaskCount}</strong><span>项可运行</span></div><div><strong>{completeCount}</strong><span>项已完成</span></div><button className="secondary" onClick={() => setTab("import")}>调整数据范围</button></div>
      {(["实验一", "实验二"] as const).map(group => <section className="analysis-task-group" key={group}><div className="analysis-section-label"><span>{group === "实验一" ? "A" : "B"}</span><div><h2>{group === "实验一" ? "词选色分析" : "日内瓦情绪轮分析"}</h2><p>{group === "实验一" ? "对应历史 Bias、KMeans、DeltaE 与色彩可视化脚本。" : "对应 Phase 2 的质量控制、描述统计、差异检验和分布距离。"}</p></div></div><div className="analysis-task-grid">{TASKS.filter(task => task.group === group).map((task, index) => {
        const available = taskAvailable(task.id), run = runs[task.id] || { status: "idle" as const };
        return <article key={task.id} className={`analysis-task-card ${available ? "available" : "disabled"} ${run.status}`}>
          <div className="task-card-top"><span>{String(index + 1).padStart(2, "0")}</span><em className={`run-state ${run.status}`}>{run.status === "running" ? "运行中" : run.status === "completed" ? "已完成" : run.status === "error" ? "需检查" : available ? "可运行" : "不适用"}</em></div>
          <h3>{task.title}</h3><p>{task.description}</p><div className="task-output"><span>输出</span><b>{task.output}</b></div>
          {run.result ? <><div className="task-result-metrics">{run.result.summary.slice(0, 3).map(item => <div key={item.label}><strong>{item.value}</strong><span>{item.label}</span></div>)}</div><ResultPreview result={run.result} /></> : null}
          {run.error ? <div className="task-error">{run.error}</div> : null}
          <div className="task-actions"><button className="primary" disabled={!available || run.status === "running"} onClick={() => void runTask(task.id)}>{run.status === "running" ? "正在计算…" : run.status === "completed" ? "重新运行" : "启动分析"}</button><button className="secondary" disabled={!run.result} onClick={() => run.result && exportResult(run.result)}>导出 CSV ↓</button></div>
        </article>;
      })}</div></section>)}
    </section> : null}

    {tab === "dashboard" ? <section className="analysis-dashboard">
      <div className="dashboard-hero"><div><span className="eyebrow">INTERACTIVE OVERVIEW</span><h2>情绪 × 色彩数据大屏</h2><p>筛选条件会同时作用于指标、图表和大屏导出；不会改动原始数据或分析任务结果。</p></div><button className="secondary" disabled={dashboardMode === "task1" ? !dashboardColors.length : !dashboardGew.length} onClick={() => download(`${fileName || "dashboard"}_${dashboardMode}_filtered.csv`, toCsv((dashboardMode === "task1" ? colorRowsToExport(dashboardColors) : dashboardGew) as ExportRow[]))}>导出当前视图 ↓</button></div>
      <div className="dashboard-toolbar panel">
        <div className="dashboard-mode"><button className={dashboardMode === "task1" ? "active" : ""} onClick={() => resetDashboardFilters("task1")}>实验一 · 词选色</button><button className={dashboardMode === "task2" ? "active" : ""} onClick={() => resetDashboardFilters("task2")}>实验二 · 情绪轮</button></div>
        <label>来源<select value={sources.includes(sourceFilter) ? sourceFilter : "全部来源"} onChange={event => setSourceFilter(event.target.value)}><option>全部来源</option>{sources.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>情绪<select value={emotions.includes(emotionFilter) ? emotionFilter : "全部情绪"} onChange={event => setEmotionFilter(event.target.value)}><option>全部情绪</option>{emotions.map(value => <option key={value}>{value}</option>)}</select></label>
        {dashboardMode === "task2" ? <><label>颜色<select value={colors.includes(colorFilter) ? colorFilter : "全部颜色"} onChange={event => setColorFilter(event.target.value)}><option>全部颜色</option>{colors.map(value => <option key={value}>{value}</option>)}</select></label><label>指标<select value={metric} onChange={event => setMetric(event.target.value as typeof metric)}><option>选择率</option><option>平均强度_全部</option></select></label></> : null}
      </div>

      {dashboardMode === "task1" ? <Task1Dashboard rows={dashboardColors} /> : <Task2Dashboard rows={dashboardGew} metric={metric} />}
    </section> : null}
  </>;
}

function ResultPreview({ result }: { result: AnalysisResult }) {
  const columns = Object.keys(result.rows[0] || {}).slice(0, 4);
  return <details className="task-preview"><summary>预览结果 · {result.rows.length} 行</summary><div><table><thead><tr>{columns.map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{result.rows.slice(0, 3).map((row, index) => <tr key={index}>{columns.map(column => <td key={column}>{column.toLowerCase().includes("hex") ? <><i className="tiny-swatch" style={{ background: String(row[column]) }} />{String(row[column])}</> : String(row[column] ?? "")}</td>)}</tr>)}</tbody></table>{result.note ? <p>{result.note}</p> : null}</div></details>;
}

function Task1Dashboard({ rows }: { rows: ReturnType<typeof parseColorRows>["rows"] }) {
  const average = (key: "s" | "l" | "labL") => rows.length ? rows.reduce((sum, row) => sum + row[key], 0) / rows.length : 0;
  const swatches = [...new Map(rows.map(row => [row.hex, row])).values()].slice(0, 80);
  return <>
    <div className="dashboard-kpis"><article><span>有效色彩</span><strong>{rows.length.toLocaleString()}</strong><small>当前筛选范围</small></article><article><span>来源数</span><strong>{new Set(rows.map(row => row.source)).size}</strong><small>模型 / 文化组</small></article><article><span>平均饱和度</span><strong>{(average("s") * 100).toFixed(1)}%</strong><small>HSL S</small></article><article><span>平均明度</span><strong>{average("labL").toFixed(1)}</strong><small>CIE Lab L*</small></article></div>
    <div className="dashboard-grid">
      <section className="dashboard-panel panel"><div className="panel-head"><div><h3>色相–饱和度分布</h3><p>每个点代表一个有效词选色观察，点色为其真实 HEX。</p></div><span className="analysis-count">H 0–360° · S 0–100%</span></div>{rows.length ? <svg className="hs-scatter" viewBox="0 0 760 360" role="img" aria-label="色相饱和度散点图"><line x1="48" x2="730" y1="320" y2="320" /><line x1="48" x2="48" y1="25" y2="320" />{[0, 90, 180, 270, 360].map(value => <g key={value}><line className="grid" x1={48 + value / 360 * 682} x2={48 + value / 360 * 682} y1="25" y2="320" /><text x={48 + value / 360 * 682} y="342">{value}°</text></g>)}{[0, .25, .5, .75, 1].map(value => <g key={value}><line className="grid" x1="48" x2="730" y1={320 - value * 295} y2={320 - value * 295} /><text x="12" y={324 - value * 295}>{value * 100}%</text></g>)}{rows.slice(0, 1200).map((row, index) => <circle key={index} cx={48 + row.h / 360 * 682} cy={320 - row.s * 295} r="4.5" fill={row.hex} />)}</svg> : <DashboardEmpty />}</section>
      <section className="dashboard-panel panel"><div className="panel-head"><div><h3>当前色彩样本</h3><p>去重后的色块矩阵，悬停查看来源与情绪。</p></div><span className="analysis-count">{swatches.length} 色</span></div>{swatches.length ? <div className="swatch-mosaic">{swatches.map((row, index) => <div key={`${row.hex}-${index}`} style={{ background: row.hex }} title={`${row.source} · ${row.emotion} · ${row.hex}`}><span>{row.hex}</span></div>)}</div> : <DashboardEmpty />}</section>
    </div>
  </>;
}

function Task2Dashboard({ rows, metric }: { rows: ExportRow[]; metric: "选择率" | "平均强度_全部" }) {
  const numeric = rows.map(row => Number(row[metric]) || 0); const maximum = metric === "选择率" ? 1 : 5; const sorted = [...rows].sort((a, b) => Number(b[metric]) - Number(a[metric])).slice(0, 24);
  const selectedTotal = rows.reduce((sum, row) => sum + Number(row["选择次数"] || 0), 0); const sampleTotal = rows.reduce((sum, row) => sum + Number(row["N"] || 0), 0);
  return <>
    <div className="dashboard-kpis"><article><span>统计单元</span><strong>{rows.length.toLocaleString()}</strong><small>来源 × 颜色 × 情绪</small></article><article><span>总体选择率</span><strong>{sampleTotal ? (selectedTotal / sampleTotal * 100).toFixed(1) : "0.0"}%</strong><small>当前筛选范围</small></article><article><span>平均指标</span><strong>{numeric.length ? (numeric.reduce((sum, value) => sum + value, 0) / numeric.length).toFixed(2) : "0.00"}</strong><small>{metric}</small></article><article><span>来源数</span><strong>{new Set(rows.map(row => row["来源"])).size}</strong><small>当前可见</small></article></div>
    <div className="dashboard-grid wide-left">
      <section className="dashboard-panel panel"><div className="panel-head"><div><h3>{metric}排行</h3><p>显示当前筛选中数值最高的 24 个来源 × 颜色 × 情绪组合。</p></div><span className="analysis-count">{metric === "选择率" ? "0–100%" : "0–5"}</span></div>{sorted.length ? <div className="gew-bars">{sorted.map((row, index) => <div key={index}><span className="bar-label"><b>{String(row["情绪"])}</b><small>{String(row["来源"])} · {String(row["颜色"])}</small></span><i><em style={{ width: `${Math.min(100, Number(row[metric]) / maximum * 100)}%`, background: COLOR_HEX[String(row["颜色"])] || "#34839a" }} /></i><strong>{metric === "选择率" ? `${(Number(row[metric]) * 100).toFixed(1)}%` : Number(row[metric]).toFixed(2)}</strong></div>)}</div> : <DashboardEmpty />}</section>
      <section className="dashboard-panel panel"><div className="panel-head"><div><h3>颜色覆盖</h3><p>每种色码的可见统计单元数。</p></div></div>{rows.length ? <div className="color-coverage">{[...new Set(rows.map(row => String(row["颜色"])))].map(color => { const count = rows.filter(row => row["颜色"] === color).length; return <div key={color}><i style={{ background: COLOR_HEX[color] || "#9aa" }} /><span><b>{color}</b><small>{count} 个统计单元</small></span></div>; })}</div> : <DashboardEmpty />}</section>
    </div>
  </>;
}

function DashboardEmpty() { return <div className="dashboard-empty"><span>○</span><b>当前筛选没有可显示的数据</b><small>请调整来源、情绪或颜色筛选。</small></div>; }
