# 模块 C · 采访验证 Agent(Interview Validator)设计

> 对应总纲方向 7/10。把 chat 从"单次生成"升级为"生成 + 验证"双 Agent,提问质量有保障。可与模块 B 深度协同。

## 一、目标

AI 生成的每个问题/回复,先过一道质量校验,不达标则带反馈重生成。让每一次提问都:
- 不重复(没问过的事);
- 够具体(有细节抓手,不空泛);
- 符合采访目标(若有 interviewGoal);
- 触及人物关系;
- 有情感温度。

## 二、与现有架构的接缝

| 现状 | 改造 |
|------|------|
| chat 单次 GLM 调用直接返回 reply | 生成后追加一次 Validator 校验;不通过则带 feedback 重生成(最多 N 次) |
| 无质量反馈 | Validator 输出 pass/fail + 改进点 |

> 不新增集合、不改数据模型;纯云函数内部逻辑增强。**改动面最小、风险最低、技术叙事强**。

## 三、双 Agent 流程

```
用户回答
   │
   ▼
Interviewer Agent (GLM)  ── 生成候选 reply
   │
   ▼
Validator Agent (GLM)    ── 按 rubric 打分 + 给改进点
   │
   ├── pass ──→ 返回 reply 给用户
   │
   └── fail ──→ 带 feedback 回到 Interviewer 重生成(循环,上限 N=2)
                  │
                  兜底:达到上限用最后一次 reply
```

## 四、Validator 评分 rubric

Validator prompt 框架:

```
你是采访质量评审。判断这条记者提问是否合格:
候选:{reply}
上下文:已知人物 {memory 摘要}、本次目标 {interviewGoal}、最近已问过 {最近 3 轮}
按以下逐项判定(每项 pass/fail + 一句话):
  1. 不重复:没有和最近已问过的问题重复或高度相似
  2. 够具体:有具体抓手(人/事/时/地),不是"然后呢""后来怎样"式空泛
  3. 契合目标:推进 interviewGoal(若有)
  4. 触及关系:尽量关联已知人物,而非孤立提问
  5. 有温度:语气自然温暖,不像查户口
输出 JSON: { pass: bool, issues: ["...", "..."], suggestion: "改进方向一句话" }
```

pass 条件:5 项中至少 4 项 pass(留 1 项容差,避免无限重生成)。

## 五、重试与成本控制

- **上限 N=2**:最多重生成 2 次,第 3 次无论结果都用(兜底,保证响应)。
- **模型选择**:Validator 若可用更快/更便宜的模型(百炼支持指定 `DASHSCOPE_MODEL`),单独配一个 `DASHSCOPE_VALIDATOR_MODEL` env;不配则用同模型。
- **开关**:env `INTERVIEW_VALIDATE=on/off`,便于调试降级回单 agent。
- **延迟**:多 1-2 次 GLM 调用,约 +2~5s。前端已有"正在思考…"占位,体验可接受;必要时并行(先返回一个,后台优化)。

## 六、与模块 B 协同

- Validator 的"契合目标"维度直接消费 B 的 interviewGoal;
- B 的 opener 也走 Validator 校验自然度。
- 因此推荐顺序:B 先(产出 goal)→ C 接上(校验)。但 C 也能独立用通用 rubric(无 goal 时跳过第 3 项)。

## 七、改动点清单

- **云函数 chat**:抽出生成逻辑为可复用;加 validate loop;加 env 开关与模型配置
- **无前端改动**(体验上仍是"正在思考…")
- **(可选)** Validator 模型 env:`DASHSCOPE_VALIDATOR_MODEL`

## 八、实施任务清单(批准后转 plan)

- [ ] chat 重构:生成函数抽出 `generateReply(history, goal)`
- [ ] 实现 `validateReply(reply, ctx)`(GLM 调用 + JSON 解析)
- [ ] 加 validate loop(pass/fail/重生成/兜底)
- [ ] env 开关 `INTERVIEW_VALIDATE` + validator 模型配置
- [ ] 异常兜底:Validator 调用失败时降级为直接返回(不阻塞主流程)
- [ ] 真机验证:构造一个会触发"空泛提问"的场景,确认被重生成改善

## 九、风险与对策

| 风险 | 对策 |
|------|------|
| 多次调用增加延迟/成本 | N≤2;Validator 用小模型;env 可关 |
| Validator 误判(把好的打回) | pass 阈值留 1 项容差;兜底用最后一次 |
| JSON 解析失败 | 严格提示 + try/catch 降级(解析失败视为 pass,不阻塞) |
| 死循环 | 硬上限 N,达到即返回 |

## 十、验收标准

1. `INTERVIEW_VALIDATE=on` 时,chat 内部日志可见 pass/fail/重试轨迹。
2. 构造空泛提问场景(如 history 很短),重生成后的 reply 明显更具体。
3. Validator 调用异常时,主流程不中断,正常返回 reply。
4. `INTERVIEW_VALIDATE=off` 时,行为与现状完全一致(可降级)。

## 十一、比赛加分点

- **多 Agent 架构**最直接的体现:生成 + 验证,有质量闭环,而非裸 prompt。
- "生成-评估-改进"的工程化思路,是 AI 工程的进阶展示。
- 与 B 的 Planner、A 的 Memory 组合,可讲一个完整的 Agent Workflow 故事(感知→规划→执行→验证→记忆)。
