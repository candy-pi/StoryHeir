// 验证「关系图只放故事里出场的人」改进：同一段"转述爷爷、自己没出场"的访谈，
// 用新旧两版 prompt 各生成一次，并排对比 persons / relations。
//
// 用法（Node 18+，需内置 fetch）：
//   export DASHSCOPE_API_KEY=你的百炼key
//   node tests/genstory-persons-test.js
//
// 判别：新版 persons 不应再塞讲述者"我"（也不该有"我→爷爷"的硬造关系），
//       只剩故事事件里真正出场的人（爷爷、王师傅）。旧版常会把"我"当人物。

const API_KEY = process.env.DASHSCOPE_API_KEY
const MODEL = process.env.DASHSCOPE_MODEL || 'glm-5.2'
const BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'

if (!API_KEY) {
  console.error('请先设置环境变量 DASHSCOPE_API_KEY（你百炼控制台的 key）')
  process.exit(1)
}

// 转述型访谈：讲述者全程"我爷爷 / 他"，自己没在 1972 年进厂事件里出场。
// transcript 会把这些 user 回答标成"我："——正是诱导"我"进关系图的源头。
const HISTORY = [
  { role: 'assistant', text: '您想讲讲谁的故事？' },
  { role: 'user', text: '我想讲讲我爷爷。我爷爷 1972 年从苏北乡下来上海，进了第七纺织厂当学徒。' },
  { role: 'assistant', text: '爷爷在厂里过得怎么样？' },
  { role: 'user', text: '车间机器轰隆隆响。带他的是王师傅，上海本地人，技术好脾气倔，手把手教他接头、换纱。' },
  { role: 'assistant', text: '王师傅对爷爷很重要吧？' },
  { role: 'user', text: '那当然，没有王师傅，爷爷哪能在厂里站稳脚跟。后来厂子改制，王师傅退休回了虹口，断了联系。' }
]

const WARM = '把它整理成一篇温暖有情的家族故事：细腻、有画面感、带温度，像家人围炉夜话般娓娓道来。'

// 旧版第 2 条（= 改动前）
const TASK2_OLD = '2. 抽取故事中的主要人物（不超过 6 个）以及人物之间的关系。'

// 新版第 2 条（= 改动后：加"只放出场人物、讲述者不在场就不纳入"）
const TASK2_NEW = '2. 抽取故事中的主要人物（不超过 6 个）以及人物之间的关系。persons 只放故事所述事件中真正出场（有行动、对话或被关系牵连）的人；讲述者"我"仅当其在所述事件里有戏份时才纳入——若"我"只是转述上一辈或他人的事、自己并未出现在事件中，则不要把"我"放进 persons 与 relations。'

// SYSTEM 模板，{TASK2} 处放新旧第 2 条；其余与生产 prompt 一致
function buildSystem(task2) {
  return `你是一位家族故事撰写者。
用户会给你一段"家族记者"与老人的访谈问答记录。请完成两件事：

1. ${WARM} 不要写成流水账；保留真实细节（时间、地点、人物、事件），绝不编造；800 字以内，分段清晰。正文中至少用中文引号「」独立引用 1～2 句老人在访谈里真正说过、有画面感的原话（动作、数字、口头禅、具体物件），原样保留其措辞，不得改写或编造；引用要自然融入叙事，不要堆砌。

${task2}

严格只输出 JSON，格式如下，不要输出 JSON 以外的任何文字：
{
  "title": "故事标题（10字内）",
  "content": "故事正文",
  "era": "故事发生的大致年份，尽量给四位数字，如 1972；实在无法判断则留空字符串",
  "persons": [{"id":"p1","name":"人物称呼或姓名"}],
  "relations": [{"from":"p1","to":"p2","label":"关系，如父亲/同事/战友/邻居"}]
}
要求：人物 id 用 p1、p2… 顺序编号，relations 里的 from/to 必须对应 persons 里已存在的 id。era 只在能从访谈中明确判断出年份时填写，否则留空。content 正文内禁止使用英文双引号，人物对话或引用一律用中文引号「」或单引号，避免破坏 JSON 结构。人物中若包含口述者本人（对话里第一人称"我"），name 标为"我"或其家族称呼（如"爷爷""父亲""母亲"），不要用"老人""用户""讲述者"这类访谈角色词。`
}

function transcript(history) {
  return history.map(h => (h.role === 'assistant' ? '记者：' : '我：') + h.text).join('\n')
}

// 从模型返回里抠 persons / relations：先 JSON.parse，失败用正则兜底（与生产 parseStoryJson 同思路）
function pickGraph(raw) {
  let s = (raw || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const start = s.indexOf('{'), end = s.lastIndexOf('}')
  if (start >= 0 && end > start) s = s.slice(start, end + 1)
  try {
    const o = JSON.parse(s)
    return { persons: o.persons || [], relations: o.relations || [] }
  } catch (e) {
    const pM = s.match(/"persons"\s*:\s*(\[[\s\S]*?\])\s*,\s*"relations"/)
    const rM = s.match(/"relations"\s*:\s*(\[[\s\S]*\])\s*\}/)
    let persons = [], relations = []
    if (pM) { try { persons = JSON.parse(pM[1]) } catch (_) {} }
    if (rM) { try { relations = JSON.parse(rM[1]) } catch (_) {} }
    return { persons, relations }
  }
}

async function gen(task2) {
  const resp = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: buildSystem(task2) },
        { role: 'user', content: '以下是访谈记录，请整理成家族故事并抽取人物关系：\n\n' + transcript(HISTORY) }
      ],
      temperature: 0.7,
      max_tokens: 2048,
      thinking: { type: 'disabled' }
    })
  })
  const data = await resp.json()
  const raw = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || ''
  return pickGraph(raw)
}

function show(label, g) {
  console.log(`\n===== ${label} =====`)
  console.log('persons  :', g.persons.map(p => p.name).join('、') || '(空)')
  console.log('relations:', g.relations.map(r => `${r.from}→${r.to}(${r.label})`).join('； ') || '(空)')
}

;(async () => {
  show('旧 prompt（当前生产）', await gen(TASK2_OLD))
  show('新 prompt（只放出场人物）', await gen(TASK2_NEW))
  console.log('\n判别点：新版 persons 不应再含讲述者"我"，只剩爷爷、王师傅；')
  console.log('relations 也不该有"我→爷爷"这种硬造关系。旧版常会把"我"当人物塞进图里。')
})().catch(e => console.error('运行出错：', e.message))
