# 任务二：日内瓦情绪轮分析

`phase2_emotion_wheel_analysis.py` 汇总 `SurveyResponse_*.csv`，对 11 个正式 Munsell 色块和 20 个核心 GEW 情绪进行质量控制、描述统计和 FDR 校正后的检验。

默认主样本要求完成任务二、11 色完整、JSON 合法、年龄 18–60 岁、无色觉缺陷，并按参与者 ID 去重。居住地不匹配、作答时间少于 60 秒、11 色完全相同等情况默认记录为 QC 标记而非自动排除。
