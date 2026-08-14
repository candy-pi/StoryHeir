# 传家志 · AI 记者化执行计划

- 设计见 `specs/2026-07-29-ai-journalist-design.md`
- 铁律：**每个改进过案例测试、确认更优才采用**；不通过回退

## 改进①：故事引用原话
- [x] 1. genStory：SYSTEM_BASE 第 1 条加「」引用原话硬规则（三风格通用）；documentary desc 去重复
- [x] 2. 写测试脚本 `tests/genstory-quote-test.js`（内置访谈案例 + 新旧 prompt 并排对比，用户填 key 跑）
- [ ] 3. 【用户】跑脚本，贴新旧输出；新版引用原话且更生动 → 通过则采用（代码已改），不通过则调 prompt / 回退

## 改进②：照片主动提问（① 验证通过后启动）
- [x] 4. chat `visionOpening` 改造：VL 看图返回 `{开场提问, 照片线索[]}`；线索只描述照片确有之物
- [x] 5. chat 后续轮次 system 注入"照片观察线索"，引导 GLM 主动追问
- [x] 6. interview.js：首轮拿回线索缓存，后续 `_askAI` 带上
- [ ] 7. 【用户】真机用有细节的老照片走完整访谈，确认 VL 抽 ≥2 真实线索 + 后续主动追问 ≥1 条

## 改进③：关系图只放出场人物（讲述者不在场则不纳入）
- [x] 8. genStory SYSTEM_BASE 第 2 条加规则：persons 只放事件中真正出场的人；讲述者"我"仅在有戏份时纳入，转述他人、自己未出场则不纳入
- [x] 9. 写测试脚本 `tests/genstory-persons-test.js`（"转述爷爷进厂"案例 + 新旧 prompt 对比 persons/relations）
- [x] 10. 【用户】验证通过：新版 persons 只剩爷爷/王师傅、无"我→爷爷"硬造关系 → 采用

## 验收备忘
- 测试脚本零依赖（Node 18+ 内置 fetch）：`export DASHSCOPE_API_KEY=你的key && node tests/genstory-quote-test.js`
- 脚本绝不硬编码 key，只读 env；用你百炼控制台自己的 key，跑完别外传
