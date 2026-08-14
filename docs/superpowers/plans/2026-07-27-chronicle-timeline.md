# 传家志 · 家族时间线视图 执行计划

日期：2026-07-27
对应设计：`2026-07-27-chronicle-timeline-design.md`

## 任务

- [x] 1. `chronicle.js`：增强 `parseYear`——四位(19xx/20xx)→中文年代词("八十年代"/"80年代"取首年)→两位("89年"/"89"，≥24 补 19xx 否则 20xx)→回退 createdAt。所有分支用中文注释说明判定意图。
- [x] 2. `chronicle.js`：`loadChronicle` 在归一化出 `items` 后，构造 `timeline` 数组——按年份升序、年代不详排末，每项 `{ _id, title, yearText, photoFileID, year }`，yearText 用 era 原文兜底"年代不详"；挂到 `book.timeline`。
- [x] 3. `chronicle.wxml`：封面(book-cover)下方插入横向时间线区块——`scroll-view scroll-x scroll-with-animation` + 横线 + `wx:for` 节点，节点 `bindtap="goToStory" data-id`，复用既有跳转。
- [x] 4. `chronicle.wxss`：时间线样式——白底圆角卡片容器、`#C9B79C` 横线、`#A0522D` 圆点带白边阴影、年份标签与标题截断、节点固定宽度横向排列；隐藏滚动条。
- [ ] 5. 本地编译验证（用户在微信开发者工具执行）：① 时间线横向可拨动；② 节点按年份升序、模糊年份("89年"/"八十年代初")正确归位而非落到"岁月留痕"；③ 点节点跳到故事详情；④ 下方分章卡片仍正常。
- [ ] 6. 退化验证：只有 0-1 篇故事时时间线区块不报错、合理展示；年代全不详时全部排末尾。
