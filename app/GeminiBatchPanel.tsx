"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type BatchModel = {
  id: string; alias: string; model_id: string; max_tokens: number; temperature: number;
  top_p: number; supports_seed: number | boolean;
};
type BatchSettings = Record<string, unknown> & { repetitions: number };
type BatchJob = {
  local_id: string; google_job_name: string | null; model_alias: string; mode: string;
  start_run_index: number; round_count: number; request_count: number; state: string;
  submitted_at: string; updated_at: string; imported_at: string | null;
  valid_count: number; failed_count: number; error_message: string;
};
type BatchQuota = { activeJobs: number; activeTokens: number; jobLimit: number; tokenLimit: number; protocolReady: boolean; pilotValidCount: number; pilotRequestCount: number; pilotState: string };

const EMPTY_QUOTA: BatchQuota = { activeJobs: 0, activeTokens: 0, jobLimit: 100, tokenLimit: 5_000_000, protocolReady: false, pilotValidCount: 0, pilotRequestCount: 4, pilotState: "NOT_STARTED" };
const ACTIVE = new Set(["SUBMITTING", "JOB_STATE_PENDING", "JOB_STATE_RUNNING", "JOB_STATE_CANCELLING"]);

function stateLabel(state: string) {
  return ({ JOB_STATE_PENDING: "排队中", JOB_STATE_RUNNING: "运行中", JOB_STATE_SUCCEEDED: "已完成", JOB_STATE_FAILED: "失败", JOB_STATE_EXPIRED: "已过期", JOB_STATE_CANCELLED: "已取消", JOB_STATE_CANCELLING: "取消中", SUBMITTING: "提交中", SUBMIT_FAILED: "提交失败" } as Record<string, string>)[state] || state;
}

export function GeminiBatchPanel({ model, apiKey, settings }: { model?: BatchModel; apiKey: string; settings: BatchSettings }) {
  const [jobs, setJobs] = useState<BatchJob[]>([]);
  const [quota, setQuota] = useState<BatchQuota>(EMPTY_QUOTA);
  const [rounds, setRounds] = useState(Math.min(10, Math.max(1, settings.repetitions || 1)));
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/gemini-batch", { cache: "no-store" });
    const data = await response.json() as { jobs?: BatchJob[]; quota?: BatchQuota };
    if (response.ok) { setJobs(data.jobs || []); setQuota(data.quota || EMPTY_QUOTA); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function action(payload: Record<string, unknown>, success: string) {
    if (!apiKey) { setNotice("请先在模型配置页填写 Gemini API Key。"); return false; }
    setBusy(true); setNotice("正在连接 Gemini Batch API…");
    try {
      const response = await fetch("/api/gemini-batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, apiKey }) });
      const data = await response.json().catch(() => ({})) as { ok?: boolean; message?: string; imported?: { validCount?: number; failedCount?: number } };
      if (!response.ok || !data.ok) throw new Error(data.message || `HTTP ${response.status}`);
      setNotice(data.imported ? `${success}：有效 ${data.imported.validCount || 0}，异常 ${data.imported.failedCount || 0}` : success);
      await load();
      return true;
    } catch (error) { setNotice(error instanceof Error ? error.message : "Gemini Batch 操作失败。"); return false; }
    finally { setBusy(false); }
  }

  const formalJobs = Math.ceil(settings.repetitions / rounds);
  const pendingImport = useMemo(() => jobs.filter(job => job.state === "JOB_STATE_SUCCEEDED" && !job.imported_at).length, [jobs]);
  async function submitFormalPlan() {
    for (let offset = 0; offset < settings.repetitions; offset += rounds) {
      const count = Math.min(rounds, settings.repetitions - offset);
      const ok = await action({ action: "submit", model, settings, mode: "formal", rounds: count }, `已提交正式 Batch ${Math.floor(offset / rounds) + 1}/${formalJobs}`);
      if (!ok) break;
    }
  }
  async function refreshAll() {
    const targets = jobs.filter(job => job.google_job_name && (ACTIVE.has(job.state) || (job.state === "JOB_STATE_SUCCEEDED" && !job.imported_at)));
    for (const job of targets) await action({ action: "refresh", localId: job.local_id }, `已查询 ${job.local_id}`);
  }

  return <>
    <div className="page-title"><div><span className="page-index">04B</span><h1>Gemini Batch 整组采集</h1><p>这是可选的异步入口；Gemini 也可以在“运行试次队列”中与其他模型实时整组运行。Batch 每轮提交 2 个 item，入库时自动拆成 31 条记录。</p></div><button className="secondary" disabled={busy || !jobs.length} onClick={() => void refreshAll()}>{busy ? "处理中…" : "查询全部并自动入库"}</button></div>
    {notice ? <div className="toast">{notice}<button onClick={() => setNotice("")}>×</button></div> : null}
    <section className="panel batch-summary-simple">
      <div><span className="eyebrow">固定模型</span><h3>Gemini 3.1 Pro · Native Batch API</h3><p>{model?.model_id || "请先配置 gemini-3.1-pro-preview"}</p></div>
      <div><b>{quota.activeJobs} / {quota.jobLimit}</b><small>活跃 Job</small></div>
      <div><b>{(quota.activeTokens / 1_000_000).toFixed(2)}M / 5M</b><small>排队 Token 估算</small></div>
      <div><b>{pendingImport}</b><small>等待查询入库</small></div>
    </section>
    <div className="two-columns">
      <section className="panel">
        <div className="panel-head"><div><h3>提交计划</h3><p>先完成 2 轮预检：4 个整组 item，覆盖 62 项实验回答。</p></div></div>
        <div className="batch-actions-simple">
          <button className="secondary" disabled={busy || !model || !apiKey} onClick={() => void action({ action: "submit", model, settings, mode: "pilot", rounds: 2 }, "预检 Batch 已提交")}>提交 2 轮格式预检</button>
          <p>预检状态：{quota.protocolReady ? "4/4 个整组 item 已通过（62项）" : `${quota.pilotValidCount}/${quota.pilotRequestCount} 个整组 item · ${stateLabel(quota.pilotState)}`}</p>
          <label>每个 Job 的完整轮次<input type="number" min="1" max="10" value={rounds} disabled={busy} onChange={event => setRounds(Math.max(1, Math.min(10, Number(event.target.value) || 1)))} /></label>
          <label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> 已确认使用 Gemini 付费 Batch API</label>
          <button className="primary" disabled={busy || !model || !apiKey || !confirmed || !quota.protocolReady} onClick={() => void submitFormalPlan()}>提交 {formalJobs} 个正式 Job（{settings.repetitions * 2} 个整组 item / {settings.repetitions * 31} 条结果）</button>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><div><h3>数据完整性</h3><p>每轮两个回答都必须完整，缺一题则该整组 item 标记异常。</p></div></div>
        <div className="check-list"><div className="pass"><i>✓</i><p><b>整组强结构约束</b><small>20 个情绪 HEX 与 11×20 强度矩阵均为必填键</small></p></div><div className="pass"><i>✓</i><p><b>自动拆分 31 条</b><small>0 表示未选择；入库时只保留 1–5</small></p></div><div className="pass"><i>✓</i><p><b>来源独立记录</b><small>collection_mode=batch、Job ID 与 grouped-round-v5</small></p></div></div>
      </section>
    </div>
    <section className="panel">
      <div className="panel-head"><div><h3>Batch Job 记录</h3><p>关闭网页后 Google 仍会继续运行；完成后点击查询写回本地数据库。</p></div><span>{jobs.length} JOBS</span></div>
      {jobs.length ? <div className="data-table"><div className="data-head"><span>任务</span><span>轮次</span><span>结果</span><span>状态</span><span>时间</span><span>操作</span></div>{jobs.map(job => <div className="data-row" key={job.local_id}><span className="mono">{job.google_job_name || job.local_id}</span><span>{job.start_run_index}–{job.start_run_index + job.round_count - 1}</span><span>{job.valid_count}/{job.request_count}{job.failed_count ? ` · 异常 ${job.failed_count}` : ""}</span><span>{stateLabel(job.state)}</span><span>{new Date(job.submitted_at).toLocaleString("zh-CN")}</span><span><button className="secondary" disabled={busy || !job.google_job_name} onClick={() => void action({ action: "refresh", localId: job.local_id }, "查询完成")}>查询/入库</button>{ACTIVE.has(job.state) ? <button className="secondary" disabled={busy} onClick={() => void action({ action: "cancel", localId: job.local_id }, "取消请求已发送")}>取消</button> : null}</span></div>)}</div> : <div className="empty-state"><h3>还没有 Gemini Batch Job</h3><p>先提交 2 个完整轮次进行格式预检。</p></div>}
    </section>
  </>;
}
