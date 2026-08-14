// extractValues 云函数：遍历该用户的家族故事 → 抽取家风价值观 → 归并落库
// 入参 {}（只读当前 OPENID 的 story）
// 返回 { code, data:{ values:[{ value, count, quotes, sources }] } }
// 家风：老人话里"做人要诚信""吃亏是福"这类可传承的处世之道，从故事正文里提炼

const cloud = require('wx-server-sdk')
// Node 16 运行时没有全局 fetch，引入 node-fetch 补齐（v2 支持 CommonJS require）
const fetch = require('node-fetch')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 最近 N 篇参与提炼：家风看重代表性，取最近 30 篇足够，同时控制 token
const MAX_STORY = 30

const SYSTEM = `你是家族家风标注者。对下面每一篇家族故事，判断它体现了哪些"家风"——值得传给后代的处世之道。

要求：
- 每篇给 0-2 个家风；没有明确体现就不给，不硬凑。
- value 用 2-4 字概括词：知恩图报、勤俭持家、坚韧担当、重情念旧、家国情怀、诚信……
  不要场景化或针对具体人的表述——"念师恩"写成"知恩图报"，"念旧物"写成"重情念旧"，"能扛事"写成"坚韧担当"。
- 关键：同一个价值观若在多篇故事里都有体现，每篇都要各自标一遍（系统会统计它被几篇印证，频次决定它是不是真家风）。
- 每条附：value、该篇里最有代表性的原话 quote、这篇的 storyId。

输出扁平 JSON 数组（一篇可对应多条，也可不对应）：
[{ "value":"知恩图报", "quote":"做人不能忘本", "storyId":"篇A的id" }]`

// 分页拉取当前用户全部 story（云函数端单次最多 20 条，循环累加到拉空）
async function fetchAllStories(openid) {
  const PAGE = 20
  let all = [], skip = 0
  while (true) {
    const res = await db.collection('story').where({ _openid: openid })
      .orderBy('createdAt', 'desc')
      .skip(skip).limit(PAGE).get()
    all = all.concat(res.data)
    if (res.data.length < PAGE) break
    skip += PAGE
    // 兜底防异常数据导致死循环
    if (skip > 200) break
  }
  return all
}

// 拼故事摘要喂模型：只取标题 + 正文前 300 字，控制 token
function buildDigest(stories) {
  return stories.map(s => {
    const content = (s.content || '').slice(0, 300)
    return `【故事ID:${s._id}】【标题:${s.title || '无标题'}】${content}`
  }).join('\n\n')
}

// 剥离 ```json 包裹 + 兜底正则解析数组（思路同 genStory.parseStoryJson）
function parseValuesJson(raw) {
  let s = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const start = s.indexOf('[')
  const end = s.lastIndexOf(']')
  if (start >= 0 && end > start) s = s.slice(start, end + 1)
  try {
    const arr = JSON.parse(s)
    return Array.isArray(arr) ? arr : []
  } catch (e) {
    // 模型偶发输出不规整 JSON，逐条正则兜底保住能解析的
    const out = []
    const re = /\{\s*"value"\s*:\s*"([^"]*)"\s*,\s*"quote"\s*:\s*"([^"]*)"\s*,\s*"storyId"\s*:\s*"([^"]*)"\s*\}/g
    let m
    while ((m = re.exec(s))) out.push({ value: m[1], quote: m[2], storyId: m[3] })
    return out
  }
}

// 调百炼提炼家风，返回 [{value, quote, storyId}]
async function extract(stories, apiKey, model) {
  if (!stories.length) return []
  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: '以下是这个家庭已记录的往事，请提炼家风价值观：\n\n' + buildDigest(stories) }
  ]
  const resp = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    // thinking 关掉降延迟；temperature 调低让抽取更稳定不发散
    body: JSON.stringify({ model, messages, temperature: 0.5, max_tokens: 1024, thinking: { type: 'disabled' } })
  })
  const data = await resp.json()
  // API 层错误（key 无效/限流/欠费）必须抛出：否则解析为空数组，误报"故事还少"误导排查
  if (data.error) throw new Error(data.error.message || '模型调用失败')
  const raw = (data?.choices?.[0]?.message?.content || '').trim()
  return parseValuesJson(raw)
}

exports.main = async () => {
  const apiKey = process.env.DASHSCOPE_API_KEY
  const model = process.env.DASHSCOPE_MODEL || 'glm-5.2'
  if (!apiKey) return { code: 1, message: '未配置 DASHSCOPE_API_KEY' }

  const openid = cloud.getWXContext().OPENID
  let stories
  try {
    stories = await fetchAllStories(openid)
  } catch (e) {
    console.error('[extractValues] 读 story 失败', e)
    return { code: 1, message: '读取家族故事失败，请先建 story 集合并开权限' }
  }
  if (!stories.length) {
    return { code: 0, data: { values: [], message: '还没有家族故事，先记录几段家事再来提炼家风' } }
  }

  // 只取最近 N 篇参与提炼，控制 token 与延迟
  const recent = stories.slice(0, MAX_STORY)
  let raw
  try {
    raw = await extract(recent, apiKey, model)
  } catch (e) {
    console.error('[extractValues] 抽取失败', e)
    return { code: 1, message: '家风提炼失败，稍后再试' }
  }

  // 归并：按 value 聚合，count = 出现在几篇不同故事里（代码真实统计，不依赖模型声称）
  const titleOf = id => (stories.find(s => s._id === id) || {}).title || ''
  const map = {}
  raw.forEach(v => {
    const key = (v.value || '').trim()
    if (!key) return
    const sid = String(v.storyId || '').trim()
    if (!sid) return
    if (!map[key]) {
      map[key] = {
        value: key,
        count: 1,
        quotes: v.quote ? [{ text: v.quote, title: titleOf(sid) }] : [],
        sources: [{ storyId: sid, title: titleOf(sid) }]
      }
    } else {
      // 同一故事不重复计 count；不同故事的标注累加，体现"多篇印证"
      const it = map[key]
      if (!it.sources.some(s => s.storyId === sid)) {
        it.count++
        it.sources.push({ storyId: sid, title: titleOf(sid) })
      }
      if (v.quote && !it.quotes.some(q => q.text === v.quote)) {
        it.quotes.push({ text: v.quote, title: titleOf(sid) })
      }
    }
  })
  // 家风需多篇共识：只留被 ≥2 篇印证的；只出现 1 次的是个例，不算家风
  const MIN_PROOF = 2
  const values = Object.values(map).filter(v => v.count >= MIN_PROOF).sort((a, b) => b.count - a.count)
  // 调试日志：刷新后在云开发控制台→云函数→日志可看，用于确认是否真的重算
  console.log('[extractValues] 标注', raw.length, '条 → 过滤后', values.length, '条', values.map(v => v.value + '(' + v.count + ')'))

  // 清旧重写：先删该用户旧 familyValue，再批量写新值（避开增量去重复杂度）
  try {
    const old = await db.collection('familyValue').where({ _openid: openid }).get()
    await Promise.all(old.data.map(d => db.collection('familyValue').doc(d._id).remove()))
    await Promise.all(values.map(v =>
      db.collection('familyValue').add({ data: { _openid: openid, ...v, createdAt: db.serverDate() } })
    ))
  } catch (e) {
    console.error('[extractValues] 落库失败', e)
    // 落库失败不影响把本次结果返回给前端展示
  }

  if (!values.length) {
    // 被证据门槛过滤光：故事还少或彼此无共识，给前端可读提示
    return { code: 0, data: { values: [], message: '故事还少，家风需多篇共同印证，多记录几段家事再刷新' } }
  }
  return { code: 0, data: { values } }
}
