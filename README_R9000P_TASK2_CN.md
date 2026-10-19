# Chromalab 3006 · R9000P 实验二个体异质性运行包

这个包包含 Mac 当前 3006 的完整网页，以及不依赖浏览器的实验二正式分析脚本。

## 2026-08-25 Human PCA 修复

本版本修复了旧包的情绪标签大小写问题：Human 工作簿中的 `love`、`compassion` 等小写标签现在会规范为 `Love`、`Compassion`，不会再被静默写成全零 profile。

同时新增输入保护：

- `None` / `Other` 作为合法“未选择”标记处理；
- 词表之外的未知情绪会显示具体文件、Excel 行号和颜色列并停止；
- 任一来源若解析到 0 条有效 GEW 关联，会在 PCA/PAM 开始前停止；
- 终端会逐来源显示 profile 数、有效单元格数、有效关联数和零关联单元格数；
- `input_summary.json` 会保存上述解析审计字段。

旧版生成的全零 `task2_heterogeneity_result.json.gz` 不能修复，必须用本包和原始八份 Excel 重新运行。

新结果的 `input_summary.json` 顶部必须包含 `parserVersion`；如果没有这个字段，说明运行的是其他旧目录中的脚本，不要导入或继续正式分析。

## 第一次安装

1. 将 ZIP 中的 `C3006V2` 文件夹直接解压到磁盘根目录，例如 `E:\C3006V2`。不要放在“下载”目录，也不要形成 `C3006V2\C3006V2` 双层目录，否则 scikit-learn 的 DLL 可能触发 Windows 路径过长错误。
2. 安装 64 位 Python 3.11 和 Node.js 22 LTS。
3. 双击 `1_install_windows.bat`。
4. 安装完成后双击 `3_check_environment.bat` 检查环境。

如果曾在长路径中运行过安装脚本，不要把原来的 `.venv` 搬过来；在 `E:\C3006V2` 中重新运行 `1_install_windows.bat` 创建新的虚拟环境。

如果 pip 报代理错误，先在 Windows“代理设置”中关闭无效代理，或在 CMD 执行：

```bat
set HTTP_PROXY=
set HTTPS_PROXY=
set PIP_PROXY=
```

再重新运行安装脚本。

## 准备实验二数据

把八个含有 `word_data.<色码>` 列的工作簿放进 `input_data`，并固定命名：

- `cn.xlsx`
- `bw.xlsx`
- `uk.xlsx`
- `us.xlsx`
- `deepseek.xlsx`
- `doubao.xlsx`
- `gpt.xlsx`
- `gemini.xlsx`

脚本读取第一张工作表。每一行应是一位 Human participant 或一个 AI run，并包含11个 `word_data.D38` 等标准色单元格。单元格内容应为带 `emotion` 与 `intensity` 的 associations JSON。

情绪名不区分大小写；合法强度为0–5。正式分析前请确认终端显示 CN/BW/UK/US 的 `recognized associations` 均明显大于0。

## 推荐运行顺序

先双击输入预检：

`6_check_input_data.bat`

必须在终端第一行看到：

`Parser version: task2-offline-human-casefold-v2-20260825`

并确认 CN、BW、UK、US 的 `recognized associations` 均大于0。预检只读取数据，不运行PCA、置换或Bootstrap，通常几秒完成。

预检通过后再双击：

`7a_run_task2_heterogeneity_quick.bat`

快速版用于确认八组数据都能拼成完整 11×20、220维 profile。完成后先检查：

`offline_results\task2_heterogeneity_quick_时间\quality_control.csv`

确认八组纳入数量正确、没有大量 invalid/excluded 后，再双击：

`7b_run_task2_heterogeneity_formal.bat`

正式版包含：

- subgroup稳定性500次；
- Energy与MMD各9999次participant/run标签置换；
- Bootstrap 1000次；
- 不等样本Hungarian下采样500次；
- Binary 0/1主分析和Rating/5稳健性分析；
- 固定随机种子20260824。

正式任务主要使用CPU，不使用RTX 3060。建议插电、性能模式、关闭自动睡眠。不要同时启动快速版和正式版。

## 结果位置

每次任务写入独立目录：

`offline_results\task2_heterogeneity_模式_时间\`

主要文件：

- `input_summary.json`：八个输入文件、有效关联数、零关联单元格数与解析数量；
- `task2_heterogeneity_result.json.gz`：完整结果；
- `task2_heterogeneity_csv.zip`：论文分析用全部CSV；
- `quality_control.csv`：完整profile与排除审计；
- `energy_ai_human.csv`、`mmd_ai_human.csv`；
- `nn_ai_human.csv`、`hungarian_ai_human.csv`；
- `subgroup_validation.csv`、`subgroup_profiles.csv`。

计算完成前不会生成最终结果文件。终端中的百分比为后台分析进度，浏览器可以关闭，但运行终端不能关闭。

## 打开网页

如需在R9000P上直接使用网页，双击 `2_start_platform.bat`，然后打开：

`http://localhost:3006/`

网页和离线脚本使用相同算法。正式长任务更建议运行 `7b`，因为浏览器刷新不会影响离线任务。
