// 验证「故事引用老人原话」改进：同一段访谈，用新旧两版 prompt 各生成一次，并排对比。
//
// 用法（Node 18+，需内置 fetch）：
//   export DASHSCOPE_API_KEY=你的百炼key
//   node tests/genstory-quote-test.js
//
// 判别：新版正文是否用「」引出老人原话（如「接头、换纱」「下班能抱抱孩子」），
//       且原话来自访谈、自然融入。新版明显更生动 → 改进成立；否则需调 prompt。

const API_KEY = process.env.DASHSCOPE_API_KEY
const MODEL = process.env.DASHSCOPE_MODEL || 'glm-5.2'
const BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'

if (!API_KEY) {
  console.error('请先设置环境变量 DASHSCOPE_API_KEY（你百炼控制台的 key）')
  process.exit(1)
}

// 一段带画面感原话的访谈案例（纺织厂题材，呼应示例故事），用于检验"引用原话"效果
const HISTORY = [
  { role: 'assistant', text: '爷爷，您当年是怎么进的纺织厂？' },
  { role: 'user', text: '1972年春天，我从苏北乡下来上海，进了第七纺织厂当学徒，那年才二十四岁。' },
  { role: 'assistant', text: '刚进厂是什么光景？' },
  { role: 'user', text: '车间里机器轰隆隆响，震得耳朵嗡嗡的。带我的王师傅是上海本地人，技术好，脾气倔，手把手教我接头、换纱，我笨手笨脚的他也不嫌。' },
  { role: 'assistant', text: '王师傅对您影响很大吧？' },
  { role: 'user', text: '那当然，没有王师傅，我哪能在厂里站稳脚跟。我儿子75年在厂宿舍出生，那时候我每天最盼望的就是下班能抱抱孩子。可惜后来厂子改制，王师傅退休回了虹口，断了联系，等打听到的时候人已经走了。' }
]

// warm 风格描述（两版共用，本测试只验证"引用原话"这一项差异）
const WARM = '把它整理成一篇温暖有情的家族故事：细腻、有画面感、带温度，像家人围炉夜话般娓娓道来。'

// 旧版 SYSTEM（= 改动前的 genStory 生产 prompt）
const SYSTEM_OLD = `你是一位家族故事撰写者。
用户会给你一段"家族记者"与老人的访谈问答记录。请完成两件事：

1. ${WARM} 不要写成流水账；保留真实细节（时间、地点、人物、事件），绝不编造；800 字以内，分段清晰。

2. 抽取故事中的主要人物（不超过 6 个）以及人物之间的关系。

严格只输出 JSON，格式如下，不要输出 JSON 以外的任何文字：
{
  "title": "故事标题（10字内）",
  "content": "故事正文",
  "era": "故事发生的大致年份，尽量给四位数字，如 1972；实在无法判断则留空字符串",
  "persons": [{"id":"p1","name":"人物称呼或姓名"}],
  "relations": [{"from":"p1","to":"p2","label":"关系，如父亲/同事/战友/邻居"}]
}
要求：人物 id 用 p1、p2… 顺序编号，relations 里的 from/to 必须对应 persons 里已存在的 id。era 只在能从访谈中明确判断出年份时填写，否则留空。content 正文内禁止使用英文双引号，人物对话或引用一律用中文引号「」或单引号，避免破坏 JSON 结构。人物中若包含口述者本人（对话里第一人称"我"），name 标为"我"或其家族称呼（如"爷爷""父亲""母亲"），不要用"老人""用户""讲述者"这类访谈角色词。`

// 新版 SYSTEM（= 改动后：第 1 条加「」引用原话硬规则）
const SYSTEM_NEW = SYSTEM_OLD.replace(
  '800 字以内，分段清晰。',
  '800 字以内，分段清晰。正文中至少用中文引号「」独立引用 1～2 句老人在访谈里真正说过、有画面感的原话（动作、数字、口头禅、具体物件），原样保留其措辞，不得改写或编造；引用要自然融入叙事，不要堆砌。'
)

function transcript(history) {
  return history.map(h => (h.role === 'assistant' ? '记者：' : '我：') + h.text).join('\n')
}

// 从模型返回的 JSON 里抠出 content 正文，方便对比（失败则原样返回）
function pickContent(raw) {
  const m = raw.match(/"content"\s*:\s*"([\s\S]*?)"\s*,\s*"era"/)
  return m ? m[1] : raw
}

async function gen(system) {
  const resp = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: '以下是访谈记录，请整理成家族故事并抽取人物关系：\n\n' + transcript(HISTORY) }
      ],
      temperature: 0.7,
      max_tokens: 2048,
      thinking: { type: 'disabled' }
    })
  })
  const data = await resp.json()
  const raw = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '(空)'
  return pickContent(raw)
}

;(async () => {
  console.log('\n========== 旧 prompt（当前生产）==========\n')
  console.log(await gen(SYSTEM_OLD))
  console.log('\n\n========== 新 prompt（引用原话）==========\n')
  console.log(await gen(SYSTEM_NEW))
  console.log('\n\n判别点：新版是否用「」引出老人原话（如「接头、换纱」「下班能抱抱孩子」），')
  console.log('且原话来自访谈、自然融入。新版明显更生动 → 改进成立。')
})().catch(e => console.error('运行出错：', e.message))
