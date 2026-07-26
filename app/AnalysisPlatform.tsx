"use client";

import { useMemo, useRef, useState } from "react";
import { Task1VisualLab } from "./analysis/Task1VisualLab";
import {
  colorRowsToExport,
  detectDataset,
  parseColorRows,
  parseGewRows,
  runColorClustering,
  runCulturalBias,
  runColorSummary,
  runDeltaE,
  runHsvDistribution,
  runGewDescriptive,
  runGewJsd,
  runGewOmnibus,
  runGewPairwise,
  runGewQc,
  runWithinGroupDelta,
  toCsv,
  type AnalysisResult,
  type DataRow,
  type ExportRow,
} from "./analysis/engine";

type SheetData = { name: string; rows: DataRow[]; columns: string[] };
type ExperimentGroup = {
  id: string;
  label: string;
  fileName: string;
  sheets: SheetData[];
  sheetName: string;
  selectedColumns: string[];
  rowStart: number;
  rowEnd: number;
  enabled: boolean;
};
type RunStatus = "idle" | "running" | "completed" | "error";
type TaskRun = { status: RunStatus; result?: AnalysisResult; error?: string };
type WorkspaceTab = "import" | "tasks" | "dashboard";
type AnalysisScope = "combined" | "active";

const TASKS = [
  { id: "task1-normalize", group: "实验一", title: "色彩格式标准化", description: "宽表转长表，并将 HEX、RGB、HSL、HSV 或 Lab 统一到五种标准色彩表示。", output: "标准长表" },
  { id: "task1-summary", group: "实验一", title: "来源 × 情绪描述统计", description: "汇总每个来源与情绪的样本量、平均色彩、亮度与饱和度。", output: "描述统计" },
  { id: "task1-hsv", group: "实验一", title: "HSV 分布与 H–S / V–S 图", description: "由 RGB 转换 HSV，生成按来源分面的 H–S 极坐标和 V–S 密度散点数据。", output: "HSV 长表 + 图表" },
  { id: "task1-cluster", group: "实验一", title: "最佳 K 与 Lab 聚类", description: "按历史脚本在 Lab 空间搜索 K=2–5，以轮廓系数选择最佳聚类并输出中心色与权重；少于 5 个样本的组合跳过。", output: "聚类中心" },
  { id: "task1-within-delta", group: "实验一", title: "组内色差与选择一致性", description: "生成组内 ΔE 矩阵摘要，计算平均最近邻色差和全部样本对平均色差。", output: "组内一致性" },
  { id: "task1-delta", group: "实验一", title: "跨来源 ΔE 色差", description: "按情绪计算来源之间的双向最近邻 CIE76 色差，刻画模型或文化偏差。", output: "色差矩阵" },
  { id: "task1-bias", group: "实验一", title: "跨文化引力与偏置指数", description: "以任意两个来源为参照，计算其他来源在每个情绪上的文化偏置方向与强度。", output: "偏置指数" },
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

function configuredRows(group?: ExperimentGroup) {
  if (!group) return [];
  const sheet = group.sheets.find(item => item.name === group.sheetName);
  if (!sheet) return [];
  return sheet.rows
    .slice(Math.max(0, group.rowStart - 1), Math.min(sheet.rows.length, group.rowEnd))
    .map(row => ({
      ...Object.fromEntries(group.selectedColumns.map(column => [column, row[column]])),
      _analysis_group: group.label,
    }) as DataRow);
}

function safeFileName(value: string) {
  return value.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-") || "analysis";
}

export function AnalysisPlatform() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<WorkspaceTab>("import");
  const [groups, setGroups] = useState<ExperimentGroup[]>([]);
  const [activeGroupId, setActiveGroupId] = useState("");
  const [analysisScope, setAnalysisScope] = useState<AnalysisScope>("combined");
  const [loadingFile, setLoadingFile] = useState(false);
  const [fileError, setFileError] = useState("");
  const [runs, setRuns] = useState<Record<string, TaskRun>>({});
  const [dashboardMode, setDashboardMode] = useState<"task1" | "task2">("task1");
  const [sourceFilter, setSourceFilter] = useState("全部来源");
  const [emotionFilter, setEmotionFilter] = useState("全部情绪");
  const [colorFilter, setColorFilter] = useState("全部颜色");
  const [metric, setMetric] = useState<"选择率" | "平均强度_全部">("选择率");

  const activeGroup = groups.find(group => group.id === activeGroupId) || groups[0];
  const sheet = activeGroup?.sheets.find(item => item.name === activeGroup.sheetName);
  const enabledGroups = groups.filter(group => group.enabled);
  const analysisGroups = analysisScope === "combined" ? enabledGroups : activeGroup ? [activeGroup] : [];
  const selectedColumns = useMemo(() => analysisGroups.length ? [...new Set(["_analysis_group", ...analysisGroups.flatMap(group => group.selectedColumns)])] : [], [analysisGroups]);
  const selectedRows = useMemo(() => {
    return analysisGroups.flatMap(group => configuredRows(group));
  }, [analysisGroups]);
  const activeRows = useMemo(() => configuredRows(activeGroup), [activeGroup]);
  const fileName = groups.length
    ? analysisScope === "combined"
      ? `${enabledGroups.length}组实验_合并分析`
      : activeGroup?.label || "单组分析"
    : "";
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
      const XLSX = await import("xlsx"); const incoming: ExperimentGroup[] = [];
      for (const file of files) {
        const buffer = await file.arrayBuffer();
        const workbook = file.name.toLowerCase().endsWith(".csv")
          ? XLSX.read(new TextDecoder("utf-8").decode(buffer), { type: "string", cellDates: true })
          : XLSX.read(buffer, { type: "array", cellDates: true });
        const parsed: SheetData[] = [];
        workbook.SheetNames.forEach(name => {
          const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: null, raw: true }) as DataRow[];
          const rows = rawRows.map(row => ({ _source_file: file.name.replace(/\.[^.]+$/, ""), ...row }));
          const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
          if (rows.length) parsed.push({ name, rows, columns });
        });
        if (!parsed.length) continue;
        const first = parsed[0];
        incoming.push({
          id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${incoming.length}`,
          label: file.name.replace(/\.[^.]+$/, ""),
          fileName: file.name,
          sheets: parsed,
          sheetName: first.name,
          selectedColumns: first.columns,
          rowStart: 1,
          rowEnd: first.rows.length,
          enabled: true,
        });
      }
      if (!incoming.length) throw new Error("所选文件中没有可读取的数据行。");
      setGroups(current => [...current, ...incoming]);
      setActiveGroupId(incoming[0].id);
      setAnalysisScope(current => groups.length || incoming.length > 1 ? "combined" : current);
      setRuns({});
    } catch (error) { setFileError(error instanceof Error ? error.message : "无法读取该文件，请检查格式。"); }
    finally { setLoadingFile(false); }
  }

  function updateGroup(id: string, update: (group: ExperimentGroup) => ExperimentGroup) {
    setGroups(current => current.map(group => group.id === id ? update(group) : group));
    setRuns({});
  }

  function changeSheet(name: string) {
    if (!activeGroup) return;
    const next = activeGroup.sheets.find(item => item.name === name); if (!next) return;
    updateGroup(activeGroup.id, group => ({ ...group, sheetName: name, selectedColumns: next.columns, rowStart: 1, rowEnd: next.rows.length }));
  }

  function removeGroup(id: string) {
    setGroups(current => {
      const next = current.filter(group => group.id !== id);
      if (activeGroupId === id) setActiveGroupId(next[0]?.id || "");
      return next;
    });
    setRuns({});
  }

  function duplicateGroup(id: string) {
    const source = groups.find(group => group.id === id);
    if (!source) return;
    const duplicate = {
      ...source,
      id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-copy`,
      label: `${source.label} · 副本`,
    };
    setGroups(current => [...current, duplicate]);
    setActiveGroupId(duplicate.id);
    setRuns({});
  }

  function clearGroups() {
    setGroups([]); setActiveGroupId(""); setRuns({}); setFileError("");
  }

  function selectAllColumns() {
    if (activeGroup && sheet) updateGroup(activeGroup.id, group => ({ ...group, selectedColumns: sheet.columns }));
  }

  function toggleColumn(column: string) {
    if (!activeGroup) return;
    updateGroup(activeGroup.id, group => ({ ...group, selectedColumns: group.selectedColumns.includes(column) ? group.selectedColumns.filter(item => item !== column) : [...group.selectedColumns, column] }));
  }

  async function runTask(id: string) {
    setRuns(current => ({ ...current, [id]: { status: "running" } }));
    await new Promise(resolve => window.setTimeout(resolve, 80));
    try {
      let result: AnalysisResult;
      if (id === "task1-normalize") result = resultFromRows(id, "色彩格式标准化", colorRowsToExport(colorData.rows), [{ label: "有效色彩", value: String(colorData.rows.length) }, { label: "拒绝值", value: String(colorData.rejected) }, { label: "识别格式", value: detection.formats.join(" + ") || "—" }], "所有可解析色彩均统一输出为 HEX、RGB、HSL、HSV 与 CIE Lab。");
      else if (id === "task1-summary") result = runColorSummary(colorData.rows, colorData.rejected);
      else if (id === "task1-hsv") result = runHsvDistribution(colorData.rows);
      else if (id === "task1-cluster") result = runColorClustering(colorData.rows);
      else if (id === "task1-within-delta") result = runWithinGroupDelta(colorData.rows);
      else if (id === "task1-delta") result = runDeltaE(colorData.rows);
      else if (id === "task1-bias") result = runCulturalBias(colorData.rows);
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
    if (id === "task1-bias") return task1 && new Set(colorData.rows.map(row => row.source)).size >= 3;
    if (["task2-omnibus", "task2-pairwise", "task2-jsd"].includes(id)) return task2 && new Set(gewData.rows.map(row => row.source)).size >= 2;
    return id.startsWith("task1") ? task1 : task2;
  }

  function exportResult(result: AnalysisResult) { download(`${fileName.replace(/\.[^.]+$/, "") || "analysis"}_${result.id}.csv`, toCsv(result.rows)); }
  async function exportAllResults() {
    const completed = Object.values(runs).flatMap(run => run.result ? [run.result] : []);
    if (!completed.length) return;
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    completed.forEach(result => XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(result.rows), result.id.slice(0, 31)));
    const manifest = analysisGroups.map(group => {
      const groupSheet = group.sheets.find(item => item.name === group.sheetName);
      const groupDetection = detectDataset(configuredRows(group), group.selectedColumns);
      return {
        实验组: group.label,
        文件: group.fileName,
        工作表: group.sheetName,
        起始行: group.rowStart,
        结束行: group.rowEnd,
        有效行数: configuredRows(group).length,
        选中列数: group.selectedColumns.length,
        数据结构: groupDetection.schemaLabel,
        色彩格式: groupDetection.formats.join(" + "),
        原始工作表行数: groupSheet?.rows.length || 0,
      };
    });
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(manifest), "analysis_manifest");
    XLSX.writeFile(workbook, `${safeFileName(fileName)}_全部分析结果.xlsx`, { compression: true });
  }
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
        <section className={`analysis-dropzone ${groups.length ? "loaded" : ""}`} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void loadFiles(event.dataTransfer.files); }}>
          <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" multiple onChange={event => { void loadFiles(event.target.files || undefined); event.currentTarget.value = ""; }} />
          <div className="drop-icon">{loadingFile ? "···" : groups.length ? "+" : "↑"}</div>
          <div><span className="eyebrow">批量数据源</span><h2>{groups.length ? `已导入 ${groups.length} 组实验` : "一次上传多组实验数据"}</h2><p>{groups.length ? "可继续追加文件；每组独立保存工作表、行范围与字段列，不会覆盖前面的配置。" : "支持同时选择或拖入多个 CSV / XLS / XLSX；每个文件建立一组独立分析配置。"}</p></div>
          <button className="secondary" onClick={() => inputRef.current?.click()} disabled={loadingFile}>{groups.length ? "继续添加" : "选择多个文件"}</button>
        </section>
        {fileError ? <div className="analysis-alert error"><b>导入失败</b><span>{fileError}</span></div> : null}

        {groups.length ? <section className="analysis-batch-manager panel">
          <div className="panel-head"><div><h3>实验组队列</h3><p>勾选要纳入合并比较的组；同一文件需分析多个工作表时，先“复制”再分别设置。</p></div><div className="batch-head-actions"><span className="analysis-count">{enabledGroups.length} / {groups.length} 组已启用</span><button onClick={clearGroups}>清空全部</button></div></div>
          <div className="analysis-scope-switch" role="group" aria-label="分析范围">
            <button className={analysisScope === "combined" ? "active" : ""} onClick={() => { setAnalysisScope("combined"); setRuns({}); }}><b>合并已启用组</b><span>用于跨模型、跨批次统计比较</span></button>
            <button className={analysisScope === "active" ? "active" : ""} onClick={() => { setAnalysisScope("active"); setRuns({}); }}><b>仅当前设置组</b><span>用于检查或单独分析一组</span></button>
          </div>
          <div className="analysis-group-list">{groups.map(group => {
            const groupSheet = group.sheets.find(item => item.name === group.sheetName);
            const groupRows = configuredRows(group);
            const groupDetection = detectDataset(groupRows, group.selectedColumns);
            return <article key={group.id} className={`${group.id === activeGroup?.id ? "active" : ""} ${group.enabled ? "" : "disabled"}`}>
              <label className="group-enabled" title="纳入合并分析"><input type="checkbox" checked={group.enabled} onChange={event => updateGroup(group.id, current => ({ ...current, enabled: event.target.checked }))} /><span /></label>
              <div className="group-copy"><input aria-label="实验组名称" value={group.label} onChange={event => updateGroup(group.id, current => ({ ...current, label: event.target.value || current.label }))} /><small>{group.fileName} · {group.sheetName}</small></div>
              <div className="group-schema"><b>{groupDetection.schemaLabel}</b><span>{groupRows.length} 行 × {group.selectedColumns.length} 列</span></div>
              <div className="group-actions"><button className={group.id === activeGroup?.id ? "active" : ""} onClick={() => setActiveGroupId(group.id)}>{group.id === activeGroup?.id ? "设置中" : "设置"}</button><button onClick={() => duplicateGroup(group.id)}>复制</button><button className="danger" onClick={() => removeGroup(group.id)}>移除</button></div>
              <i className={groupDetection.schema === "unknown" || !groupSheet ? "warn" : "pass"}>{groupDetection.schema === "unknown" || !groupSheet ? "!" : "✓"}</i>
            </article>;
          })}</div>
          <div className="batch-summary"><span><b>{analysisGroups.length}</b> 个分析组</span><span><b>{selectedRows.length.toLocaleString()}</b> 行进入当前分析</span><span><b>{new Set(analysisGroups.flatMap(group => group.sheets.map(item => item.name))).size}</b> 个已选工作表</span></div>
        </section> : null}

        {sheet && activeGroup ? <>
          <section className="analysis-selection panel">
            <div className="panel-head"><div><h3>配置当前组 · {activeGroup.label}</h3><p>这里的工作表、数据行和字段列只作用于当前实验组。</p></div><span className="analysis-count">{activeRows.length} 行 × {activeGroup.selectedColumns.length} 列</span></div>
            <div className="analysis-range-controls">
              <label>工作表<select value={activeGroup.sheetName} onChange={event => changeSheet(event.target.value)}>{activeGroup.sheets.map(item => <option key={item.name}>{item.name}</option>)}</select></label>
              <label>起始数据行<input type="number" min="1" max={sheet.rows.length} value={activeGroup.rowStart} onChange={event => updateGroup(activeGroup.id, group => ({ ...group, rowStart: Math.min(group.rowEnd, Math.max(1, Number(event.target.value))) }))} /></label>
              <label>结束数据行<input type="number" min={activeGroup.rowStart} max={sheet.rows.length} value={activeGroup.rowEnd} onChange={event => updateGroup(activeGroup.id, group => ({ ...group, rowEnd: Math.min(sheet.rows.length, Math.max(group.rowStart, Number(event.target.value))) }))} /></label>
            </div>
            <div className="analysis-column-head"><div><span className="eyebrow">参与分析的列</span><b>{activeGroup.selectedColumns.length} / {sheet.columns.length}</b></div><div><button onClick={selectAllColumns}>全选</button><button onClick={() => updateGroup(activeGroup.id, group => ({ ...group, selectedColumns: [] }))}>清空</button></div></div>
            <div className="analysis-column-grid">{sheet.columns.map(column => <label key={column} className={activeGroup.selectedColumns.includes(column) ? "selected" : ""}><input type="checkbox" checked={activeGroup.selectedColumns.includes(column)} onChange={() => toggleColumn(column)} /><span>{column}</span></label>)}</div>
          </section>

          <section className="analysis-preview panel">
            <div className="panel-head"><div><h3>当前组预览</h3><p>显示 {activeGroup.label} 所选范围的前 6 行；分析时按上方范围组合。</p></div><button className="primary" disabled={!selectedRows.length || !selectedColumns.length} onClick={() => setTab("tasks")}>分析 {analysisGroups.length} 组数据 <span>→</span></button></div>
            <div className="analysis-table-scroll"><table><thead><tr><th>#</th>{activeGroup.selectedColumns.map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{activeRows.slice(0, 6).map((row, index) => <tr key={index}><td>{activeGroup.rowStart + index}</td>{activeGroup.selectedColumns.map(column => <td key={column}>{typeof row[column] === "object" && row[column] !== null ? JSON.stringify(row[column]) : String(row[column] ?? "")}</td>)}</tr>)}</tbody></table></div>
          </section>
        </> : null}
      </div>

      <aside className="analysis-detection panel">
        <div className="panel-head"><div><span className="eyebrow">范围自动预检</span><h3>{analysisScope === "combined" ? `${analysisGroups.length} 组汇总结构` : "当前组结构"}</h3></div><span className={`detection-score ${detection.schema === "unknown" ? "warn" : "pass"}`}>{Math.round(detection.confidence * 100)}%</span></div>
        <div className="detection-hero"><span>{detection.schema === "mixed" ? "A+B" : detection.schema === "task2-gew" ? "GEW" : detection.schema.startsWith("task1") ? "W→C" : "?"}</span><div><small>数据结构</small><b>{detection.schemaLabel}</b></div></div>
        <div className="format-section"><span className="eyebrow">识别到的色彩格式</span>{detection.formats.length ? <div>{detection.formats.map(format => <b key={format}>{format}</b>)}</div> : <p>任务二使用固定色码，或当前列中未识别到颜色通道。</p>}</div>
        <div className="detection-list">{detection.evidence.map((item, index) => <p key={index}><i>✓</i><span>{item}</span></p>)}{detection.warnings.map((item, index) => <p className="warning" key={index}><i>!</i><span>{item}</span></p>)}</div>
        <div className="detection-foot"><b>解析预估</b><span>{detection.schema === "mixed" ? `任务一 ${colorData.rows.length} 个色彩 · 任务二 ${gewData.rows.length} 行网格` : detection.schema.startsWith("task1") ? `${colorData.rows.length} 个有效色彩 · ${colorData.rejected} 个拒绝值` : detection.schema === "task2-gew" ? `${gewData.rows.length} 行完整网格 · ${gewData.invalidCells} 个无效 JSON` : "等待匹配字段"}</span></div>
      </aside>
    </section> : null}

    {tab === "tasks" ? <section className="analysis-task-workspace">
      <div className="analysis-status-strip batch"><div><span className="eyebrow">当前分析范围</span><b>{analysisScope === "combined" ? `${analysisGroups.length} 组实验合并比较` : activeGroup?.label || "尚未选择实验组"}</b><small>{detection.schemaLabel} · {selectedRows.length} 行 × {selectedColumns.length} 列</small></div><div><strong>{analysisGroups.length}</strong><span>个实验组</span></div><div><strong>{selectedTaskCount}</strong><span>项可运行</span></div><div><strong>{completeCount}</strong><span>项已完成</span></div><div className="analysis-batch-actions"><button className="secondary" onClick={() => setTab("import")}>调整数据范围</button><button className="primary" disabled={!selectedTaskCount || Object.values(runs).some(run => run.status === "running")} onClick={() => void Promise.all(TASKS.filter(task => taskAvailable(task.id)).map(task => runTask(task.id)))}>运行全部可用分析</button><button className="secondary" disabled={!completeCount} onClick={() => void exportAllResults()}>导出全部结果 XLSX ↓</button></div></div>
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

      {dashboardMode === "task1" ? <Task1Dashboard rows={dashboardColors} fileName={fileName} /> : <Task2Dashboard rows={dashboardGew} metric={metric} />}
    </section> : null}
  </>;
}

function ResultPreview({ result }: { result: AnalysisResult }) {
  const columns = Object.keys(result.rows[0] || {}).slice(0, 4);
  return <details className="task-preview"><summary>预览结果 · {result.rows.length} 行</summary><div><table><thead><tr>{columns.map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{result.rows.slice(0, 3).map((row, index) => <tr key={index}>{columns.map(column => <td key={column}>{column.toLowerCase().includes("hex") ? <><i className="tiny-swatch" style={{ background: String(row[column]) }} />{String(row[column])}</> : String(row[column] ?? "")}</td>)}</tr>)}</tbody></table>{result.note ? <p>{result.note}</p> : null}</div></details>;
}

function Task1Dashboard({ rows, fileName }: { rows: ReturnType<typeof parseColorRows>["rows"]; fileName: string }) {
  const average = (key: "s" | "l" | "labL") => rows.length ? rows.reduce((sum, row) => sum + row[key], 0) / rows.length : 0;
  return <>
    <div className="dashboard-kpis"><article><span>有效色彩</span><strong>{rows.length.toLocaleString()}</strong><small>当前筛选范围</small></article><article><span>来源数</span><strong>{new Set(rows.map(row => row.source)).size}</strong><small>模型 / 文化组</small></article><article><span>平均饱和度</span><strong>{(average("s") * 100).toFixed(1)}%</strong><small>HSL S</small></article><article><span>平均明度</span><strong>{average("labL").toFixed(1)}</strong><small>CIE Lab L*</small></article></div>
    <Task1VisualLab rows={rows} fileName={fileName} />
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
