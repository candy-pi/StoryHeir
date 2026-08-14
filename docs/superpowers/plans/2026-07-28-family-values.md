# 传家志 · 家风提取(Family Values)执行计划

- 对应设计:`docs/superpowers/specs/2026-07-28-family-values-design.md`
- 原则:独立模块,不碰 chat/asr/genStory/restore 现有逻辑(只**读** story);新增 familyValue 集合 + extractValues 云函数 + 首页家风墙。
- 风格对齐:云函数 wx-server-sdk + node-fetch + 百炼 compatible-mode + thinking disabled + JSON 兜底解析 + `{code,data}` 返回。

## 数据模型(familyValue 集合)

```js
{ _id, _openid, value:"诚信", count, quotes:[{text,title}], sources:[{storyId,title}], createdAt }
```
- 按 `value`(关键词)归并:同一价值观在多篇出现,count++、收集 quotes(配对原句+出处)与 sources(故事列表)。
- 权限:建议"所有用户可读"(家风需展示);写由云函数代写(与 story 一致)。

## 涉及文件

| 类型 | 文件 |
|------|------|
| 新增 | `cloudfunctions/extractValues/{index.js,package.json}` |
| 新增 | `familyValue` 集合(云开发控制台手动建 + 配权限) |
| 改 | `miniprogram/config.js`(cloudFns 加 `extractValues`) |
| 改 | `miniprogram/pages/index/{index.js,index.wxml,index.wxss}`(家风墙 + 刷新) |
| 改 | `miniprogram/pages/chronicle/{chronicle.js,chronicle.wxml,chronicle.wxss}`(封面家风行) |
| 不碰 | chat / asr / genStory / restore / 现有 story 流程 |

## 执行顺序与任务

### 阶段 1 · 数据与云函数
- [ ] 1. 云开发控制台建 `familyValue` 集合,权限设"所有用户可读,仅创建者可写"(**需你在控制台手动操作**,代码无法建集合)
- [x] 2. `extractValues/package.json`:依赖 `wx-server-sdk` + `node-fetch`(照 genStory 抄)
- [x] 3. `extractValues/index.js`:分页拉 story → 摘要喂 GLM → JSON 兜底解析 → 归并(count/quotes/sources)→ 清旧重写 → `{code,data}` 返回

### 阶段 2 · 前端配置
- [x] 4. `config.js` 的 `cloudFns` 加 `extractValues: 'extractValues'`

### 阶段 3 · 首页家风墙
- [x] 5. `index.js`:data 加 values/valuesLoaded/valuePop;loadValues;onRefreshValues;onTapValue/closeValuePop;onShow+下拉顺带 loadValues
- [x] 6. `index.wxml`:hero 下家风墙(标签 size-lg/md/sm)+ 刷新按钮 + 点标签弹层
- [x] 7. `index.wxss`:家风墙 + 标签三档字号 + 弹层样式(配色对齐,对比度 ≥4.5:1)

### 阶段 4 · 编年志家风行
- [x] 8. `chronicle.js`:loadValues(limit 8)→ valuesText;onLoad + 下拉顺带
- [x] 9. `chronicle.wxml/wxss`:封面 book-slogan 下加「家风 · …」行(有值才显示)

### 阶段 5 · 验证(需真机/数据)
- [ ] 10. 部署 extractValues 云函数(上传并部署:云端安装依赖)+ 配 DASHSCOPE_API_KEY
- [ ] 11. 录入/已存在含"做人要诚信""吃亏是福"的故事 → 点刷新家风 → 家风墙正确出现、标签随频次变大
- [ ] 12. 点标签 → 弹层显示原句 + 出处故事(quotes 已配对 title,不错位)
- [ ] 13. 无故事时家风区降级(显示"先记录几段家事");编年志无家风时封面不显示家风行

## 实现修正记录
- **证据门槛(多篇印证)**:家风需多篇故事共同印证才算。prompt 要求每条列出所有印证故事(storyIds≥2)+限 3-5 条;代码层硬过滤 count<2 的个例(单篇主题不算家风)。count 来源从"模型单给 storyId 再聚合"改为"模型直接给 storyIds 数组",计数更准;故事少/无共识时返回空 + 友好 message。
- **近义归并(prompt 级)**:模型逐故事抽取会产生「念师恩/念亲恩/念旧物/记情分/记恩情」这类语义重复。改 prompt 要求「先抽再脑内归并」、value 用概括性词(2-4字)、最终 3-6 条、给正反例(念师恩→知恩图报)。纯 prompt 归并,不引入近义词表。
- **quotes 配对**:原计划 quotes/sources 两个独立数组,弹层按下标配对会错位。实现时改为 quotes 存 `{text,title}` 配对,sources 仅作故事列表。已在云函数 + 弹层同步修正。

## 关键决策(已定)

- **触发用"刷新家风"按钮全量重算**(简单可靠,故事少成本低);genStory 后增量抽取标为后续优化,不在本期。
- **归并用清旧重写**(每次刷新先清该用户 familyValue 再写),避免增量去重的复杂度;MVP 可接受。
- **近义合并用 prompt 完成**(不建近义词表):模型先抽再归并,value 用概括性词、最终 3-6 条、给正反例。若后续仍有重复,再考虑两步法或人工词表。
- **count 影响字号**:映射三档(font-size),纯 flex,省事且兼容。

## 风险关注

| 风险 | 对策 |
|------|------|
| 价值观抽取主观/硬凑 | prompt 强约束 + 带原句出处可人工校验 |
| JSON 解析失败 | 剥离 ```json + 正则兜底(同 genStory) |
| story 多时全量重算慢 | 取最近 30 篇 + 摘要只取前 300 字;前端 loading |
| familyValue 集合未建/未开读权限 | 云函数 try/catch 返回明确 message;前端 catch 静默降级 |

## 验收标准

1. 首页出现家风墙,标签随 count 大小变化。
2. 刷新家风按钮能重算并更新墙。
3. 点标签看原句出处(配对正确)。
4. 编年志封面下显示家风行(有值时)。
5. 现有访谈/生成/编年志流程不受影响(只读 story,不改其结构)。
