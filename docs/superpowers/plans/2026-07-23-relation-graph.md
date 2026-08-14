# 传家志 · 人物关系图重构 执行计划

日期：2026-07-23
对应设计：`2026-07-23-relation-graph-design.md`

## 任务

- [x] 1. 引入 ec-canvas 组件：获取 echarts-for-weixin 的 `ec-canvas/` 目录与 `echarts.js`，放入 `miniprogram/components/ec-canvas/`
- [x] 2. `story.json` 注册 `usingComponents: { "ec-canvas": "../../components/ec-canvas/ec-canvas" }`
- [x] 3. `story.wxml`：`<canvas>` 换成 `<ec-canvas ec="{{ec}}" />`；新增点边弹层（A 与 B / 关系名 / 共同情节列表 / 关闭）
- [x] 4. `story.wxss`：关系弹层样式（遮罩 + 卡片，适老化配色）；画布高度配合力导向调整（480→520rpx）
- [x] 5. `story.js`：`drawGraph` → `initEcharts`；force graph option（节点 symbolSize≈28、曲线边、关系标签、配色与阴影）；`chart.on('click')` 捕获 edge，取两人 + 共同情节，`setData` 弹层
- [x] 6. `story.js`：共同情节提取函数 `coMention(content, aName, bName)`（按句切、含两名筛选、取前 3）
- [ ] 7. 本地编译验证：关系图渲染、节点变小、拖拽/缩放正常、点边弹层正确显示关系名与情节（待用户在微信开发者工具编译）
- [ ] 8. 验证无共同情节时弹层兜底文案正常（待用户编译时一并验证）
