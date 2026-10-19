# 跨文化 AI 色彩情感联想项目数据工作台

用于研究不同语言模型与人类样本在色彩—情感联想上的异同。工作台整合了实验平台、离线统计分析脚本、可复现的派生结果，以及带 Git 标签的版本演进记录。

## 当前版本

当前工作树对应 **v1.2.1-human-pca-fix-v2-20260825**：在任务二异质性分析中，针对 Human 导出文件加入大小写无关的 Geneva Emotion Wheel 情绪解析、输入预检、结果溯源及对旧版全零结果的拒绝机制。

完整版本说明见 [VERSION_HISTORY.md](VERSION_HISTORY.md)。

## 目录说明

| 路径 | 内容 |
| --- | --- |
| `app/` | Next.js 实验与分析工作台前端及 API 路由 |
| `python_figures/` | Python 分析、统计检验和图形生成模块 |
| `analysis/` | 任务二日内瓦情绪轮的独立分析脚本和依赖清单 |
| `data/derived/phase2_current/` | 已整理的派生统计表、分析摘要与可视化结果 |
| `scripts/` | Windows 环境检查及离线正式分析脚本 |
| `tests/` | 前端与 Python 分析模块的测试 |
| `drizzle/`、`db/` | D1/Drizzle 数据库定义及迁移 |

## 本地运行

平台部分需要 Node.js 22 LTS 或更新版本；离线分析建议使用 Python 3.11 x64。Windows 环境可先运行 `1_install_windows.bat`，再使用对应的任务脚本。

任务二日内瓦情绪轮分析：

```bash
python3 -m pip install -r analysis/requirements.txt
python3 analysis/phase2_emotion_wheel_analysis.py \
  --input-dir /path/to/SurveyResponse_csvs \
  --output-dir outputs/phase2_current
```

## 数据与公开边界

仓库目前为私有仓库，包含源代码、聚合统计、图表及经假名化处理的参与者级派生表。原始问卷答卷、访问凭据、运行产物、依赖目录及压缩备份均不应提交；将仓库公开前，必须先移除或重新审核参与者级派生表。细则见 [DATA_POLICY.md](DATA_POLICY.md)。
