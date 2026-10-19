# Chromalab 3006 · R9000P Windows 运行包

此包包含：

- Chromalab 3006 连续色彩分布距离版网页平台；
- Windows 本地安装与启动脚本；
- 不依赖浏览器的 Experiment 1 离线正式分析脚本；
- 连续色彩距离1000次运行入口；
- 多层相似性观察结果及1000次推断入口。

包内不包含 API Key、浏览器会话、Mac缓存、`node_modules` 或个人原始数据。

## 1. 安装前准备

在R9000P上安装：

1. 64位 Python 3.11，并勾选 `Add Python to PATH`；
2. Node.js 22 LTS或更新版本；
3. 保证系统盘至少保留10GB空间；
4. 建议内存32GB，16GB也能运行但不要同时启动多个正式任务。

安装程序下载地址：

- Python：https://www.python.org/downloads/windows/
- Node.js：https://nodejs.org/

## 2. 第一次安装

1. 将整个ZIP解压到纯英文短路径，例如：

   `D:\Chromalab3006`

2. 双击 `1_install_windows.bat`。
3. 等待Python和网页依赖安装完成。
4. 双击 `3_check_environment.bat`，确认所有依赖均显示版本号。

第一次安装需要联网，通常需要5–20分钟。

## 3. 打开网页平台

双击：

`2_start_platform.bat`

终端窗口必须保持打开。浏览器会自动打开：

`http://localhost:3006/`

关闭该终端会停止网页和本地分析服务。

## 4. 离线正式分析的数据准备

将当前八组实验一原始工作簿复制到 `input_data` 文件夹，并改为以下文件名：

- `cn.xlsx`
- `bw.xlsx`
- `uk.xlsx`
- `us.xlsx`
- `deepseek.xlsx`
- `doubao.xlsx`
- `gpt.xlsx`
- `gemini.xlsx`

脚本适配当前项目使用的 `color_data.<emotion>.*` 列结构：

- Human优先读取H/S/L源数据；
- AI优先读取HEX源数据；
- participant/run ID按工作簿行号生成；
- 每个单位的20个情绪保持为同一组。

运行前会输出8组有效颜色数。正常情况下，每组100个完整单位应有约2000个颜色点。

## 5. 推荐运行顺序

### 第一步：观察结果

先双击：

`5_run_similarity_observed_only.bat`

它生成Coverage、EMD/JSD和观察AUC，但不做Bootstrap或置换，用于确认数据结构正确。

### 第二步：连续色彩正式分析

新版建议先双击 `4a_run_continuous_pairwise_check_20.bat`，用10次诊断Bootstrap、20次Assignment common-m重抽和200次block permutation确认流程；该结果仅用于检查，不用于正式论文推断。

双击：

`4_run_continuous_1000.bat`

参数为：

- participant/run Bootstrap：1000（仅稳定性与偏差诊断）；
- Assignment common-m内部重抽：100；
- Human组participant/run block permutation：2000（正式p值）；
- Holm校正按“固定AI × 正式指标”的6个Human对比单独执行。

### 第三步：多层相似性正式推断

双击：

`6_run_similarity_1000.bat`

参数为：

- Group-CV folds：5；
- participant/run Bootstrap：1000；
- group-level permutation：1000。

该任务非常重，可能运行很多小时。不要与连续色彩任务同时运行。

## 6. 结果位置

每次离线运行都会建立独立目录：

`offline_results\YYYYMMDD_HHMMSS\`

其中包含：

- `input_summary.json`：输入文件、样本数与参数；
- `continuous_result.json.gz` 或 `similarity_result.json.gz`：完整结果；
- `*_results_csv.zip`：可直接分析的CSV结果包。

新版连续距离结果把四层彻底分开：full-data observed距离；固定AI下Human组participant/run block permutation；Assignment00 common-m Monte Carlo收敛诊断；旧版Bootstrap/ Energy76-V legacy结果。正式指标为MICD00、Assignment00和Energy76-U。固定Human比较AI仅作描述，不输出p值。旧版 `continuous_result.json.gz` 无法事后恢复这些结果，必须用新版脚本重新运行。

结果在计算完成后写入磁盘，不受浏览器刷新影响。

## 7. 正式运行注意事项

- R9000P必须插电；
- Lenovo Vantage切换为性能模式；
- Windows电源设置中暂时关闭自动睡眠；
- 终端窗口不能关闭；
- 不要同时运行两个正式任务；
- RTX 3060当前不会被直接使用，主要依赖CPU和内存；
- 浏览器可以关闭，离线脚本仍会继续；
- 如果电脑重启或终端被关闭，当前版本的该次离线任务需要重新运行。

## 8. 学术一致性

Windows包锁定了与Mac版本相同的主要Python依赖版本，并继续使用固定随机种子。不同操作系统和BLAS实现可能产生极小的浮点数末位差异，但不会改变分析定义。

建议保存：

- 本运行包ZIP；
- `input_summary.json`；
- 完整结果JSON；
- CSV结果包；
- 论文中报告的软件版本和随机种子。
