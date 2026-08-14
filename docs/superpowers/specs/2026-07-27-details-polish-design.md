# 传家志 细节打磨设计

- 日期:2026-07-27
- 范围:骨架屏加载 / 下拉刷新 / 录音反馈 / 编年志年代色调
- 约束:不新增业务功能、云函数、数据模型、页面;允许小幅 js 表现层改动(交互钩子 `onPullDownRefresh`、`setData` 标志、数据加渲染字段)。**不碰录音格式与 ASR 链路**

---

## 一、骨架屏加载

**现状**:加载中 chronicle 显示"正在翻开…"文字,index/story 加载中空白或闪现"还没有故事",不够稳。

**方案**:骨架占位(灰条 + shimmer 扫光)替代文字/空白,数据就绪后淡出。
- **chronicle**:已有 `ready` 字段,`ready=false` 时渲染骨架(封面占位 + 时间线几点占位 + 章节灰条)。**纯 wxml/wxss**。
- **index**:js 加 `loading` 字段(`loadStories` 前后切换),`loading` 时渲染 3 张故事卡骨架。
- **story**:js 加 `loading` 字段;`story` 未到且 `loading` 时渲染标题+正文骨架;`loading=false` 且 `story=null` 才算真空态。

**改动**:chronicle 纯 wxml/wxss;index.js / story.js 各加一个 `loading` 字段 + 两处 `setData`。

## 二、下拉刷新

**现状**:补了新故事,老人不知道要退出重进才能看到。

**方案**:index、chronicle 开启下拉刷新。
- 页面 json 加 `enablePullDownRefresh: true`、`backgroundTextStyle: dark`
- js 加 `onPullDownRefresh`:`await` 已有加载方法 + `wx.stopPullDownRefresh()`

**改动**:index.json / chronicle.json + index.js / chronicle.js 各加一个钩子。

## 三、录音反馈增强

**现状**:录音中仅换色 + 脉动,老人讲小声时不确定有没有录进去。

**关键限制**:**真实音量波形不可行**——当前 `format=mp3`,而 `onFrameRecord` 只在 `pcm` 回调帧数据;改 pcm 会动 ASR 链路,不做。

**退方案**:录音中显示**时长计时(00:00 起递增)** + 强化"正在录音"状态 + 保留脉动。老人能看到录了多久、确认在录。
- interview.js:录音开始 `setInterval` 每秒 `setData recordTime`;停止/出错 `clearInterval` 清零。
- wxml:状态区显示 `{{recordTime}}`;wxss 计时数字样式。

**改动**:interview.js 加计时逻辑 + wxml/wxss。

## 四、编年志年代色调

**现状**:各年代章节视觉同质,翻阅缺时间纵深感。

**方案**:按年代给章标题配代表色(左边框 + 年代名),如 40 年代沉褐、60 年代青灰、80 年代暖黄、年代不详银灰。
- chronicle.js `loadChronicle` 给每个 `chapter` 加 `toneClass`(decade → 色档映射)。
- wxss 定义几档 `.tone-*`;wxml `chapter-head` 加 `{{ch.toneClass}}`。

**改动**:chronicle.js 加映射 + wxss + wxml class。

---

## 五、影响面与风险

- **改**:`app.wxss`(骨架通用样式)、index/interview/story/chronicle 的 js(小)+ wxml+wxss、index/chronicle 的 json
- **不碰**:云函数、数据模型、录音格式、ASR/上色/AI 链路、`utils/api.js`
- **风险**:低;`onPullDownRefresh`/`setData`/`setInterval` 均原生能力。计时 interval 在 `onStop`/`onError` 确保清理,防泄漏。
