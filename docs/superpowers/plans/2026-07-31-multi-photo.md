# 传家志 · 一个故事多张照片（过程补图）执行计划

- 设计见 `specs/2026-07-31-multi-photo-design.md`
- 铁律：改完真机验证更优才采用；分期推进，第一期先打通主链路
- 范围：**第一期** —— 访谈补图 + AI 看图追问 + 多图成稿 + 故事页轮播

## interview（补图入口 + 带图消息）
- [x] 1. `interview.wxml`：输入区加「+ 加一张照片」按钮；消息气泡带图时显示缩略图
- [x] 2. `interview.js`：`onAddPhoto` 选图上传 → 插带 `photoFileID` 的 user 消息 → 触发 `_askAI`
- [x] 3. `_historyForAI`/`_pushMessage` 透传 `photoFileID`（chat 据末条带图判断这轮看新图）

## chat（看图追问分支）
- [x] 4. `chat`：新增 `askAboutNewPhoto(photoFileID, recentText, apiKey, vlModel)` —— VL 看新图 + 带对话上下文，返回一句追问
- [x] 5. `chat` main 路由：hasHistory 且末条 user 带 `photoFileID` → 走 `askAboutNewPhoto`；否则现状

## genStory（收集多图落库）
- [x] 6. `genStory`：从 history 收集 `photoFileID` 去重保序 → 落库 `photoFileIDs` + `photoFileID=photoFileIDs[0]`（首次 add + 续访 update 都带）

## story（图集轮播）
- [x] 7. `story.js` `_fillStory`：组装 `photos` 兜底（photoFileIDs 优先，回退 photoFileID）
- [x] 8. `story.wxml`：多图 `swiper` 轮播 + 指示点；单图保留 widthFix；上色维持主图

## 验证
- [x] 9. node --check 全部改后文件（5 个 js 全过）
- [ ] 10. 【用户】真机：补图→AI 看图追问→多图成稿→故事页轮播；旧单图故事仍正常
