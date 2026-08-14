# 传家志 · 适老化执行计划（故事朗读 + 字号上调）

- 原则:TTS 用百炼 Qwen-TTS,云函数合成后**存云存储永久缓存**,前端只管播/停。
- 设计见 `docs/superpowers/specs/2026-07-29-accessibility-design.md`。

## 一、任务清单

### 阶段 1 · 后端
- [x] 1. 新建云函数 `cloudfunctions/tts`:
  - 入参 `{ storyId }`;`cloud.init` + `db.collection('story').doc(storyId).get()`
  - **缓存优先**:若 `story.ttsFileID` 已存在直接返回,不重复合成
  - 否则:调 `https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`,`model=qwen3-tts-flash`、`input.text=story.content`、`voice=Cherry`、`language_type=Chinese`、`Authorization: Bearer $DASHSCOPE_API_KEY`
  - 解析 `output.audio.url`(兜底 `output.url`)→ `fetch` 下载 buffer → 写 /tmp → `cloud.uploadFile({ cloudPath:'tts/<ts>.wav', filePath })` → `db...update({ data:{ ttsFileID } })` → 返回 `{ code:0, data:{ fileID } }`
  - 失败统一 `{ code:非0, message }`,真实错误 console
- [x] 2. `config.js`:`cloudFns` 加 `tts: 'tts'`

### 阶段 2 · 前端·故事朗读
- [x] 3. `story.js`:`_fillStory` 整对象 setData 自然带出 `story.ttsFileID`;data 加 `reading`;`onRead`(有缓存直播,无则合成并写回缓存)、`onUnload`(stop+destroy 释放)
- [x] 4. `story.wxml`:view 模式正文上方加"朗读故事/暂停朗读"按钮(`bindtap="onRead"`)
- [x] 5. `story.wxss`:`.read-btn` 与正文留间距

### 阶段 3 · 字号上调
- [x] 6. 关系图节点名(canvas)`ctx.font` 12px → 16px
- [x] 7. story 页辅助文字上调:`.story-meta`/`.colorized-hint` 28→30rpx,`.contrib-time`/`.rel-popup-sub` 26→28rpx

### 阶段 4 · 验证（需用户）
- [ ] 8. 百炼控制台开通 `qwen3-tts-flash` 模型授权(北京地域)
- [ ] 9. 微信开发者工具:右键 `cloudfunctions/tts` → 上传并部署(新云函数必须部署才生效)
- [ ] 10. 真机:故事页点"朗读" → 首次合成 loading → 播放女声朗读正文 → 再点暂停 → 再进同篇即时播放(走缓存) → 退出页面音频停;关系图节点名可读性确认

## 二、实现备忘

- 云函数沿用 `restore` 的转存范式:`fetch(url) → buffer() → 写 /tmp → cloud.uploadFile`,已验证可用。
- 返回结构以 Java 示例 `getOutput().getAudio().getUrl()` 为准 → `d.output.audio.url`;解析时 `|| d.output.url` 兜底防字段名差异。
- 音频非流式返回 wav,云存储 `cloudPath` 用 `.wav`;`InnerAudioContext` 原生支持 wav。
- onUnload 必须 stop+destroy,否则老人返回上一页音频继续响。
- 超时 `config.json` 配 60s(同 restore),合成 800 字约数秒,余量充足。
