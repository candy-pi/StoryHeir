# 模块 A · 家庭记忆数据层(Family Memory Layer)设计

> 对应总纲方向 1/2/3。所有智能模块(B 空白检测、E 多模态时间轴)的地基,必须最先落地。

## 一、目标

把"一次性采访 → 一篇 Story"升级为"持续累积的家庭记忆网络"。
- 老人第二次来,AI 能记得上次提过的"王叔叔""东北插队";
- 跨故事归并同一人物/事件,编年志从"按 Story 分章"升级为"按 Event 分章";
- 为模块 B 的覆盖率计算、E 的多模态时间轴提供结构化数据。

## 二、与现有架构的接缝

| 现状 | 改造 |
|------|------|
| `genStory` 生成 story(含 persons/relations) | 增加实体抽取:额外产出 events/places,写入 memory 集合 |
| `chat` 每轮单次 GLM,无跨次记忆 | 每轮注入该 family 的 memory 摘要到 system prompt |
| `chronicle` 按 story.era 分章 | (后续)按 memory.event 分章,多 story 归并到同事件 |
| 集合:story / contribution | **新增 memory 集合** |

## 三、数据模型:memory 集合

单集合 + `kind` 字段(减少集合管理负担,查询用 where kind 过滤):

```js
// memory 集合一条记录
{
  _id,
  familyId: "default",        // 预留:当前单家族 Demo 用固定值
  kind: "person",             // person | event | place | value
  // —— person ——
  name: "爷爷",
  aliases: ["老头子"],         // 异名归并用(精确匹配,MVP 不做模糊)
  role: "长辈",
  // —— event ——
  title: "下乡插队",
  year: 1969,                 // 归一化年份,复用 chronicle.parseYear 逻辑
  place: "黑龙江",
  participants: ["爷爷", "王叔叔"],
  // —— place ——
  // name / type(故乡/工作地/迁徙途经)
  // —— value(家风,与模块 D 共用) ——
  // value: "诚信"  quote: "做人要诚信"  (由模块 D 主导)
  sourceStoryIds: ["story_id_1", "story_id_7"],  // 反向溯源到原始故事
  createdAt
}
```

> person 复用现有 story.persons 的结构思路;升级点是**跨故事归并**(同名 upsert,异名进 aliases)。

## 四、实体抽取(genStory 增强)

genStory 云函数在生成 story 后,追加一次 GLM 调用(或在同一 prompt 里要求 JSON 一并返回实体),抽出:

```
输入:story.content + story.persons
输出:{
  events: [{ title, yearRaw, place, participants[] }],
  places: [{ name, type }],
  persons: [{ name, aliases[], role }]   // 补充已有 persons 的 alias/role
}
```

抽取后 **upsert** 到 memory:
- person:按 `familyId + name` 查,存在则合并 aliases/role、追加 sourceStoryId;不存在则新建。
- event:按 `familyId + title` 归并(标题精确匹配,MVP 不做语义去重),追加 sourceStoryId。
- place:按 name 归并。

> 风险点:语义归并(同名异称、近义事件)是难点。MVP 用精确匹配 + alias 列表兜底,不做向量相似度。文档里标注"已知简化"。

## 五、记忆注入(chat 增强)

chat 云函数在构造 messages 前,拉取该 family 的 memory 摘要:

```
拉取:memory.where({ familyId }).get()
压缩成摘要(控制 token,只取要点):
  已知人物:爷爷(长辈)、奶奶、王叔叔(插队同伴)...
  已记录事件:1969 下乡插队(黑龙江)、1985 婚事...
注入 system prompt:
  "你是家族记者小传。这是这个家庭已经聊过的人和事,你可以自然地回忆和追问:
   {摘要}。当前本次采访,请基于这些背景,不要重复问已详述的事。"
```

效果:第二次采访,AI 主动说"上次您提到王叔叔一起插队,后来还有联系吗?"

> token 控制:摘要只含人物名 + 事件标题 + 年份,不含正文。超 N 条时按时间取最近 / 按重要度截断。

## 六、改动点清单

- **新增集合**:`memory`(权限:所有用户可读、仅创建者可写,或云函数代写)
- **云函数 genStory**:加实体抽取 + memory upsert 逻辑
- **云函数 chat**:加 memory 摘要读取 + system prompt 注入
- **utils**(可选):抽取 memory 摘要的工具函数,供 chat/chronicle 复用
- **chronicle**(后续,非本模块强制):按 event 分章——本模块先把数据备好,分章改造可单独排期

## 七、实施任务清单(批准后转 plan)

- [ ] 新建 memory 集合并配权限
- [ ] genStory:设计实体抽取 prompt(要求 JSON 输出 events/places/persons)
- [ ] genStory:实现 upsert 逻辑(按 familyId+name/title 归并)
- [ ] chat:实现 memory 摘要拉取 + 压缩
- [ ] chat:摘要注入 system prompt,验证 AI 能"回忆"
- [ ] 复用 chronicle.parseYear 的年份归一化(抽 event 时统一 year)
- [ ] 真机验证:同一 family 两次采访,AI 第二次能引用第一次的内容

## 八、风险与对策

| 风险 | 对策 |
|------|------|
| 实体语义归并不准(同名异人、异名同人) | MVP 精确匹配 + alias;UI 后续可加"合并人物"人工操作 |
| 摘要注入撑爆 token | 只取名/标题/年份,设条数上限,超额按最近截断 |
| 多一次 GLM 抽取增加成本/延迟 | 尽量在 genStory 同一次调用里要求实体一并返回(单 prompt 多输出) |
| 旧 story 无 memory 记录 | 提供"回填"入口:遍历旧 story 补抽(一次性脚本或手动按钮) |

## 九、验收标准

1. 生成一篇新故事后,memory 集合出现对应 person/event/place 记录,sourceStoryIds 正确。
2. 第二次采访(同 family),AI 首轮提问能引用上次提到的人或事(非空泛套话)。
3. 同一人物在两篇故事里出现,memory 只有一条记录,sourceStoryIds 含两个 storyId。

## 十、比赛加分点

- 直接回应大赛主题「与 AI 共生」:AI 不是一次性工具,而是与家庭**长期共生**的记忆体。
- "Family Knowledge Graph"是评审容易感知的技术亮点(数据结构化、可查询)。
- 为后续 B(空白检测)、E(多模态时间轴)提供地基,故事可持续讲。
