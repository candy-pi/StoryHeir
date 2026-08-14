# 传家志 · 人物关系图重构设计

日期：2026-07-23
关联主项目：`2026-07-21-chuanjiazhi-design.md`

## 背景与问题
故事详情页 `pages/story` 的人物关系图目前是纯 canvas 2d 手绘：人物等分圆周排布、实心圆节点（半径 `R=34`）+ 直线 + 中点标签，节点和边都无任何交互。
用户反馈三点：① 视觉单一、不够精致；② 节点太大影响观感；③ 想点一条边看到那两个人的互动。

## 方案决策（已与用户确认）
1. **画法**：迁移到 `echarts-for-weixin` 的 force（力导向）图，替掉 `drawGraph`。
2. **互动内容**：不新增 AI 生成、**不改 genStory**；点边弹出「关系名 + 两人在正文里共同出现的情节片段」。
3. **节点**：缩小 symbolSize。

## 数据契约（零后端改动）
- 输入仍为 `story.persons:[{id,name}]`、`story.relations:[{from,to,label}]`、`story.content`。
- 「共同情节」前端现算：把 `content` 按句切，筛出同时包含两人称呼的句子，取前 3 条；没有则兜底提示「故事里没有特别写到他俩的同框情节」。

## 交互
- 点边：弹底部卡片 ＝「A 与 B」+ 关系名 + 共同情节片段列表 + 关闭。
- 力导向自带动效、节点可拖拽、双指缩放平移，借此解决"单一死板"的观感。

## 视觉
- 节点 symbolSize 约 28（原 `R=34` → 缩小），label 显示称呼，字号 12；带轻阴影提升精致感。
- 边：曲线 `curveness 0.1`，颜色 `#C9B79C`，边标签用 echarts edgeLabel + 胶囊背景显示关系名。
- 配色沿用适老化体系：节点 `#A0522D`、字 `#2B2218`、底 `#FBF7F0`。

## 文件改动
- 新增 `miniprogram/components/ec-canvas/`（echarts-for-weixin 组件，含 `echarts.js`）
- 改 `pages/story/story.json`：注册 `ec-canvas`
- 改 `pages/story/story.wxml`：`<canvas>` → `<ec-canvas>`；新增关系弹层结构
- 改 `pages/story/story.wxss`：弹层样式 + 画布高度
- 改 `pages/story/story.js`：`drawGraph` → `initEcharts`（force option + 点边事件 + 共同情节提取）

## 风险与权衡
- `echarts.js` 约 700KB+，主包会变大；已开 `lazyCodeLoading: requiredComponents` 按需注入缓解，后续可做 echarts 自定义构建裁剪。
- echarts-for-weixin 的 `ec-canvas/` 与 `echarts.js`（构建产物，无法手写）需从官方仓库获取，执行时优先 git 拉取，失败则手动放置。
- 力导向布局带随机性，但人物 ≤6 时稳定可控；以 id 串联节点避免重名错连。
