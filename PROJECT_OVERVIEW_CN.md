# Chromalab 3006 项目概述与平台功能说明

Chromalab 3006 是一个面向情绪—色彩关联研究的双核心科研平台，由**实验模块**和**分析模块**共同构成，两部分在平台中的功能权重各占 50%。实验模块解决“如何规范、稳定地获得研究数据”，分析模块解决“如何科学、系统地解释研究数据”。两者通过统一的数据契约、项目版本和成果协议连接，形成完整研究闭环。

| 核心模块 | 功能占比 | 核心目标 | 功能范围 | 主要成果 |
| --- | ---: | --- | --- | --- |
| 实验模块 | 50% | 获得标准化、完整、可追溯的实验数据 | 项目设置、模型接入、实验设计、队列运行、Batch采集、质量审阅、数据交付 | 实验配置、试次清单、模型响应、失败审计、源数据包 |
| 分析模块 | 50% | 将多来源数据转化为可检验、可解释的科研结果 | 数据接入、质量控制、实验一分析、实验二分析、双向整合、机器学习、可视化归档 | 标准数据、统计结果、距离矩阵、显著性结论、科研图表与报告 |

## 平台双核心功能定位

### A. 实验模块：从研究方案到可信数据

实验模块不是简单的模型调用工具，而是一套标准化实验生产系统。它以项目和材料版本为起点，统一管理模型参数、Prompt协议、随机化策略、重复轮次和逻辑试次；在执行过程中提供多模型并行、实时与Batch采集、速率控制、超时重试、暂停恢复和跨日续跑；在执行结束后通过完整性扫描、技术缺失补齐、原始响应追溯和多格式导出，交付可以直接进入分析环节的可信数据。

实验模块包含七个同级功能域：

1. 项目与实验材料管理；
2. 多模型连接与能力适配；
3. 双向实验设计与随机化控制；
4. 多模型试次编排与实时运行；
5. 原生 Batch 批量采集；
6. 完整性检查、失败恢复与数据审阅；
7. 实验条件、源回答和审计数据交付。

### B. 分析模块：从标准数据到科研结论

分析模块不是实验模块的附属页面，而是一套可独立接收人类数据和AI数据的研究分析系统。它首先完成数据结构识别、字段映射、色彩转换、GEW解析和抽样单位核验；随后分别对 Word→Color 和 Color→Emotion 数据执行描述、距离、效应量和正式推断；再通过双向一致性、潜在空间和机器学习比较不同文化群体与不同模型的整体结构；最终输出可复算的数据表、方法清单、科研图表、交互式报告和完整分析归档。

分析模块同样包含七个同级功能域：

1. 多来源数据接入与结构识别；
2. 数据标准化、质量控制与排除审计；
3. 实验一连续色彩分析；
4. 实验二 GEW 情绪关联分析；
5. 双向一致性与跨来源整合分析；
6. 潜在空间、机器学习与稳定性诊断；
7. 正式推断、科研可视化和成果归档。

### C. 共同底座：多平台协同计算

多平台协同计算是实验模块和分析模块共享的技术底座，而不是独立的第三主体。交互工作台负责实验与分析任务的统一控制；模型服务负责数据采集；状态与审计服务负责研究过程留痕；TypeScript分析引擎负责即时分析；Python计算服务和独立计算节点负责长时间统计任务；标准结果协议负责不同运行环境间的数据回传与复核。

```text
┌────────────────────────── 交互与控制平面 ──────────────────────────┐
│ Browser Workbench                                                  │
│ 项目配置│模型配置│实验编排│运行监控│数据审阅│分析控制│成果导出     │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ HTTPS / REST / JSON
                               ▼
┌────────────────────────── 应用服务平面 ────────────────────────────┐
│ Next/Vite API                                                      │
│ workspace│model-test│pilot-test│trial-manifest│run-group/run-trial │
│ gemini-batch│export-data                                           │
└─────────────┬──────────────────┬──────────────────┬────────────────┘
              │ SQL              │ HTTPS/JSON       │ REST/JSON
              ▼                  ▼                  ▼
┌────────────────────┐ ┌────────────────────┐ ┌──────────────────────┐
│ 状态与审计数据平面 │ │ 外部模型服务平面   │ │ Python 计算服务平面  │
│ SQLite / D1        │ │ OpenAI-compatible  │ │ render / ML          │
│ project / manifest │ │ Gemini Native      │ │ similarity / distance│
│ result / attempt   │ │ Gemini Batch       │ └──────────┬───────────┘
└──────────┬─────────┘ └────────────────────┘            │ JSON/JSON.GZ
           │                                             ▼
           │ REST/JSON                         ┌──────────────────────┐
           ▼                                   │ 独立计算节点         │
┌────────────────────┐                         │ Bootstrap / block    │
│ TypeScript 分析引擎│◄────────────────────────│ permutation / Group-CV│
│ normalize / QC     │       结果包回传        └──────────┬───────────┘
│ descriptive / test│                                    │
└──────────┬─────────┘                                    │
           └────────────────────┬─────────────────────────┘
                                ▼
                   ┌────────────────────────────┐
                   │ 成果与交换平面             │
                   │ CSV/XLSX/JSON.GZ/ZIP       │
                   │ PNG/SVG/HTML               │
                   └────────────────────────────┘
```

## 0. 文档范围

本文定义 Chromalab 3006 的系统结构、实验执行协议、分析方法、接口约束、状态转移、容错机制和验收标准。内容按两个等权部分组织：

- **实验模块（50%）**：项目、模型、实验协议、队列、状态、重试、Batch、审阅与导出；
- **分析模块（50%）**：数据标准化、实验一、实验二、双向分析、机器学习、推断分层与科研图表。

默认实验材料为 20 个 GEW 情绪词与 11 个标准色码。一个完整模型轮次包含 20 个 Word→Color 逻辑试次和 11 个 Color→Emotion 逻辑试次。

## 1. 核心功能对照

| 模块 | 职责 | 算法/机制 | 交付协议 |
| --- | --- | --- | --- |
| 实验·项目状态 | 保存协议版本、材料版本和运行状态 | 有限状态机；项目级主键 | REST/JSON；SQLite/D1 |
| 实验·模型适配 | 统一异构模型接口 | Adapter；能力探测；结构化输出 | HTTPS/JSON |
| 实验·试次编排 | 生成模型×轮次×刺激项清单 | 确定性逻辑试次 ID；顺序随机化 | REST/JSON |
| 实验·实时运行 | 单试次或完整任务组调用 | 限流、超时、退避、响应校验 | REST/JSON |
| 实验·Batch | 提交、轮询、回收批任务 | Job/Item 状态机；唯一请求键 | Gemini Native Batch JSON |
| 实验·补齐与审计 | 定位技术缺失并执行一次补齐 | Manifest anti-join；条件领取；尝试日志 | REST/JSON；SQL |
| 实验·数据交付 | 导出源结果、条件与清单 | 完整轮次过滤；抢救导出 | CSV/XLSX/JSON/ZIP |
| 分析·数据接入 | 识别宽表、长表和 GEW JSON | Schema detection；字段映射；QC | CSV/XLS/XLSX/JSON |
| 分析·实验一 | 比较连续色彩分布 | Lab/HSV、MICD、Assignment、Energy、EMD | CSV/JSON.GZ/PNG/SVG |
| 分析·实验二 | 比较颜色—情绪关联 | 选择率、强度、χ²、OR、JSD、熵 | CSV/XLSX/PNG/SVG |
| 分析·双向整合 | 比较两个实验方向 | ΔE00 映射、Top-k、ρ、JSD、P−Q | CSV/HTML/PNG |
| 分析·表征学习 | 来源解码与跨域泛化 | Group-CV、nested CV、AUC/F1 | REST/JSON；CSV |
| 分析·诊断 | 检查稳定性与指标一致性 | Bootstrap、split-half、Monte Carlo SD | JSON.GZ/CSV |
| 分析·正式推断 | 控制抽样单位与多重比较 | block/exact permutation、Holm/BH | CSV/XLSX/方法清单 |

# 第一部分：实验模块（平台功能 50%）

## 2. 实验协议

### 2.1 任务定义

设情绪集合为 \(E=\{e_1,\ldots,e_{20}\}\)，颜色集合为 \(C=\{c_1,\ldots,c_{11}\}\)，模型集合为 \(M\)，轮次为 \(r=1,\ldots,R\)。

**任务一：Word→Color**

\[
f_{m,r}:E\rightarrow\mathcal C_{sRGB},\qquad f_{m,r}(e_i)=HEX_{m,r,i}
\]

其中 \(\mathcal C_{sRGB}\) 为连续 sRGB 颜色空间。正式响应必须解析为合法颜色值。

**任务二：Color→Emotion**

\[
g_{m,r}(c_j)=\{(e_i,y_{mrij},s_{mrij})\}_{i=1}^{20}
\]

其中 \(y\in\{0,1\}\) 表示是否选择，\(s\in\{1,2,3,4,5\}\) 表示条件强度；未选择项在分析网格中记为 \(s=0\)。

### 2.2 锁定条件

| 条件 | 规格 |
| --- | --- |
| 实验语言 | English |
| 输入通道 | 纯文本；颜色以匿名色码及 HEX 表示 |
| 上下文 | 试次相互独立；不保留对话历史 |
| 文化角色 | 不设置 |
| 情绪材料 | GEW-20 版本化清单 |
| 颜色材料 | 11 色版本化清单 |
| 原始响应 | 保存；导出时排除 API Key |
| 完整轮次 | 20 个任务一刺激 + 11 个任务二刺激 |

### 2.3 随机性策略

试次种子由基础种子、轮次和刺激索引确定：

\[
s_{r,i}=|s_0+1009r+9176i|\bmod(2^{31}-1)
\]

使用确定性伪随机序列执行 Fisher–Yates 排列。可独立启用 Prompt Seed 标签、模型原生 Seed、三个语义等价 JSON 指令轮换、情绪顺序随机化、颜色顺序随机化及任务二内部选项随机化。所有开关、基础种子和模型能力声明写入实验条件表。接口不支持 Seed 时记录“不支持”，不得声明确定性。

## 3. 实验控制状态机

### 3.1 项目状态

```text
Draft ──配置完整──> Ready ──启动──> Running ──暂停──> Paused
  │                     │              │  ▲               │
  │                     │              │  └────恢复───────┘
  │                     │              ├──清单执行结束────> Completed
  │                     │              └──不可恢复错误────> Failed
  └────────────────────────────归档────────────────────────> Archived
```

状态写入通过工作区 API；界面状态不是事实来源。`Completed` 只表示当前清单执行结束，轮次是否完整仍由 20/11 计数判定。

### 3.2 逻辑试次状态

```text
MANIFESTED ──入队──> QUEUED ──调度──> REQUESTING ──HTTP 2xx──> VALIDATING
                                         │                       │
                                         │                       ├─Schema通过──> VALID
                                         │                       └─解析失败────> RETRYABLE_FAILURE
                                         ├─408/429/5xx/网络异常──────────────> RETRYABLE_FAILURE
                                         ├─不可重试4xx/安全阻断──────────────> TERMINAL_FAILURE
                                         └─超过尝试上限─────────────────────> EXHAUSTED

RETRYABLE_FAILURE ──attempt < max_retry──> QUEUED
RETRYABLE_FAILURE ──一次性领取──> REPAIR_CLAIMED ──执行──> VALID | EXHAUSTED
```

数据库实际尝试状态为 `success`、`api_error`、`empty_response`、`validation_error` 和 `request_error`。上图为控制层抽象；`retryable`、`attempt_no`、`repair_attempted_at` 和有效结果是否存在共同决定下一状态。

## 4. 标识、持久化与幂等性

### 4.1 主标识

\[
K_{trial}=\texttt{batch-}\|modelId\|task\|runIndex\|stimulusId
\]

\[
K_{attempt}=K_{trial}\|\texttt{-attempt-}\|attemptNo
\]

Batch 项由 `(local_job_id, request_key)` 唯一约束。Pilot 使用独立前缀，不进入正式轮次完整性统计。

### 4.2 幂等规则

| 写入对象 | 数据库约束 | 重复提交行为 |
| --- | --- | --- |
| `trial_manifest` | `logical_trial_id` 主键 | `INSERT OR IGNORE`；同一逻辑试次不重复注册 |
| `trial_attempts` | `attempt_id` 主键 | 同一试次同一尝试号覆盖同键记录 |
| `trial_results` | `trial_id` 主键 | 实时路径同键替换；修复路径优先忽略已有有效结果 |
| Batch item | Job+request 唯一键 | 同一任务内不重复创建请求项 |
| Repair claim | 条件更新 | 仅未领取且不存在有效结果时领取 |

幂等边界是“逻辑身份唯一”，不是“所有响应不可变”。实时路径使用同键替换，调用方必须先查询有效结果并避免重复派发。若要求不可变事件日志，需要增加 append-only result revision 表。

### 4.3 数据实体

| 实体 | 主键 | 关键字段 |
| --- | --- | --- |
| Project | `project_id` | 协议版本、材料版本、状态、时间戳 |
| ModelConfig | `id` | provider、model_id、endpoint、采样参数、能力声明 |
| ExperimentSettings | `project_id` | repetitions、任务开关、重试、超时、随机性策略 |
| TrialManifest | `logical_trial_id` | 模型/设置快照、轮次、刺激、补齐状态 |
| TrialResult | `trial_id` | clean_json、raw_response、validation_status、protocol_version |
| TrialAttempt | `attempt_id` | attempt_no、HTTP 状态、retryable、错误、延迟 |
| BatchJob/Item | 本地任务/项目键 | 远端任务名、request_key、状态、结果或错误 |

## 5. 通信协议与序列化

### 5.1 在线控制面

当前实现使用 HTTP(S) REST，不使用 gRPC。

| 链路 | 协议 | 序列化 | 语义 |
| --- | --- | --- | --- |
| Browser→Application API | REST/HTTP | JSON UTF-8 | 配置、控制、查询、导出请求 |
| Application→模型服务 | HTTPS REST | Provider JSON | 模型推理与 Batch 管理 |
| Application→Python 服务 | REST/HTTP | JSON | 绘图、ML、双向和距离任务 |
| Application→数据库 | SQL | 行记录/JSON Text | 状态、结果与审计持久化 |

gRPC 当前未实现，不属于兼容性合同。若后续用于远程计算节点，必须新增 `.proto` 版本、deadline、重试语义和 request-id，不得将现有 REST JSON 结构隐式映射为 gRPC。

### 5.2 批量交换面

| 格式 | 用途 | 约束 |
| --- | --- | --- |
| JSON | 配置、API 请求、轻量结果 | UTF-8；包含 schema/protocol version |
| JSON.GZ | 完整长任务结果 | Gzip；携带参数、来源和版本元数据 |
| CSV | 长表、统计表、审计表 | UTF-8；列名稳定；缺失值显式表示 |
| XLSX | 多表研究交付 | 记录条件、清单、源数据与结果 |
| ZIP | 完整归档 | 包含 README、方法清单、输入摘要和结果 |
| PNG/SVG/HTML | 静态图、矢量图和交互报告 | 记录数据来源与绘图参数 |

跨平台回传以 `analysis_type + schema_version + parameters + source_manifest` 标识结果。当前导入依赖结构和类型校验；尚未实现统一密码学签名。

## 6. 调度、限流与容错

每个模型维护独立队列、速率和进度。最多四个模型组并行；完整组请求必须属于同一任务和同一轮次，长度固定为 20 或 11。

| 类别 | 例项 | retryable | 处理 |
| --- | --- | --- | --- |
| 传输错误 | DNS、连接失败、timeout | 是 | 退避后重试 |
| 限流/服务错误 | 408、429、5xx | 是 | 读取 Retry-After；模型独立冷却 |
| 响应为空 | 无 content、异常 finish reason | 条件判断 | 保存响应摘要；必要时重试 |
| 校验错误 | 非法 JSON、缺项、非法颜色/强度 | 是 | 保存 raw response；重试 |
| 权限/参数错误 | 401、403、不可重试 4xx | 否 | 终止模型组并修正配置 |
| 安全阻断 | Provider block | 通常否 | 记录原因；禁止无条件循环请求 |

缺失集合：

\[
\mathcal M=\{t\in Manifest:\nexists r\in Result,\ r.trialId=t.id\land r.status=Valid\}
\]

可补齐集合：

\[
\mathcal R=\{t\in\mathcal M:repairAt=\varnothing,\ nextAttempt\le maxRetry,
(nextAttempt=0\lor lastRetryable=1)\}
\]

领取通过带前置条件的 SQL `UPDATE` 完成；受影响行数为实际领取数。补齐沿用 Manifest 中保存的模型和设置快照，不读取当前界面配置。

### 6.1 REST API 合同

| Endpoint | Method | 请求主体/查询 | 成功响应 | 幂等与副作用 |
| --- | --- | --- | --- | --- |
| `/api/workspace` | GET | 无 | 项目、模型、设置、结果摘要 | 只读 |
| `/api/workspace` | POST | `{action,data}` | 保存状态及操作结果 | 按实体主键更新 |
| `/api/model-test` | POST | model、apiKey、可选 preflight | 连接、延迟、格式检查 | 可能产生供应商调用；不写正式结果 |
| `/api/pilot-test` | POST | model、apiKey、task | Pilot 结果 | 使用 `pilot-` ID；不计正式轮次 |
| `/api/trial-manifest` | POST | register/list/claim | 注册数、缺失集或领取数 | register 忽略重复；claim 条件更新 |
| `/api/run-group` | POST | 同任务同轮次完整 trials | 清洗后结果数组 | 结果按逻辑试次键写入 |
| `/api/run-trial` | POST | 单个 trial | 单条清洗结果 | 用于逐项执行或补齐 |
| `/api/gemini-batch` | GET/POST | create/status/recover/cancel | Job、Item 和恢复摘要 | Job/Item 唯一键控制重复 |
| `/api/export-data` | GET | 模型、轮次、完整性过滤 | 结果、尝试、Manifest、条件 | 只读 |

所有写接口以 HTTP 状态码区分协议错误、供应商错误和平台错误。调用方不得只依据响应正文中的 `ok` 字段判定可重试性；应同时读取 HTTP 状态、`retryable` 和 `retryAfter`。

### 6.2 Batch 状态机

```text
LOCAL_CREATED ──submit──> JOB_STATE_PENDING ──provider schedule──> JOB_STATE_RUNNING
      │                          │                                  │
      └─提交失败──> SUBMIT_FAILED│                                  ├─全部完成──> JOB_STATE_SUCCEEDED
                                 │                                  ├─部分异常──> PARTIAL/RECOVERABLE
                                 │                                  └─远端失败──> JOB_STATE_FAILED
                                 │
                                 └─cancel──> JOB_STATE_CANCELLING ──> JOB_STATE_CANCELLED

PARTIAL/RECOVERABLE ──扫描 item──> 缺失/INVALID/ERROR 集合
                       └─受控 recovery job──> VALID | FINAL_ERROR
```

Batch Job 保存远端任务名、提交时间、更新时间、完成时间、有效数和失败数。Batch Item 保存位置、请求键、任务类型、轮次、刺激项、状态和清洗结果。回收流程先解析远端结果，再以 Item 为单位更新状态，最后聚合 Job 计数。修复任务不得覆盖已存在的有效正式结果。

### 6.3 超时、速率与预算

模型有效速率为配置速率与模型策略上限的较小值：

\[
RPM_{effective}(m)=\min(RPM_{configured}(m),RPM_{policy}(m))
\]

请求超时满足平台下限与模型策略：

\[
T_{effective}(m)=\max(180,T_{configured}(m),T_{policy}(m))
\]

具有每日配额的模型按完整轮次核算预算。若单轮请求成本为 \(q=31\)，每日保留技术请求 \(q_{reserve}\)，供应商日限额为 \(Q\)，则当日可启动完整轮次上限为：

\[
R_{day}=\left\lfloor\frac{Q-q_{reserve}}{q}\right\rfloor
\]

跨日续跑从新的 `run_index` 开始，不重用已完成轮次。预算保护是客户端调度约束，不代表供应商配额承诺；实际限额以供应商返回为准。

## 7. 实验审阅与交付

审阅单位为“模型×run_index”。完整性判定：

\[
Complete(m,r)=\mathbb{1}(N_{word}=20\land N_{color}=11)
\]

正式导出默认只纳入完整轮次。抢救导出允许保留部分有效值，但必须同时交付缺失刺激项、失败尝试和 `invalid_records`，且不得与完整轮次混合标记。

API Key 仅存在于当前浏览器会话和单次请求体，不写入数据库或导出文件。系统不提供集中式密钥托管；生产部署应由外部 Secret Manager 或运行环境注入凭证。

# 第二部分：分析模块（平台功能 50%）

## 8. 分析拓扑与数据契约

```text
CSV/XLS/XLSX
    │
    ▼
Schema Detection ──unknown──> 人工字段确认
    │ task1-wide / task1-long / task2-GEW
    ▼
Column Selection + Row Range + Exclusion Audit
    │
    ├──> Task 1 Canonical Color Rows ──> JS快速分析 ──> Python正式/诊断计算
    │
    └──> Task 2 Complete GEW Grid ─────> JS统计分析 ──> ML/绘图服务
                                              │
                                              ▼
                              Result Tables + Method Manifest
                                              │
                                              ▼
                               CSV/XLSX/JSON.GZ/PNG/SVG/HTML/ZIP
```

分析输入必须保留 `source`、`cohort` 和独立抽样单位。Human 优先使用 participant ID；AI 优先使用 run ID。缺少单位标识时可以执行描述性分析，但不得生成依赖 participant/run 重抽样的正式区间或检验。

## 9. 分析层级定义

| 层级 | 目的 | 允许的方法 | 结论边界 |
| --- | --- | --- | --- |
| 探索性描述 | 描述分布形状、方向和候选差异 | 均值、分位数、熵、聚类、JSD、PCA、热图 | 不声明总体显著性 |
| 诊断性分析 | 检查算法稳定性、偏差和指标一致性 | Bootstrap 稳定性、split-half、Monte Carlo SD、敏感性分析 | 不替代预定义正式检验 |
| 正式推断 | 对预定义对比给出 p/q/CI | block/exact permutation、Holm、BH-FDR | 报告抽样单位、迭代数、校正族和随机种子 |

浏览器中的 199 次 PCA 标签置换属于近似诊断。聚类、代表色和最近来源排名属于探索性描述。旧版 Bootstrap p 值和 Energy76-V 标记为 legacy，不作为正式推断。

## 10. 数据标准化

### 10.1 实验一标准行

输入支持 HEX、RGB、HSL、HSV 或 Lab，统一生成：

\[
x=(R,G,B,H_{HSL},S_{HSL},L_{HSL},H_{HSV},S_{HSV},V_{HSV},L^*,a^*,b^*)
\]

转换基准为 sRGB/D65。CIE76 距离：

\[
\Delta E_{76}(x,y)=\sqrt{(L_x^*-L_y^*)^2+(a_x^*-a_y^*)^2+(b_x^*-b_y^*)^2}
\]

CIEDE2000 使用标准 \(\Delta E_{00}\) 定义，用于感知加权距离和标准色映射。无彩色样本不参与 Hue 分布统计，但保留在 Lab 分析中。

### 10.2 实验二完整网格

每个 `participant/run × color` 展开为 20 行：

\[
(source,unit,color,emotion,y,s,valid)
\]

未选择项为 \((y,s)=(0,0)\)，已选择项为 \(y=1,s\in[1,5]\)。`None`、`Other` 和无效 JSON 保留在 QC，不进入 20 个核心情绪主检验。

## 11. 实验一分析规格

### 11.1 探索性描述

\[
H=-\sum_{k=1}^{K}p_k\log_2p_k,\qquad H_{norm}=H/\log_2K,\qquad N_{eff}=2^H
\]

平台使用 36×10° 分箱作为连续 Hue 熵主描述，并使用 12 箱进行来源分布补充比较。其他输出包括 Lab 连续散点、圆周均值/方差、凸包面积、代表色、组内平均两两 \(\Delta E_{76}\) 和 K=2–5 聚类。聚类 K 由轮廓系数选择，仅作解释。

### 11.2 支持集与分布距离

\[
d_{MICD}(A\rightarrow B)=\frac1{|A|}\sum_{a\in A}\min_{b\in B}\Delta E_{00}(a,b)
\]

\[
d_{MICD}^{sym}(A,B)=\frac{d(A\rightarrow B)+d(B\rightarrow A)}2
\]

Assignment00 在共同样本量 \(m\) 下求一一匹配：

\[
d_{Assign}(A_m,B_m)=\frac1m\min_{\pi\in S_m}\sum_{i=1}^{m}\Delta E_{00}(a_i,b_{\pi(i)})
\]

两边共享同一次参考子样本；重复抽样用于估计 Monte Carlo 收敛，不作为显著性检验。

无偏 Energy76-U：

\[
\mathcal E_U(A,B)=\frac2{mn}\sum_{i,j}d(a_i,b_j)
-\frac1{m(m-1)}\sum_{i\ne i'}d(a_i,a_{i'})
-\frac1{n(n-1)}\sum_{j\ne j'}d(b_j,b_{j'})
\]

其中 \(d=\Delta E_{76}\)。EMD：

\[
EMD(P,Q)=\min_{\gamma\in\Pi(P,Q)}\sum_{i,j}\gamma_{ij}d_{ij}
\]

主分箱为 \(8^3\)，\(6^3\) 与 \(10^3\) 用于敏感性分析。Jensen–Shannon 距离：

\[
JSD_d(P,Q)=\sqrt{\tfrac12KL(P\|M)+\tfrac12KL(Q\|M)},\quad M=(P+Q)/2
\]

### 11.3 正式推断

固定 AI 来源和正式指标，对 Human 组执行 participant/run block permutation：

\[
\Delta_{obs}=d(AI,H_a)-d(AI,H_b)
\]

\[
p=\frac{1+\sum_{b=1}^{B}\mathbb{1}(|\Delta_b|\ge|\Delta_{obs}|)}{B+1}
\]

每个“固定 AI × 正式指标”形成一个包含 6 个 Human 两两比较的 Holm 校正族。正式指标为 MICD00、Assignment00 和 Energy76-U。固定 Human 下的 AI 间比较只作描述，不输出正式 p 值。

来源级 Human/AI 对比先聚合到来源单位，再对 4×4 标签分配执行 \(\binom84=70\) 种精确置换，并对 20 个情绪执行 BH-FDR。

### 11.4 诊断层

- participant/run Bootstrap：观察排名、偏差与最近来源稳定性；
- split-half：避免同一分布与自身匹配产生零距离；
- Assignment common-m：报告 R20/R50/R100 与 Monte Carlo SD；
- 指标一致性：对 emotion×group-pair 距离计算 Spearman \(\rho\)；
- CIE76/CIEDE2000、EMD 分箱和 Energy V/U：敏感性报告；
- Group-CV AUC：同一 participant/run 不跨训练与测试 fold。

## 12. 实验二分析规格

### 12.1 描述统计

对来源 \(g\)、颜色 \(c\)、情绪 \(e\)：

\[
\hat p_{gce}=\frac{\sum_u y_{ugce}}{n_{gc}}
\]

\[
\bar s^{all}_{gce}=\frac{\sum_u s_{ugce}}{n_{gc}},\qquad
\bar s^{cond}_{gce}=\frac{\sum_u y_{ugce}s_{ugce}}{\sum_u y_{ugce}}
\]

\[
Broadness_{ugc}=\sum_e y_{ugce},\qquad
ValenceBias_{ugc}=\frac{N_{positive}-N_{negative}}{N_{positive}+N_{negative}}
\]

综合指标区间以 participant/run×color 为重抽样单位执行固定种子百分位 Bootstrap；除非预先指定为主分析，否则属于估计与诊断。

### 12.2 总体与两两检验

对每个 color×emotion 构造 `source × {selected,not selected}` 列联表：

\[
\chi^2=\sum_{i,j}\frac{(O_{ij}-E_{ij})^2}{E_{ij}},\qquad
V=\sqrt{\frac{\chi^2}{N\min(r-1,c-1)}}
\]

当前二元结果中 \(c=2\)，实现等价使用 \(V=\sqrt{\chi^2/N}\)。最小期望频数低于 5 时输出“卡方近似不可靠”。

两来源比较加入 0.5 修正：

\[
OR=\frac{(a+.5)(d+.5)}{(b+.5)(c+.5)}
\]

\[
CI_{95\%}=\exp\left[\log(OR)\pm1.96\sqrt{\frac1{a+.5}+\frac1{b+.5}+\frac1{c+.5}+\frac1{d+.5}}\right]
\]

Benjamini–Hochberg：若 \(p_{(1)}\le\cdots\le p_{(m)}\)，则

\[
q_{(i)}=\min_{j\ge i}\left(1,\frac mjp_{(j)}\right)
\]

当前检验把输入行视为独立观测。若同一参与者重复回答 11 个颜色，确认性论文应增加参与者随机截距 GLMM 或等价重复测量模型；当前单元格 χ² 不替代该模型。

### 12.3 分布结构

对 20 维选择率向量计算 Jensen–Shannon 距离。情绪集中度：

\[
H_g(c)=-\sum_{e=1}^{20}q_e\log_2q_e,\qquad q_e=\hat p_e/\sum_j\hat p_j
\]

将 11×20 选择率矩阵展平为 220 维向量并计算 Pearson：

\[
r_{AB}=\frac{\sum_k(x_{Ak}-\bar x_A)(x_{Bk}-\bar x_B)}
{\sqrt{\sum_k(x_{Ak}-\bar x_A)^2\sum_k(x_{Bk}-\bar x_B)^2}}
\]

区间在两个来源内分别按 participant/run 重抽 500 次。该指标描述整体结构，不替代具体 color×emotion 单元检验。来源级 Human/AI 检验分别对选择率、条件强度和零值纳入强度执行 4×4 精确标签置换，并进行 BH-FDR。

## 13. 双向、潜在空间与机器学习

### 13.1 双向一致性

\[
\hat c(x)=\arg\min_{c_j\in C}\Delta E_{00}(x,c_j)
\]

由任务一得到 \(P(c\mid e)\)，由任务二得到 \(Q(e\mid c)\)。归一化到同一方向后计算 Top-1/Top-3、Spearman \(\rho\)、JSD、方向差
\(A_{ec}=P(c\mid e)-\tilde Q(c\mid e)\) 和互惠强度 \(R_{ec}=\min(P,\tilde Q)\)。八个来源产生 \(\binom82=28\) 个来源对。该模块默认属于探索性结构分析。

### 13.2 潜在空间

每个 source×emotion 单元构造 12 个 Hue 箱、6 个 Saturation 箱、6 个 Value 箱、Lab 均值及平均 S/V。标准化后使用共享 PCA 二维投影。输出中心距离、RBF-MMD、最近中心分类、情绪距离矩阵 Spearman 和 199 次确定性标签置换。该实现是低维基线，不得解释为认知机制；其置换结果属于诊断性近似。

### 13.3 机器学习

机器学习服务以 participant/run 为 Group-CV 单位，避免同一单位跨训练与测试折。

\[
Accuracy=\frac{\sum_i\mathbb{1}(\hat y_i=y_i)}N,\qquad
MacroF1=\frac1K\sum_{k=1}^{K}\frac{2P_kR_k}{P_k+R_k}
\]

同时输出 Macro-AUC、混淆矩阵、颜色召回率、来源间交叉泛化和 Human→AI/AI→Human 迁移矩阵。超参数选择使用内层交叉验证，性能评估使用外层 Group-CV。独立单位不足时必须降低折数或拒绝运行，不得按行随机拆分替代。

## 14. 分析执行与成果协议

### 14.1 计算状态机

```text
IDLE ──submit(parameters,input_manifest)──> QUEUED ──worker claim──> RUNNING
RUNNING ──progress(stage,completed,total)─────────────────────────> RUNNING
RUNNING ──cancel request──────────────────────────────────────────> CANCELLING
RUNNING ──result+metadata持久化───────────────────────────────────> COMPLETED
RUNNING ──exception+error持久化───────────────────────────────────> FAILED
CANCELLING ──安全检查点──────────────────────────────────────────> CANCELLED
```

长任务结果包含分析类型、源数据摘要、来源列表、独立单位字段、参数、随机种子、迭代数、软件版本、完成状态和结果表。导入端先检查分析类型与结构版本，再进入展示层。

### 14.2 成果协议

科研图由 Python 渲染服务通过 REST 接收 JSON 数据和绘图参数，返回 PNG 或 SVG Blob。交互 HTML 由前端生成。完整归档至少包含原始选中数据、字段与清洗审计、Task 1 标准长表、Task 2 GEW 完整网格、结果 CSV、`all-results.xlsx`、`method-manifest.csv`、README、分析配置和图表来源选择。

## 15. 系统边界与约束

1. 当前控制面使用 REST/HTTP；未实现 gRPC、消息队列或分布式事务。
2. 跨节点协作是任务级结果交换，不是共享内存或 MPI 式并行计算。
3. SQLite/D1 适用于当前项目级负载；高并发多租户部署需要独立数据库、事务隔离和租户键。
4. 实时结果同键写入使用替换语义；系统保证逻辑试次唯一，但不提供不可变结果版本链。
5. API Key 不持久化；系统不承担组织级 Secret 管理。
6. 模型供应商可能修改模型版本、限额、参数和输出行为；正式运行必须保存协议版本与模型标识。
7. 浏览器基础分析与 Python 正式计算不属于同一数值后端；发布前必须核对参数和结果版本。
8. 缺少 participant/run ID 时，不允许执行以该单位为基础的 Bootstrap、Group-CV 或 block permutation。
9. 单元格 χ² 假设观测独立；重复测量数据的确认性结论需要 GLMM/GEE 或预定义层级模型。
10. 聚类、代表色、PCA、最近来源和多数相似性排名属于探索性输出。
11. Bootstrap 默认用于区间与稳定性诊断；不能自动解释为随机化检验。
12. 正式推断必须固定指标、比较族、迭代数、随机种子、排除规则和显著性阈值。
13. JSON.GZ 结果目前依赖结构验证，未提供数字签名和端到端内容寻址。
14. 系统不管理人类被试同意流程；导入人类数据前须完成伦理与隐私处理。

## 16. 实施验收 Checklist

### 16.1 实验模块

- [ ] 项目、材料和实验协议具有明确版本号。
- [ ] 每个模型通过连接测试、Word→Color Pilot 和 Color→Emotion Pilot。
- [ ] 临时 API Key 未写入数据库、日志导出或归档包。
- [ ] 每个正式轮次生成 20+11 个确定性逻辑试次 ID。
- [ ] 重复注册 Manifest 不增加重复逻辑试次。
- [ ] 408、429、5xx、网络错误和不可重试 4xx 的状态转移符合规格。
- [ ] 每次失败产生 attempt_no、HTTP 状态、retryable 和错误信息。
- [ ] 暂停、恢复、跨日续跑不改变既有 run_index 和试次身份。
- [ ] 缺失扫描只返回不存在 Valid 结果的 Manifest 项。
- [ ] Repair claim 在并发调用下最多领取一次。
- [ ] 补齐使用 Manifest 中保存的模型与设置快照。
- [ ] 完整轮次严格满足 Word=20 且 Color=11。
- [ ] 抢救导出显式包含缺失项和 invalid_records。
- [ ] CSV、XLSX、JSON 和 ZIP 导出能够重新读取。

### 16.2 分析模块

- [ ] 输入被正确识别为 Task1-wide、Task1-long 或 Task2-GEW。
- [ ] 来源、cohort、participant/run 和排除行进入清洗审计。
- [ ] 色彩转换使用 sRGB D65 并通过基准样例测试。
- [ ] 无彩色样本不进入 Hue 统计，但保留在 Lab 统计。
- [ ] GEW 每个独立单位×颜色展开为 20 个核心情绪单元。
- [ ] 探索性、诊断性和正式推断结果分层标识。
- [ ] MICD00、Assignment00、Energy76-U 的参数和角色与方法清单一致。
- [ ] block permutation 保持 participant/run 内全部记录成块移动。
- [ ] Holm 校正族固定为预定义“AI×指标”下的 6 个 Human 对比。
- [ ] Task 2 χ² 输出最小期望频数和近似可靠性标记。
- [ ] BH-FDR 的检验族、m 和 q 值可从导出表复算。
- [ ] Bootstrap、置换和 Group-CV 均以 participant/run 为独立单位。
- [ ] 离线 JSON.GZ 的分析类型、schema version 和参数通过导入校验。
- [ ] PNG/SVG 与其筛选来源、指标和方法参数一致。
- [ ] 完整归档包含原始数据、清洗审计、结果表、方法清单和配置。
- [ ] 固定输入与随机种子在目标平台上得到允许浮点误差内的一致结果。

## 17. 项目总结

Chromalab 3006 的完整价值来自实验模块与分析模块的对等协作。

实验模块负责建立研究条件、连接不同模型、组织双向试次、控制执行过程并保障数据质量，其最终目标是交付结构完整、条件明确、过程可追溯的研究数据。分析模块负责接收人类与AI多来源数据，完成标准化、质量控制、描述分析、正式推断、结构整合和成果表达，其最终目标是交付可复算、可解释、可用于科研发表的研究结论。

两大模块之间不是简单的前后端关系，而是两个可以独立运行、又能通过统一协议协同工作的业务系统：实验模块可以为其他统计环境提供标准数据，分析模块也可以独立导入外部实验数据。多平台计算、统一数据契约、版本管理和成果归档贯穿两端，使平台形成“实验生产数据、分析形成证据、证据反向验证实验设计”的持续研究闭环。
