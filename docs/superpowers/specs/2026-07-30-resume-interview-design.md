# 传家志 · 继续采访完善故事（续访）设计

## 背景
家人共建（补充/校对/认人）是旁路标注、不进正文——保可信。但故事需要一条"越用越完整"的路径。零散补充硬塞正文会割裂，正确做法是让 AI 记者小传**再采访一轮**，把新信息重新织进连贯叙事，直接更新原故事。

发挥小传的核心能力链：采访 → 成稿 → 再采访 → 更完整的成稿。

## 目标
- 故事页提供「继续完善这个故事」入口，进入续访
- 续访带着原访谈对话，AI 基于原故事**直接接续追问**（不重新破冰）
- 续访中 AI 把握**故事三要素**（人物/情节/环境），引导把故事讲丰满
- 聊完重新生成，**直接更新原故事**（不留版本）

## 故事三要素（本次新增的采访引导）
AI 记者在采访中围绕三要素引导，缺哪个补哪个：
- **人物**：故事里的人什么性格、什么命运、和主角什么关系
- **情节**：事情的起因、经过、转折、结果
- **环境**：那时的年代背景、地点、生活氛围

落点：chat 云函数 SYSTEM_PROMPT。措辞要自然（往单薄处引），不能变成填表式追问。

## 核心流程
1. 故事页 →「继续完善这个故事」→ `navigateTo interview?storyId=xxx`
2. interview onLoad(storyId)：拉原 story → 拿 interviewId + 原 messages + photoFileID → 预填对话 → 标记续访 → 自动触发续访首轮（AI 接续追问）
3. 用户继续讲（语音/文字，复用现有作答逻辑）
4. 生成 → genStory（原+新完整 history，storyId）→ 更新原 story + 更新原 interview messages → 跳回故事页

## 技术改动点

### 1. chat 云函数
- SYSTEM_PROMPT 加三要素引导（所有采访通用，首次 + 续访都生效）
- 新增 `resume` 参数：续访首轮在 system 注入「承接上文 + 挑三要素薄弱处追问」
- 已有逻辑（visionOpening / photoClues / Validator）保留；续访首轮不重抽 VL（省成本，靠三要素 + 原对话）

### 2. genStory 云函数
- 新增 `storyId` 参数：有则 `update` 原 story（content/title/era/persons/relations 覆盖），无则 `add`（现状不变）
- 续访时 update 原 interview 的 messages 为完整 history（原+新），保证可追溯

### 3. interview.js
- onLoad 支持 `options.storyId`（续访入口）：拉原数据、预填 messages、存 `this.storyId` / `this.isResume` / photoFileID
- 续访自动触发首轮：`_askAI(原history, resume=true)`
- `_askAI` 透传 `resume` 给 chat
- onGenStory 续访模式：genStory 传 storyId → update；跳回故事页 `?id=storyId`

### 4. story.js / story.wxml
- 查看模式加「继续完善这个故事」按钮，`navigateTo interview?storyId=`
- 权限：只有故事作者能 update；非作者续访会被 genStory 的 update 拦。按钮可都显示，失败友好提示"只有作者能完善"

## 设计决策（已拍板）
1. 续访后**直接更新原故事**，不留版本（原访谈对话在 interview 集合可追溯）
2. AI**直接基于原故事接续追问**，不给用户选方向
3. **三要素**（人物/情节/环境）注入 chat 采访引导

## 风险与对策
- AI 续访首轮不承接、重新破冰 → system 明确"这是续访，先承接上文"
- 三要素引导变填表式生硬追问 → 措辞强调"自然地往单薄处引，一次一个"
- update 权限（非作者）→ 按钮可见，update 失败给友好提示
- 续访 photoClues → 不重抽 VL，靠三要素 + 原对话（省成本）

## 验收门槛（真机）
1. 故事页点「继续完善」→ 进访谈页，能看到原对话，AI 自动接续追问一句（承接原故事，不破冰）
2. 继续讲 2~3 轮，AI 追问体现出三要素里某个薄弱处
3. 生成后故事正文更新为更完整版，人物/关系图同步更新
4. 原访谈记录（interview）完整保留原+新对话
