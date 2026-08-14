# 传家志 · 一个故事多张照片（过程补图）设计

## 背景
现状「一故事一照片」贯穿全链路：interview 选 1 张 → chat 首轮看 1 张 → genStory 存 1 张 → story 显 1 张 → restore 上色 1 张 → chronicle 头图 1 张。
用户要：**访谈过程中随时可补一张照片，AI 即时看新图、就新图追问**（如讲到父亲中年时补一张中年照，AI 问「这时候在做什么？」）。

## 目标体验（第一期，最小可用闭环）
1. 开场仍可选一张照片破冰（保留现状）
2. 访谈输入区常驻「+ 加一张照片」，点了选图上传 → 作为一条**带图的用户消息**插入对话 → AI 这一轮看新图、结合上下文追问
3. 多张照片随访谈记录保存
4. 成稿后，多张照片在故事页**图集轮播**展示（上色第一期仍只对主图）

## 数据模型变更
- `interview.messages[i]`：`{ role, text, photoFileID? }` —— 带图消息多一个 `photoFileID`
- `story`：新增 `photoFileIDs: string[]`（全部照片，按补图顺序）；**保留** `photoFileID` 作主图（= `photoFileIDs[0]`），旧数据无 `photoFileIDs` 时回退 `[photoFileID]`
- 兼容：旧 story / 旧 interview 不受影响，读端统一兜底

## 各环节改动（第一期）

### interview
- 输入区加「+ 加一张照片」按钮（常驻，与语音/文字切换同行或紧邻）
- 选图上传后：插一条 `{role:'user', text:'（给记者看一张新照片）', photoFileID, loading:false}` 消息（带缩略图气泡）→ 触发 `_askAI`，末条带图
- `_askAI` 透传：末条 user 消息若带 `photoFileID`，chat 这一轮走「看图追问」

### chat
- main 路由：`hasHistory` 时检查 history 末条是否 `user` 且带 `photoFileID`
  - 是 → 走新函数 `askAboutNewPhoto`：`downloadFile` → base64 → Qwen-VL，prompt 带「最近几轮对话 + 这是刚给的新照片」，返回一句针对新图的追问（承接上下文、往人和情上引）
  - 否 → 现状（chatWithValidation / generateText）
- 首轮全局 `photoFileID` + 无 history → 保留 `visionOpening` 破冰不变
- 补图不重抽 clues（首轮才抽），省成本

### genStory
- 从 history 收集所有带 `photoFileID` 的消息 → 去重保序 → `photoFileIDs`
- 落库 `photoFileIDs` + `photoFileID = photoFileIDs[0]`（兼容）
- 入参 `photoFileID` 保留（旧调用兜底）

### story
- `_fillStory` 组装 `photos = photoFileIDs.length ? photoFileIDs : (photoFileID ? [photoFileID] : [])`
- wxml：`photoFileID` 单图 → `swiper` 轮播 `photos`（多点指示点）
- 上色（restore）第一期不动：仍按 `storyId` 给主图 `photoFileID` 上色，`colorizedFileID` 作主图彩色；轮播时首图显彩色、其余原色（二期再支持逐张）

## 第二期（本次不做，记录待办）
- restore 改造：多图逐张上色（`colorizedFileIDs[]`）
- chronicle 头图：从多图里选最有代表性的一张
- 图文混排：genStory 用 VL 把每张图对齐到正文段落（高 cost，可选）

## 风险与对策
- **补图每次调一次 VL（成本）**：补图是低频动作（讲一段才补一张），可接受；不抽线索进一步省
- **带图消息渲染**：消息气泡要显示缩略图，区别于纯文字
- **旧数据兼容**：读端统一 `photos` 兜底，旧 story 单图照常显示
- **VL 返回稳定性**：补图 VL 直接返回一句话（不强制 JSON），避免首轮那种 parse 降级复杂度

## 验收门槛（真机）
1. 访谈中点「+ 加照片」→ 选图 → 出现带缩略图的消息 → AI 针对新图追问（承接上下文）
2. 补多张图，每张 AI 都能就图追问
3. 生成故事后，故事页 swiper 轮播展示所有照片
4. 旧故事（单图）仍正常显示
