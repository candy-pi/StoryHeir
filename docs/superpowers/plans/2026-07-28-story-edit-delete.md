# 传家志 · 故事删除与编辑执行计划

- 原则:**纯前端 + 云数据库直写**(删/改都是创建者自己的记录,集合权限"仅创建者可写"允许前端直接 remove/update),不新增云函数。
- 范围:删除整篇故事 + 编辑标题与正文。**不做**人物关系编辑(错了可重新生成)、不做重新生成。

## 一、删除

- **入口**:story 页底部操作行(查看模式)
- **流程**:点删除 → `wx.showModal` 二次确认(文案"删除后不可恢复")→ 确认后:
  - `db.story.doc(id).remove()`
  - 关联清理:`story.interviewId` 存在则 `db.interview.doc(interviewId).remove()`(访谈原文,自己的可删;失败忽略)
  - `contribution` **留 orphan**(故事删了补充自然看不到;且别人写的补充前端无权删)
  - `familyValue` 不动(全局提炼,下次刷新家风自动重算)
- **返回刷新**:`wx.navigateBack()`;从分享打开(页面栈≤1)时 `reLaunch` 到 `/pages/index/index`。index `onShow` 已会 `loadStories`,列表自动刷新

## 二、编辑标题+正文

- **入口**:story 页底部操作行「编辑」
- **编辑模式**:标题→`input`,正文→`textarea`,底部→「保存 / 取消」(其余区块隐藏,聚焦改文字)
- **保存**:`db.story.doc(id).update({ data:{ title, content } })` → 更新 `story` 数据、退出编辑模式;关系图未动(persons/relations 没变)无需重画
- **取消**:丢弃改动,退出编辑模式
- **前提**:需 `this.storyId`(从列表/分享带 id 打开)。本地 storage 兜底的无 id 故事,提示"请从故事列表打开"

## 三、权限与边界

- story / interview 集合权限须为「仅创建者可写」(现状已是)
- 非创建者(经分享链接打开)点编辑/删除:前端 update/remove 会失败 → catch 提示「只有故事作者能修改或删除」
- 误删:`showModal` 二次确认兜底

## 四、涉及文件

| 类型 | 文件 |
|------|------|
| 改 | `miniprogram/pages/story/story.js`(data 加 editing/editTitle/editContent;onDelete/onEdit/onCancelEdit/onSaveEdit/onTitleInput/onEditInput) |
| 改 | `miniprogram/pages/story/story.wxml`(标题/正文查看⇄编辑态切换;底部操作行:查看显 编辑/删除,编辑显 保存/取消) |
| 改 | `miniprogram/pages/story/story.wxss`(编辑控件 input/textarea + 操作行样式,对齐现有按钮风格) |
| 不碰 | 云函数 / genStory / chat / 关系图绘制逻辑 / 家人共建 |

## 五、任务清单

### 阶段 1 · 前端实现
- [x] 1. `story.js`:data 加 `editing/editTitle/editContent`;`onDelete`(确认 → 删 story + 删 interview → 返回/回首页);`onEdit/onCancelEdit/onSaveEdit/onTitleInput/onEditInput`
- [x] 2. `story.wxml`:标题/正文查看⇄编辑态切换;底部操作行(查看:编辑/删除;编辑:保存/取消,其余区块编辑态隐藏)
- [x] 3. `story.wxss`:`.story-ops` 操作行 + 编辑态 `.edit-title`/`.edit-content` 样式(对齐赭石主色、rpx、对比度)

### 阶段 2 · 验证(需用户)
- [ ] 4. 真机:删除一篇 → 确认 → 列表里消失、回看打不开
- [ ] 5. 真机:编辑标题+正文 → 保存 → 刷新仍是改后内容;取消则不保存
- [ ] 6. 真机:关系图 / 上色 / 分享 / 家人共建等其他功能不受影响

## 六、风险与对策

| 风险 | 对策 |
|------|------|
| 误删好故事 | `showModal` 二次确认 + "不可恢复"文案 |
| contribution orphan | 留;故事删了用户看不到,无害 |
| 非创建者改/删 | 权限拦截 + catch 友好提示 |
| 无 id(本地 storage 故事) | 检查 `storyId`,无则提示从列表打开 |
| 编辑后关系图空白 | persons/relations 未变,不重画;编辑态隐藏 graph-card 不影响(切回时数据仍在) |

## 七、验收标准

1. 删除:确认后故事从列表消失,关联访谈一并删除。
2. 编辑:改标题/正文,保存后刷新仍是改后内容;取消不保存。
3. 非创建者点编辑/删除,提示无权。
4. 关系图 / 上色 / 分享 / 家人共建等不受影响。
