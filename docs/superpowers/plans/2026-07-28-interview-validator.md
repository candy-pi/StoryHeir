# 传家志 · 访谈验证 Agent(Interview Validator)执行计划

- 对应设计:`docs/superpowers/specs/2026-07-28-interview-validator-design.md`
- 原则:**纯 chat 云函数内部增强**——不新增集合、不改数据模型、不动前端。把"单次生成"升级为"生成+验证"双 Agent,提问质量有闭环保障。
- 风格对齐:复用 chat 现有 `callLLM` / thinking disabled / node-fetch v2 / `{code,data}` 返回 / JSON 兜底解析。

## 改造接缝

| 现状 | 改造 |
|------|------|
| `textChat` 单次 GLM → 直接返回 reply | 生成后追加 Validator;不通过带 feedback 重生成(N≤2) |
| 无质量反馈 | Validator 输出 pass/fail + issues + suggestion |
| VL 首轮看图开场 | **不改**(首轮破冰,验证价值低且 VL 调用贵) |

## 双 Agent 流程

```
用户作答 → history
   │
   ▼
generateText(history)            ← Interviewer(GLM)
   │ candidate reply
   ▼
validateReply(reply, 近3轮)       ← Validator(GLM,判 不重复/够具体)
   │
   ├── pass ──→ 返回 reply
   └── fail ──→ 带 suggestion 回 generateText(循环,N≤2)
                 兜底:到上限用最后一次 reply
```

## rubric(当前聚焦两项硬指标)

无 A(记忆)/B(目标)前,Validator 只硬卡两项能立刻见效的:
- **不重复**:没和最近 3 轮问过的重复或高度相似
- **够具体**:有具体抓手(人/事/时/地),不是"然后呢""后来呢"式空泛

其他三项(契合目标 / 触及关系 / 有温度)当前作软参考。pass 判定 = 不重复 **AND** 够具体(两项必过)。A/B 接上后自动增强为 5 项 ≥4。

## 关键决策(已定)

- **首轮 VL 开场不验证**:VL 调用贵 + 首轮破冰质量可控,验证只针对后续文本提问追问。省钱、聚焦、快。
- **Validator 默认用主模型 glm-5.2**:env `DASHSCOPE_VALIDATOR_MODEL` 可换更快的,不配即同模型。判断力优先于省钱。
- **降级优先**:Validator 任何异常(超时 / 调用失败 / JSON 解析失败)一律视为 pass,绝不阻塞访谈主流程。
- **开关 env `INTERVIEW_VALIDATE`**:默认 on,off 时完全回到现状(可降级 / 调试)。

## 涉及文件

| 类型 | 文件 |
|------|------|
| 改 | `cloudfunctions/chat/index.js`(抽生成函数 + `validateReply` + loop + env) |
| 不碰 | 前端 interview / asr / genStory / restore / extractValues / 任何集合 |

## 执行顺序与任务

### 阶段 1 · 云函数重构与验证逻辑
- [x] 1. 抽出文本生成函数 `generateText(history, apiKey, model, feedback)`,feedback 并入 system(保持 history 末条为 user,结构干净)
- [x] 2. 实现 `validateReply` + `parseValidatorJson`:GLM 调用 + 剥离 ```json + 正则兜底解析;任何解析失败一律降级 `{pass:true}`
- [x] 3. 实现 `chatWithValidation` 主循环:生成 → 验证 → fail 带 suggestion 重生成,N≤2,到上限用最后一次兜底
- [x] 4. env 开关 `INTERVIEW_VALIDATE`(默认 on)+ `DASHSCOPE_VALIDATOR_MODEL`(默认主模型)
- [x] 5. 异常兜底:`validateReply` 抛错被 loop 捕获降级放行;`parseValidatorJson` 失败降级 pass —— 双层兜底,绝不阻塞
- [x] 6. `console.log` 打印 pass/fail/issues/suggestion/重试轨迹(真机验证用)

### 阶段 2 · 部署与验证(需用户)
- [ ] 7. 部署 chat 云函数(右键 → 上传并部署:云端安装依赖)
- [ ] 8. (可选)云函数环境变量配 `DASHSCOPE_VALIDATOR_MODEL`
- [ ] 9. 真机验证:构造空泛提问场景(如连续回答很短),确认重生成后更具体;看日志 pass/fail 轨迹

## 风险与对策

| 风险 | 对策 |
|------|------|
| 多次调用增延迟(+2~5s) | N≤2 + thinking disabled;前端已有"思考中"占位 |
| Validator 误判把好的打回 | 只硬卡不重复 / 够具体两项;兜底用最后一次 |
| JSON 解析失败 | 剥离 ```json + 正则兜底;再失败视为 pass |
| 死循环 | 硬上限 N=2,到即返回 |
| 成本上升 | 访谈核心值得;`INTERVIEW_VALIDATE=off` 可关 |

## 验收标准

1. `INTERVIEW_VALIDATE=on` 时,chat 日志可见 pass/fail/重试轨迹。
2. 构造空泛提问场景,重生成后 reply 明显更具体、不重复。
3. Validator 异常时主流程不中断,正常返回 reply。
4. `INTERVIEW_VALIDATE=off` 时,行为与现状完全一致。
5. 首轮看图开场、asr、genStory 等现有流程不受影响。
