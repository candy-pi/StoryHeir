# 传家志 · 编年志成册海报 执行计划

- 设计见 `specs/2026-07-31-chronicle-poster-design.md`
- 铁律：改完真机/工具预览验证更优才采用
- 范围方向：**A 概览海报**（已定）

## 入口与数据
- [x] 1. `chronicle.wxml` 底部加「做成海报分享」按钮 + 隐藏 canvas 2d 节点
- [x] 2. `chronicle.js` 复用 `this.data.book` + `valuesText`，不重新拉数据

## canvas 绘制
- [x] 3. `chronicle.js` 新增 `drawPoster()`：dpr 限2、高度随章节伸缩；封面区(红棕底白字+印章+书名+家风+slogan) + 金线分隔 + 卷目区(米底各年代篇数) + 落款；家风超长 measureText 截断兜底
- [x] 4. `wx.canvasToTempFilePath` 导出临时图

## 出口
- [x] 5. `wx.showShareImageMenu` 直接弹分享图片菜单（发聊天/朋友圈）；previewImage 兜底
- [x] 6. loading / 失败 toast 兜底

## 验收（真机/工具预览）
- [ ] 7. 【用户】点「做成海报分享」→ 海报生成 → 弹微信分享菜单，能发聊天/朋友圈
- [ ] 8. 【用户】海报版式美观、文字完整、红棕封面+米底卷目与编年志页风格一致
