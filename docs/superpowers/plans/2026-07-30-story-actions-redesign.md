# 传家志 · 故事页操作区重设计 执行计划

- 设计见 `specs/2026-07-30-story-actions-redesign-design.md`
- 铁律：改完真机/工具预览验证更优才采用
- 排版方向：**A 分层底部**（已定）

## 公共改动（全站修截断）
- [x] 1. `app.wxss`：`.btn-primary` / `.btn-secondary` 加 `box-sizing: border-box; padding: 0 24rpx;`
- [ ] 2. 【用户】开发者工具预览抽查 index / interview / chronicle 长按钮文字不再截断

## story 页操作区重排（方案 A 分层底部）
- [x] 3. `story.wxml` 重组底部：续访=主按钮独占一行；朗读+分享移到底部、描边并排；删正文上方朗读按钮；编辑/删除保持文字链接
- [x] 4. `story.wxss` 新增 `.btn-ghost`（描边次按钮）/ `.action-row`（并排）/ `.story-actions`，沿用现有 token
- [ ] 5. 【用户】预览核对：主次分明、无实心墙、按钮文字完整、对比度达标

## 验收
- [ ] 6. 【用户】所有长文案（继续完善这个故事 / 让这张老照片变彩色 / 分享到家族群）完整显示
- [ ] 7. 【用户】底部有清晰主次层级，不再是一堵实心墙
