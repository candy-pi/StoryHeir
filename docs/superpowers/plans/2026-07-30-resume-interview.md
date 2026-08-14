# 传家志 · 继续采访完善故事（续访）执行计划

- 设计见 `specs/2026-07-30-resume-interview-design.md`
- 铁律：改完真机验证，确认更优才采用；不通过调整/回退
- 前置：①②③ 已改的 genStory/chat 改动与新改动叠加，部署时一起上传

## chat：三要素 + 续访引导
- [x] 1. SYSTEM_PROMPT 加故事三要素（人物/情节/环境）引导，措辞自然不填表
- [x] 2. 新增 `withResume(sys)`；main 解构 `resume`，透传到 generateText/chatWithValidation；续访首轮 system 注入「承接上文 + 三要素薄弱处追问」

## genStory：支持更新原故事
- [x] 3. 支持 `storyId` 参数：有则 `update` 原 story（content/title/era/persons/relations），无则 `add`（现状不变）
- [x] 4. 续访时 update 原 interview 的 messages 为完整 history（原+新），保留可追溯

## interview.js：续访入口与首轮
- [x] 5. onLoad 支持 `options.storyId`：拉原 story → 预填 messages（原对话，去 loading）+ 存 `this.storyId` / `this.isResume` / photoFileID
- [x] 6. `_askAI(history, resume)` 透传 resume；续访 onLoad 末尾自动触发首轮 `chat({history:原, resume:true})`
- [x] 7. onGenStory 续访模式：genStory 传 `storyId` → update；返回原故事页并就地刷新（`_loadFromCloud` + `navigateBack`）

## story 页：入口按钮
- [x] 8. story.wxml/js 查看模式加「继续完善这个故事」按钮，`navigateTo interview?storyId=`（非作者 update 失败时友好提示「仅作者可完善」）

## 验证（真机）
- [ ] 9. 点续访 → 见原对话 + AI 接续追问（承接、不破冰）
- [ ] 10. 续访讲 2~3 轮，AI 追问体现三要素薄弱处
- [ ] 11. 生成后故事更新更完整，人物/关系图同步；原 interview 保留完整对话
