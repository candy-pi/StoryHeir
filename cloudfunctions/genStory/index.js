// genStory 云函数：访谈问答 → 家族故事，并抽取人物关系与事件年代，落库后返回
// 入参 { history:[{role,text,photoFileID?}], photoFileID, style, storyId }
// storyId 非空表示续访：update 原故事并回写完整对话；为空则首次成稿、新增落库
// style：documentary(纪实) / warm(温暖) / formal(正式)，默认 warm
// 返回 { code, data:{ _id, title, content, era, persons, relations, style, createdAt } }

const cloud = require('wx-server-sdk')
// Node 16 运行时没有全局 fetch，引入 node-fetch 补齐（v2 支持 CommonJS require）
const fetch = require('node-fetch')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 固定骨架，{STYLE_DESC} 处按所选风格替换
const SYSTEM_BASE = `你是一位家族故事撰写者。
用户会给你一段"家族记者"与老人的访谈问答记录。请完成两件事：

1. {STYLE_DESC} 不要写成流水账；保留真实细节（时间、地点、人物、事件），绝不编造；800 字以内，分段清晰。正文中至少用中文引号「」独立引用 1～2 句老人在访谈里真正说过、有画面感的原话（动作、数字、口头禅、具体物件），原样保留其措辞，不得改写或编造；引用要自然融入叙事，不要堆砌。

2. 抽取故事中的主要人物（不超过 6 个）以及人物之间的关系。persons 只放故事所述事件中真正出场（有行动、对话或被关系牵连）的人；讲述者"我"仅当其在所述事件里有戏份时才纳入——若"我"只是转述上一辈或他人的事、自己并未出现在事件中，则不要把"我"放进 persons 与 relations。

严格只输出 JSON，格式如下，不要输出 JSON 以外的任何文字：
{
  "title": "故事标题（10字内）",
  "content": "故事正文",
  "era": "故事发生的大致年份，尽量给四位数字，如 1972；实在无法判断则留空字符串",
  "persons": [{"id":"p1","name":"人物称呼或姓名"}],
  "relations": [{"from":"p1","to":"p2","label":"关系，如父亲/同事/战友/邻居"}]
}
要求：人物 id 用 p1、p2… 顺序编号，relations 里的 from/to 必须对应 persons 里已存在的 id。era 只在能从访谈中明确判断出年份时填写，否则留空。content 正文内禁止使用英文双引号，人物对话或引用一律用中文引号「」或单引号，避免破坏 JSON 结构。人物中若包含口述者本人（对话里第一人称"我"），name 标为"我"或其家族称呼（如"爷爷""父亲""母亲"），不要用"老人""用户""讲述者"这类访谈角色词。`

// 三种风格的行文要求，决定故事的语气与笔触
const STYLE_DESC = {
  documentary: '把它整理成一篇客观朴素的家族口述档案：白描、克制，不渲染不煽情，保留真实细节。',
  warm: '把它整理成一篇温暖有情的家族故事：细腻、有画面感、带温度，像家人围炉夜话般娓娓道来。',
  formal: '把它整理成一篇正式庄重的家族传记：平实、用语规范、结构清晰、时间脉络分明，如同一篇地方志中的家族篇章。'
}

// 把问答拼成可读的访谈文本喂给模型
function transcript(history) {
  // 用第一人称"我："标注口述者：访谈本就是老人第一人称讲述，
  // 这样模型以口述者本人视角写故事、抽人物；避免把访谈角色词"老人"误当作人物名
  return history.map(h => (h.role === 'assistant' ? '记者：' : '我：') + h.text).join('\n')
}

// 解析模型返回的故事 JSON：先剥离 ```json 包裹与模型前后多余文字，再 parse；
// parse 失败（多为 content 正文里未转义的双引号破坏了 JSON）时用正则逐字段兜底，
// 至少保住 content / persons / relations，避免整段 JSON 被塞进 content、关系图丢节点
function parseStoryJson(raw) {
  let s = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start >= 0 && end > start) s = s.slice(start, end + 1)
  try {
    return JSON.parse(s)
  } catch (e) {
    const pick = re => { const m = s.match(re); return m ? m[1] : '' }
    const title = pick(/"title"\s*:\s*"([^"]*)"/)
    const era = pick(/"era"\s*:\s*"([^"]*)"/)
    // content 取到下一个字段 era 之前，绕过正文里的非法双引号
    const content = pick(/"content"\s*:\s*"([\s\S]*?)"\s*,\s*"era"/)
    let persons = []
    let relations = []
    // persons / relations 是规整数组，单独 parse 成功率高
    const pM = s.match(/"persons"\s*:\s*(\[[\s\S]*?\])\s*,\s*"relations"/)
    if (pM) { try { persons = JSON.parse(pM[1]) } catch (_) {} }
    const rM = s.match(/"relations"\s*:\s*(\[[\s\S]*\])\s*\}/)
    if (rM) { try { relations = JSON.parse(rM[1]) } catch (_) {} }
    return { title, content, era, persons, relations }
  }
}

// 调百炼生成故事 + 关系 + 年代，返回结构化对象
async function generateStory(history, apiKey, model, style) {
  const styleDesc = STYLE_DESC[style] || STYLE_DESC.warm
  const system = SYSTEM_BASE.replace('{STYLE_DESC}', styleDesc)
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: '以下是访谈记录，请整理成家族故事并抽取人物关系：\n\n' + transcript(history) }
  ]
  const resp = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    // thinking 关掉：GLM-5.2 默认先深度思考，800字故事要等40s+；关思考后约10s出结果
    // max_tokens 兜底，防止模型无限生成把超时拖垮
    body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 2048, thinking: { type: 'disabled' } })
  })
  const data = await resp.json()
  // API 层错误（key 无效/限流/欠费）必须抛出：否则解析出空故事，落库一条只有标题没有正文的废记录
  if (data.error) throw new Error(data.error.message || '模型调用失败')
  const raw = (data?.choices?.[0]?.message?.content || '').trim()
  const parsed = parseStoryJson(raw)
  return {
    title: parsed.title || '一段家族往事',
    content: parsed.content || raw,
    // era 用于编年志按事件年代排序；模型给不出年份时为空字符串，前端再回退到收录时间
    era: typeof parsed.era === 'string' ? parsed.era.trim() : '',
    persons: Array.isArray(parsed.persons) ? parsed.persons.slice(0, 6) : [],
    relations: Array.isArray(parsed.relations) ? parsed.relations : []
  }
}

exports.main = async (event) => {
  const { history, photoFileID, style, storyId: resumeId } = event
  let familyId = typeof event.familyId === 'string' ? event.familyId.trim() : ''
  const apiKey = process.env.DASHSCOPE_API_KEY
  const model = process.env.DASHSCOPE_MODEL || 'glm-5.2'
  const finalStyle = STYLE_DESC[style] ? style : 'warm'

  if (!apiKey) return { code: 1, message: '未配置 DASHSCOPE_API_KEY' }
  if (!Array.isArray(history) || history.length === 0) {
    return { code: 1, message: '访谈内容为空，先聊几句再生成故事' }
  }

  const openid = cloud.getWXContext().OPENID
  if (resumeId && !familyId) {
    try { familyId = (await db.collection('story').doc(resumeId).get()).data?.familyId || '' } catch (_) {}
  }
  if (!familyId) return { code: 1, message: '请先选择故事所属家族' }
  try {
    const family = (await db.collection('families').doc(familyId).get()).data
    if (!family || !Array.isArray(family.members) || !family.members.includes(openid)) {
      return { code: 1, message: '你还没有加入这个家族' }
    }
  } catch (_) {
    return { code: 1, message: '家族不存在或无权访问' }
  }

  let story
  try {
    story = await generateStory(history, apiKey, model, finalStyle)
  } catch (e) {
    console.error('[genStory] 生成失败', e)
    return { code: 1, message: '故事生成失败，稍后再试' }
  }

  // 收集本次访谈全部照片：开场图(入参) + 过程补图(history 内带图消息)，去重保序
  const _ids = []
  if (photoFileID) _ids.push(photoFileID)
  ;(history || []).forEach(h => {
    if (h.photoFileID && !_ids.includes(h.photoFileID)) _ids.push(h.photoFileID)
  })
  const photoFileIDs = _ids

  // 落库：续访（带 resumeId）则 update 原故事 + 回写完整对话；首次则 add 访谈与故事
  let storyId = resumeId || ''
  try {
    if (resumeId) {
      // 续访：先校验作者，非作者直接拒绝（云函数层显式拦截，提示更友好）
      const old = await db.collection('story').doc(resumeId).get()
      if (!old.data || old.data._openid !== openid) {
        return { code: 1, message: '仅作者可完善' }
      }
      // 覆盖更新原故事正文/标题/年代/人物/关系 + 照片集
      await db.collection('story').doc(resumeId).update({
        data: { ...story, familyId, style: finalStyle, photoFileID: photoFileIDs[0] || old.data.photoFileID || '', photoFileIDs }
      })
      // 回写完整对话（原+新）到原访谈记录，保留可追溯
      if (old.data.interviewId) {
        try {
          await db.collection('interview').doc(old.data.interviewId).update({
            data: { messages: history, updatedAt: db.serverDate() }
          })
        } catch (_) {}
      }
    } else {
      // 首次成稿：存访谈原文 + 存故事并关联
      const iv = await db.collection('interview').add({
        data: { _openid: openid, familyId, photoFileID: photoFileID || '', messages: history, createdAt: db.serverDate() }
      })
      const st = await db.collection('story').add({
        data: { _openid: openid, familyId, ...story, style: finalStyle, photoFileID: photoFileIDs[0] || '', photoFileIDs, interviewId: iv._id, createdAt: db.serverDate() }
      })
      storyId = st._id
    }

  } catch (e) {
    console.error('[genStory] 落库失败', e)
    // 续访更新失败必须报错：否则故事页重读云端会显示旧内容，与用户刚看到的矛盾
    // 首次落库失败则仍返回故事（前端可走本地兜底显示）
    if (resumeId) return { code: 1, message: '更新失败，稍后再试' }
  }

  return { code: 0, data: { ...story, familyId, style: finalStyle, _id: storyId, createdAt: new Date() } }
}
