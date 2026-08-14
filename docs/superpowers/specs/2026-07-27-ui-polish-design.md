# 传家志 UI/UX 整体优化设计

- 日期:2026-07-27
- 依据:`miniprogram-ui-ux-design` skill(5 设计铁律 / Top5 反模式 / Pre-Build 检查清单)
- 范围:全局 `app.wxss` + 4 页(index / interview / story / chronicle)
- 硬约束:**功能与数据流零改动**,仅 wxml/wxss 表现层;遵守"最简安全、杜绝过度工程"

---

## 一、设计基线(已有,保留不推翻)

| 项 | 现值 | 评价 |
|---|---|---|
| 主色 | `#A0522D` 赭石红棕 | 沉稳有传承感,保留 |
| 正文 | `#2B2218` 墨褐 on `#FBF7F0` 暖米 | 对比足,保留 |
| 基础字号 | 34rpx、行高 1.7 | 适老化放大,保留 |
| 按钮 | 104rpx 高、52rpx 圆角 | 远超 88rpx 下限,保留 |
| 字体/布局 | 系统字体栈、Flexbox、纯 rpx | 符合铁律,保留 |

方向正确,本次只补无障碍/反馈的漏、收敛一致性,**不做大重构**。

---

## 二、审查发现(按 skill 铁律逐条对照)

### A. 缺陷类(影响无障碍/可用性,必须修)

**A1. 对比度不足(铁律 1:正文 ≥4.5:1)**
- 次要灰 `#a89b88` 被大量用于正文级文字(story-meta / empty-hint / contrib-time / typing / story-item-meta),对 `#FBF7F0` 与 `#fff` 实测约 2.x:1,**低于正文 4.5:1 下限**——老人视力本就下降,最该修。
- 共建标签 `.contrib-tag-correct`(`#c08055`)/ `.contrib-tag-identify`(`#8a7a66`)背景偏浅 + 白字,小字(24rpx)对比约 3:1,不达标。

**A2. 触摸目标 <88rpx(铁律 5:≥88rpx)**
- `.mode-tab` 实高约 62rpx、`.type-btn` 80rpx,均**低于无障碍下限**。
- `.demo-link` / `.chron-link` 纯文字无 padding 热区,老人易点偏。

**A3. 缺交互反馈(铁律 4:每个操作必须有即时反馈)**
- 全站可点元素(卡片、tab、按钮、时间线节点、链接)**无按压态**,老人无法确认"点上了没"。
- 录音中 `.record-btn` 仅换色,**无脉动**,老人不确定是否正在录。

**A4. 加载态空白(铁律 4 / Pre-Build"所有交互状态已设计")**
- chronicle(`ready=false`)、story(`story` 未到)、index(list 拉取中)加载时**页面纯白**,像卡死。

### B. 一致性类(轻量收敛)

**B1.** `story.wxml` 照片区/上色按钮**内联 `style="..."`**(skill 反模式,难维护),抽成 class。
**B2.** 圆角档位过多(16/20/24/28/32/52),机会合适时收敛——收益小,列为可选。

### C. 可选增强(默认不做,需用户勾选)

- C1. Design Token CSS 变量化(集中色值):skill 核心方法论,但全量替换 5 文件 diff 大、风险高,**与"最简安全"冲突,默认不做**。
- C2. 暗黑模式 `@media prefers-color-scheme`:适老化场景浅色优先,默认不做。
- C3. hero / 封面装饰(印章、分隔线):视觉增强,默认不做。

---

## 三、优化方案(对应 A1–A4 + B1)

| # | 改动 | 落点 |
|---|---|---|
| 1 | 次要灰 `#a89b88` 加深至对比度 ≥4.5:1(推荐 `#6e6354`,实现后用对比度工具复核);标签 correct/identify 背景加深至白字达标 | `app.wxss` + 各页 wxss |
| 2 | `.mode-tab` / `.type-btn` 加高到 ≥88rpx;`.demo-link` / `.chron-link` 加 padding 热区 | interview / index wxss |
| 3 | 全站可点元素加 `hover-class` 按压态(`transform:scale(0.97)`,0.15s,只动 transform/opacity) | 各页 wxml+wxss |
| 4 | chronicle/story/index 加载中显示文字提示而非空白 | 各页 wxml(增 `wx:if` 分支,不动 js) |
| 5 | `.record-btn` 录音中加 pulse 光圈(`@keyframes`,GPU 友好) | interview wxss |
| 6 | `story.wxml` 内联 style 抽成 `.story-photo` / `.colorize-hint` 等 class | story wxml+wxss |

---

## 四、影响面与风险

- **改**:`app.wxss`、`index/interview/story/chronicle.wxss`、`story.wxml`(去内联)、其余 wxml 仅加 `hover-class` 属性。
- **不动**:所有 `.js`(逻辑/数据/绑定)、wxml 结构与 `bind*` 绑定、数据字段、云函数。
- **风险**:`hover-class` 与 `@keyframes` 均小程序原生能力,基础库 2.x+ 全支持,无兼容问题。对比度数值在实现阶段用脚本计算 luminance 复核,确保达标。
