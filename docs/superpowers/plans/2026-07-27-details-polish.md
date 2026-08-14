# 传家志 细节打磨 · 执行计划

- 对应设计:`docs/superpowers/specs/2026-07-27-details-polish-design.md`
- 原则:不新增业务功能;允许小幅 js 表现层改动,不碰云函数/数据模型/录音链路

## 任务清单

- [x] 1. **app.wxss 加骨架通用样式**:`.skel` 灰条 + `@keyframes shimmer` 扫光
- [x] 2. **chronicle 骨架屏**:纯 wxml/wxss,`ready=false` 时渲染封面/时间线/章节占位
- [x] 3. **index 骨架屏**:js 加 `loading` 字段 + 渲染 3 张故事卡骨架
- [x] 4. **story 骨架屏**:js 加 `loading` 字段 + 渲染标题/正文骨架;真无故事才显空态
- [x] 5. **下拉刷新**:index/chronicle.json 开启 + js 加 `onPullDownRefresh`
- [x] 6. **录音计时反馈**:interview.js `setInterval` 计时(停止/出错清理)+ wxml/wxss
- [x] 7. **编年志年代色调**:chronicle.js 加 `toneClass` 映射 + wxss 色档 + wxml
- [x] 8. **自检**:编译预览各加载态 / 下拉 / 录音计时 / 年代色
