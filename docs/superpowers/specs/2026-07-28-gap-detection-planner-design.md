# 模块 B · 人生空白检测 + 采访规划(Gap Detection & Interview Planner)设计

> 对应总纲方向 4/7。比赛最亮眼的"AI 主动补人生空白"。依赖模块 A(events 数据)。

## 一、目标

让采访从"随机追问"变成"有目标地补全人生"。
- AI 维护一组**人生维度**的覆盖图(童年/求学/工作/婚恋/子女/迁徙/低谷/成就/遗憾/信念...);
- 自动发现**未触及或聊得很浅**的维度;
- 据此规划本轮采访目标,主动开场:"您好像一直没聊过奶奶,愿意讲讲你们第一次见面吗?"

## 二、与现有架构的接缝

| 现状 | 改造 |
|------|------|
| chat 每轮无目标地追问 | 接收 `interviewGoal`(本次目标维度),system prompt 围绕它引导 |
| 无采访规划入口 | 新增 `planInterview` 逻辑(放 chat 内分支或独立云函数) |
| 无维度覆盖数据 | 新增 coverage 数据(独立集合,或 memory 里存一份 family 覆盖图) |

## 三、人生维度模型

定义一组维度(可调,建议 10-12 个,覆盖一生):

```
童年 · 求学 · 工作 · 婚恋 · 子女 · 家庭关系 · 迁徙/离开故土
低谷与困难 · 成就与骄傲 · 重大时代事件 · 遗憾 · 信念/家风
```

每个维度状态:`未触及(0)` / `浅聊(1)` / `已详述(2)`。

## 四、覆盖率计算

输入:该 family 的所有 memory(event 标题 + 年份 + 参与)和 story(标题 + 摘要)。
用 GLM 做一次**维度标注**:

```
prompt: "以下是这个家庭已记录的人和事:{events + story 摘要}。
         请为每个维度判断覆盖程度(0未触及/1浅聊/2详述),并给一句话理由。
         输出 JSON: { dimensions: { 童年: {score:0, why:'未提及童年'}, ... } }"
```

结果存 coverage:

```js
// coverage 集合(或 memory 里 kind=coverage 的单条 family 记录)
{
  familyId: "default",
  dimensions: {
    childhood:   { score: 2, why: "详述过逃难童年" },
    career:      { score: 2, why: "纺织厂、个体户" },
    romance:     { score: 0, why: "从未提及婚恋经过" },
    regret:      { score: 0, why: "未提及遗憾" },
    // ...
  },
  updatedAt
}
```

> 触发时机:每次 genStory 后增量重算;或每次进入采访页/点"开始"前重算(故事不多,全量重算成本低)。

## 五、Gap Detection + Planner

```
Gap:   从 coverage 找 score 最低(优先 0)的维度,作为候选目标。
       若多个并列,按预设优先级(如先"家庭关系"再"遗憾")或随机避免每次一样。
Planner: 选定 1 个 gap 维度 → 生成开场引导句。
       prompt: "这个家庭从未聊过【婚恋】。请用一句温暖、具体、不突兀的开场,
               引导老人讲讲这方面的往事。参考已知人物:{人物摘要}。"
       输出: { goal: "romance", opener: "您好像一直没聊过奶奶。愿意讲讲你们第一次见面吗?" }
```

## 六、集成进 chat

- interview 页点"开始/没有照片直接聊"时,先调 `planInterview` 拿到 `{ goal, opener }`。
- chat 首轮:用 planner 的 opener 作为 AI 第一句(替代现在的兜底开场);后续轮 system prompt 带:"本次采访目标是补全【婚恋】维度,围绕它自然追问,但不要生硬。"
- chat 内部维护本轮 goal(前端传入或云函数本次会话持有)。

> 与模块 C(验证 Agent)协同:Validator 可把"是否符合 interviewGoal"作为校验维度之一,未达标则重生成。

## 七、改动点清单

- **新增数据**:coverage(集合或 memory 记录)
- **云函数**:新增 `planInterview`(或在 chat 加分支)——读 memory/coverage → 标注 → 选 gap → 生成 opener
- **云函数 genStory**:生成后触发 coverage 重算
- **云函数 chat**:接收/持有 interviewGoal,注入 system prompt
- **interview.js/wxml**:开始访谈前调 planInterview;首轮展示 planner opener

## 八、实施任务清单(批准后转 plan)

- [ ] 定义人生维度清单与优先级
- [ ] 新增 coverage 数据结构 + 读写
- [ ] planInterview:维度标注 prompt(GLM 输出 JSON)
- [ ] planInterview:gap 选择 + opener 生成
- [ ] genStory 后触发 coverage 重算
- [ ] chat 接收 interviewGoal,首轮用 opener、后续注入目标
- [ ] interview 页接入 planInterview(开始前调用)
- [ ] 真机验证:聊满工作维度后,下次开场 AI 主动转向未触及的婚恋/遗憾

## 九、风险与对策

| 风险 | 对策 |
|------|------|
| 维度标注主观、不稳定 | 固定维度清单 + 要求 GLM 给 why(可追溯);score 用三档降敏感度 |
| 每次都推同一维度 | gap 选择加随机/轮转;记录"已建议过的维度"避免连推 |
| opener 生硬像查户口 | prompt 强调"温暖、具体、借已知人物切入";可结合模块 C 验证自然度 |
| 依赖模块 A | 先落地 A;若 A 未做,可先用 story 摘要降级算覆盖率(精度略低) |

## 十、验收标准

1. 录入若干只聊"工作"的故事后,coverage 中 romance/regret 等为 0。
2. 再次开始访谈,AI 首句主动引向未触及维度(如婚恋/遗憾),且措辞自然。
3. 同一维度聊过后,score 升至 1/2,不再被反复推。

## 十一、比赛加分点

- **AI 主动采访**的真正落地:不是 prompt 套路,而是基于记忆的主动规划——这是多数参赛项目没做到的。
- 多 Agent 架构的"Planner"角色,技术叙事完整。
- 情感价值高:"AI 帮家里补全那些差点被遗忘的人生"——评审和用户都易被打动。
