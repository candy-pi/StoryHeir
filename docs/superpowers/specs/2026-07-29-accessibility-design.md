# 传家志 · 适老化模块设计（故事朗读 + 字号上调）

## 一、为什么做

传家志的核心用户是老人。老人用手机最大的两道坎:

1. **看不清**——故事正文虽已是 34rpx,但关系图节点名只有 12px,各类辅助文字 28-30rpx,老花眼仍吃力。
2. **看不动**——视力衰退严重的老人,读几百字正文是负担。"听"比"看"对老人友好得多。

适老化是这类产品在评审面前最直接的"与 AI 共生"价值落点:AI 不只是写故事,还**把故事读给老人听**。

## 二、范围（本期）

| 项 | 做 | 说明 |
|----|----|------|
| 故事一键朗读（TTS） | ✅ 核心项 | 故事页正文加"朗读"按钮,调百炼 Qwen-TTS 合成,云存储永久缓存 |
| 关系图节点字号 + 辅助文字上调 | ✅ 配套小修 | 让画面整体对老人更友好 |
| 全局字号档位开关 | ⏸️ 不做（过度工程） | 档位开关对老人反而是认知负担;直接把默认字号调到舒适区更省事。本期不做,留待评审反馈再议 |

## 三、技术选型:TTS 用 Qwen-TTS

调研百炼三类非实时 TTS 后选定 **Qwen-TTS**(`qwen3-tts-flash`):

- **域名一致**:endpoint `https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`,与现有 chat/asr 云函数同域名,**复用 `DASHSCOPE_API_KEY`,无需 WorkspaceId**。CosyVoice/Qwen-Audio-TTS 要 `{WorkspaceId}.cn-beijing.maas.aliyuncs.com` 专属网关,我们没有 WorkspaceId,排除。
- **非流式**:一次返回完整音频 URL,适合"整篇故事合成"场景(不是逐字朗读)。
- **返回**:`output.audio.url`(音频文件,有效期 24 小时)。
- **地域**:仅北京地域(用户百炼默认北京,符合)。
- **成本**:按字符计费,单篇故事约 800 字,单次合成成本极低;且**每篇只合成一次**后永久缓存,边际成本为零。

**音色**:首版用系统音色 `Cherry` + `language_type=Chinese`。

> 增强(可选,不进本期):换 `qwen3-tts-instruct-flash` + `instructions`(如"温柔知性的女性,语速偏慢,适合有声书朗读")做语气控制。instruct 版需额外开通、且要逐字调指令,本期先用稳定版 Cherry 把链路跑通,评审若反馈音色不对再升级。

## 四、缓存策略（关键）

百炼返回的音频 URL **24 小时失效**。老人隔天再想听就听不了。因此云函数必须:

```
请求 storyId
  → 查 story.ttsFileID 是否已缓存
    有 → 直接返回 fileID（0 成本,即时播）
    无 → 读 story.content → 调 Qwen-TTS 合成 → 拿 url
         → 下载音频 → 上传云存储 → 写 story.ttsFileID → 返回 fileID
```

存云存储 fileID 是**永久**的。故事正文不变,合成一次即可,后续任意次数播放都走缓存。这比直接用百炼 URL(24h 失效)干净得多。

## 五、前端交互

故事页(view 模式)正文上方放"朗读"按钮:

- 首次点击:按钮转"朗读中…",loading 遮罩;云函数返回 fileID 后 `createInnerAudioContext` 自动开始播放。
- 已缓存(`story.ttsFileID` 已存在):点击即时播放,无 loading。
- 播放中按钮变"暂停",再点暂停;播完自动复位为"朗读"。
- 失败:友好 toast"朗读暂时不可用",真实错误进 console。

音频格式:Qwen-TTS 非流式返回 wav,微信 `InnerAudioContext` 原生支持。

## 六、字号上调清单

实现时逐项定位上调,原则是不动主正文(34rpx 已达标),只补小字:

- 关系图节点名:约 12px → ≥16px(canvas 绘制)
- 各页辅助/提示文字 28-30rpx → 32-34rpx(类 `.topics-cap`、`.dialect-pick`、`.empty-hint` 等)
- 触摸目标已普遍 88rpx 达标,无需动

## 七、风险与对策

| 风险 | 对策 |
|------|------|
| 用户未在百炼开通 qwen3-tts-flash 模型 | 云函数报错时 console 记录 errCode/errMsg,前端统一 toast;plan 验证项里含"百炼开通模型" |
| Cherry 音色偏轻快、不够沉稳 | 本期先跑通链路;反馈不佳再升级 instruct 版指令控制 |
| 故事正文超长合成慢/超限 | 单篇约 800 字,远低于 Qwen-TTS 上限;loading 遮罩兜底等待 |
| 音频 URL 24h 失效 | 必须下载存云存储 fileID,永不依赖临时 URL |
| 朗读中途退出页面音频继续响 | 页面 onUnload 时 `innerAudioContext.stop()` 释放 |
