# 传家志 · 访谈体验改进执行计划（话题脚手架 + 录音保护）

- 原则:**纯前端**,零云函数部署。话题 chip 本质是预填一条 user 消息,复用现有 chat 链路。
- 设计见 `docs/superpowers/specs/2026-07-29-interview-topics-design.md`。

## 一、话题库

8 个家常话题,label 是 chip 显示词,text 是点击后替老人发出的完整话术:

| label | text |
|-------|------|
| 童年往事 | 我想讲讲小时候的事 |
| 父母亲 | 我想讲讲我的父亲母亲 |
| 老伙计 | 我想讲讲一个老伙计 |
| 第一份工 | 我想讲讲我第一份工作 |
| 过年 | 我想讲讲从前过年的样子 |
| 老房子 | 我想讲讲我们家的老房子 |
| 出远门 | 我想讲讲第一次出远门 |
| 心里话 | 我有些话想留给后人 |

## 二、任务清单

### 阶段 1 · 前端实现
- [x] 1. `interview.js`:data 加 `topics`(上表 8 项);`onPickTopic`(push user 消息 → `_askAI`);`_onRecordStop` 加 `recordTime<2` 短录音保护
- [x] 2. `interview.wxml`:启动区(`start-bar`)下加话题 chip 行,条件 `!photoTempPath && messages.length===0`
- [x] 3. `interview.wxss`:`.topics` / `.topic-chip` 胶囊样式(白底浅边、赭石系、scroll-x 横滑、88rpx 触摸高、对比度达标)

### 阶段 2 · 验证（需用户）
- [ ] 4. 真机:无照片进访谈页 → 看到话题 chip → 点一个 → 老人气泡 + AI 顺着问
- [ ] 5. 真机:选照片 / 开始对话后 chip 消失;录音不足 2 秒提示"太短啦"
- [ ] 6. 真机:正常录音、文字输入、生成故事不受影响

## 三、风险与对策

| 风险 | 对策 |
|------|------|
| 话题话术太泛 AI 接不住 | 话术明确指向一类家事,Validator 会兜底要求"够具体" |
| chip 横滑滚不到最后一个 | scroll-view 默认可滚;胶囊用 inline-block + nowrap |
| 误触话题连点 | `onPickTopic` 开头判 `busy`,且一点即 push 消息、messages 非空后 chip 自动隐藏 |
| 录音计时与实际略有误差 | 阈值 2 秒偏保守,宁可多提示一次也不空跑识别 |
