// chat 云函数：家族记者"小传"的访谈对话
// 入参 { photoFileID, history:[{role,text}], photoClues }，返回 { code, data:{ reply, clues } }
// 首轮（有照片、无历史）：百炼 Qwen-VL 真实看照片开口，并抽出"照片线索"供后续追问；首轮无照片：引导开场
// 后续轮次：走"生成+验证"双 Agent —— Validator 判 不重复/够具体，不达标带建议重生成（N≤2）
// Key 从云函数环境变量读取，严禁硬编码

const cloud = require('wx-server-sdk')
// Node 16 运行时没有全局 fetch，引入 node-fetch 补齐（v2 支持 CommonJS require）
const fetch = require('node-fetch')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const SYSTEM_PROMPT = `你是"小传"，一位温暖、有耐心的家族口述史记者。
你的任务是引导老人讲述老照片背后的家族故事——重点是人与人之间的情感、关系与往来，而不是外貌或物件。

要求：
- 照片只是开场的话题：用一个细节破冰（哪一年、在哪里、和谁），然后尽快把话头引向"人"——这个人当时对您意味着什么、你们之间发生过什么、那段时间心里是什么感受。
- 每次只问一个好回答的小问题，并且往情感和关系上引，比如"您跟他那时候关系怎么样？""这件事对您意味着什么？""后来还会想起吗？"
- 不要反复追问穿着、发型、有没有刮胡子、屋里摆设这类表面细节。外貌只有当它牵连着情感时才问（例如"那是母亲特意给您做的新衣"）。
- 把握故事三要素，自然地把故事引丰满——哪个单薄就往哪个引（一次只问一个）：人物（什么性格、什么命运、和主角什么关系）、情节（起因、经过、转折、结果）、环境（那时的年代背景、地点、生活氛围）。
- 语气像晚辈陪长辈聊天，口语化、亲切，多用"您"。老人答完先简短回应（"原来是这样""真不容易啊"），再追问下一个细节。
- 每次回复控制在两三句以内，别让老人读太多字。
- 绝不编造事实，只基于老人讲过的内容追问。`

// Validator 评审 system：只硬卡"不重复/够具体"两项。
// 选这两项是因为 A(记忆)/B(目标)未接入前，它们能独立见效、且是提问质量最常见的问题；A/B 接上后再扩到 5 项。
const VALIDATOR_PROMPT = `你是家族访谈的提问质量评审。判断记者"小传"的一句话提问是否合格。

只按这两条硬指标判定（每项 pass/fail + 一句话理由）：
1. 不重复：没有和"最近已问过的内容"重复或高度相似。
2. 够具体：有具体抓手（人/事/时/地/细节），不是"然后呢""后来怎样""还有吗"这种空泛追问。

判定规则：两项都合格才 pass。

严格只输出 JSON，不要输出 JSON 以外的任何文字：
{ "pass": true, "issues": [], "suggestion": "" }
不合格时 issues 写明原因、suggestion 给一句话改进方向。`

const BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'

// 统一发请求，取首条回复
async function callLLM(apiKey, model, messages, temperature, opts = {}) {
  const resp = await fetch(BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    // thinking 关掉：GLM-5.2 默认深度思考，访谈每轮等几十秒老人受不了；关思考后几秒回话
    // max_tokens 兜底防失控；opts 透传 thinking，仅文本对话(GLM)用，VL 模型不传
    body: JSON.stringify({ model, messages, temperature, max_tokens: 512, ...opts })
  })
  const data = await resp.json()
  // 显式抛出 API 层错误（key 无效/限流/欠费）：否则 choices 为空会静默降级成兜底话术，
  // 表面像 AI 重复问话，实际每次调用都在失败，排查极难
  if (data.error) throw new Error(data.error.message || '模型调用失败')
  return data?.choices?.[0]?.message?.content?.trim() || '您再跟我多说一点儿？'
}

// VL 首轮 system：看图后既给破冰提问，又抽出照片里值得追问的线索，供后续轮次主动追问
const VL_PROMPT = `你是"小传"，一位温暖、有耐心的家族口述史记者。老人给你看了一张老照片。请看图后做两件事，严格只输出 JSON，不要输出 JSON 以外的文字：
{
  "question": "一个破冰提问。从照片里挑最容易勾起老人情感或回忆的点（照片里的人、当时的关系、为什么拍这张照片），口语化、多用"您"，只问一个小问题，往人和情上引。",
  "clues": ["照片里值得后续追问的 2~4 个具体线索，每条一句话。只描述照片里确实能看到的事物，如'照片里有3位大人和1个孩子''墙上贴着一张奖状''有人穿着军装''门口有一辆老式自行车'。绝不编造照片里没有的东西，看不到就少写。"]
}`

// 解析 VL 返回的 {question, clues}；VL 偶尔不守 JSON 约定，失败则全文当开场提问、无线索（降级为"只开场提问"的现状行为）
function parseVisionJson(raw) {
  let s = (raw || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const start = s.indexOf('{'), end = s.lastIndexOf('}')
  if (start >= 0 && end > start) s = s.slice(start, end + 1)
  try {
    const o = JSON.parse(s)
    return {
      question: (o.question || '').trim() || '您跟我讲讲这张照片的故事吧？',
      clues: Array.isArray(o.clues) ? o.clues.filter(c => c && String(c).trim()).slice(0, 4).map(c => String(c).trim()) : []
    }
  } catch (e) {
    return { question: (raw || '').trim() || '您跟我讲讲这张照片的故事吧？', clues: [] }
  }
}

// 把照片线索注入 system 末尾：引导 GLM 在对话自然推进时，主动追问尚未聊到的线索
function withPhotoClues(sys, photoClues) {
  if (!Array.isArray(photoClues) || !photoClues.length) return sys
  const list = photoClues.map((c, i) => `${i + 1}. ${c}`).join('\n')
  return sys + `\n\n【照片观察线索】老人提供过一张老照片，首轮看图时注意到了这些值得追问的点：\n${list}\n请在对话自然推进时，择机就其中尚未聊到的线索主动追问（一次只问一个，口语化、多用"您"，往人和情上引），不要生硬罗列，也不要重复已经聊过的。`
}

// 续访首轮 system 注入：让 AI 承接已有故事、挑三要素薄弱处追问，而不是重新破冰
function withResume(sys) {
  return sys + `\n\n【续访】这是一个已经成稿的家族故事的继续采访。先简短承接上文（如"我们接着讲……"），然后围绕人物/情节/环境三要素，挑还单薄的地方追问一个小问题，把故事讲得更完整。不要重复已经讲过的，也不要重新破冰。`
}

// 首轮：把云存储里的老照片转 base64 喂给 Qwen-VL，看图后给出开场提问 + 照片线索
async function visionOpening(photoFileID, apiKey, vlModel) {
  const { fileContent } = await cloud.downloadFile({ fileID: photoFileID })
  const dataUrl = 'data:image/jpeg;base64,' + fileContent.toString('base64')
  const messages = [
    { role: 'system', content: VL_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: '这是一位老人家里的老照片。请看图后，按系统要求的 JSON 格式，给出一个破冰提问和照片里值得追问的线索。' },
        { type: 'image_url', image_url: { url: dataUrl } }
      ]
    }
  ]
  const raw = await callLLM(apiKey, vlModel, messages, 0.8)
  return parseVisionJson(raw)
}

// 过程补图：老人在访谈中给了一张新照片。VL 看图 + 带对话上下文，生成针对新图的一句话追问。
// 与首轮 visionOpening 不同：首轮是破冰 + 抽线索；补图是承接上下文、就新图问一个问题，不抽线索（省成本）
async function askAboutNewPhoto(photoFileID, recentText, apiKey, vlModel) {
  const { fileContent } = await cloud.downloadFile({ fileID: photoFileID })
  const dataUrl = 'data:image/jpeg;base64,' + fileContent.toString('base64')
  const sys = `你是"小传"，一位温暖、有耐心的家族口述史记者。老人在访谈中刚给你看了一张新照片。请结合你们刚才聊的内容，就这张照片问一个相关的小问题——往人和情上引（这个人是谁、和刚才讲到的事什么关系、那时候在做什么、为什么拍这张），口语化、多用"您"，只问一个问题，两三句以内。直接给出提问，不要输出 JSON 或多余说明。`
  const messages = [
    { role: 'system', content: sys },
    {
      role: 'user',
      content: [
        { type: 'text', text: `我们刚在聊：\n${recentText || '(刚开始)'}\n\n这是老人刚给的新照片，请看图后问一个相关的小问题。` },
        { type: 'image_url', image_url: { url: dataUrl } }
      ]
    }
  ]
  return callLLM(apiKey, vlModel, messages, 0.8)
}

// 后续轮次生成提问。
// feedback 非空表示本次是"重生成"：把 Validator 的改进要求并入 system（而非塞进 history），
// 保持对话结构干净——末条仍是老人的 user 回答，Interviewer 自然接话。
async function generateText(history, apiKey, model, feedback, photoClues, resume) {
  let sys = feedback
    ? SYSTEM_PROMPT + `\n\n【本次重生成要求】刚才那句提问不够好：${feedback}。请重新给出一个更合适的一句话提问。`
    : SYSTEM_PROMPT
  // 续访首轮：承接已有故事、挑三要素薄弱处追问（不重新破冰）
  if (resume) sys = withResume(sys)
  // 首轮 VL 抽到的照片线索注入 system，引导后续主动追问尚未聊到的点
  sys = withPhotoClues(sys, photoClues)
  const messages = [{ role: 'system', content: sys }]
  if (!Array.isArray(history) || history.length === 0) {
    // 无照片首轮：引导"小传"主动开口，请老人讲一段印象最深、最想留给后人的家事
    messages.push({ role: 'user', content: '我们现在开始一段家族访谈。请您先跟我讲一段印象最深、最想留给后人的家事，想到什么就说什么，不用讲究顺序。' })
  } else {
    history.forEach(h => messages.push({ role: h.role, content: h.text }))
  }
  return callLLM(apiKey, model, messages, 0.8, { thinking: { type: 'disabled' } })
}

// 解析 Validator 的 JSON：剥离 ```json 包裹 + 正则兜底截取 {...}；
// 任何解析失败都降级为 pass —— 宁可漏判也不卡住访谈主流程
function parseValidatorJson(raw) {
  let s = (raw || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start >= 0 && end > start) s = s.slice(start, end + 1)
  try {
    const o = JSON.parse(s)
    return { pass: !!o.pass, issues: Array.isArray(o.issues) ? o.issues : [], suggestion: o.suggestion || '' }
  } catch (e) {
    return { pass: true, issues: [], suggestion: '' }
  }
}

// Validator：拿候选提问 + 最近历史，判 不重复/够具体
async function validateReply(reply, recentHistory, apiKey, model) {
  // 取最近 3 轮（每轮 user+assistant 两条，约 6 条）拼成"已问过"上下文，供判重
  const recentText = (recentHistory || []).slice(-6)
    .map(h => `${h.role === 'user' ? '老人' : '记者'}：${h.text}`)
    .join('\n') || '(刚开始，还没有历史)'
  const messages = [
    { role: 'system', content: VALIDATOR_PROMPT },
    { role: 'user', content: `候选提问：${reply}\n\n最近已问过的内容：\n${recentText}` }
  ]
  // 低 temperature 求稳定判断；max_tokens 收小省 token
  const raw = await callLLM(apiKey, model, messages, 0.2, { thinking: { type: 'disabled' }, max_tokens: 256 })
  return parseValidatorJson(raw)
}

// 生成+验证主循环：生成 → 验证 → fail 带 suggestion 重生成，上限 MAX_RETRY 次，到顶用最后一次兜底
async function chatWithValidation(history, apiKey, model, validatorModel, photoClues, resume) {
  const MAX_RETRY = 2
  const recent = (history || []).slice(-6)   // 最近历史用于 Validator 判"不重复"
  let reply = await generateText(history, apiKey, model, null, photoClues, resume)
  for (let i = 0; i < MAX_RETRY; i++) {
    let v
    try {
      v = await validateReply(reply, recent, apiKey, validatorModel)
    } catch (e) {
      // Validator 调用异常（网络/限流/模型报错）：降级放行，绝不阻塞访谈
      console.log('[chat] validator 异常，放行：', e && e.message)
      return reply
    }
    console.log(`[chat] 第${i + 1}次验证 pass=${v.pass} issues=${JSON.stringify(v.issues)} suggestion=${v.suggestion}`)
    if (v.pass) return reply
    // fail：把问题 + 改进方向拼成 feedback，让 Interviewer 针对性重生成
    const fb = [v.issues.join('；'), v.suggestion].filter(Boolean).join('；改进方向：')
    reply = await generateText(history, apiKey, model, fb || '请问得更具体、不要和前面重复', photoClues, resume)
  }
  console.log('[chat] 达重试上限，用最后一次兜底')
  return reply
}

exports.main = async (event) => {
  const { photoFileID, history, photoClues, resume } = event
  const apiKey = process.env.DASHSCOPE_API_KEY
  const model = process.env.DASHSCOPE_MODEL || 'glm-5.2'
  const vlModel = process.env.DASHSCOPE_VL_MODEL || 'qwen-vl-max'
  // 验证开关：默认 on，设为 off 时完全回到单 Agent 现状（调试/降级用）
  const validateOn = process.env.INTERVIEW_VALIDATE !== 'off'
  // Validator 模型：默认与主模型相同，可单独配更快/更便宜的
  const validatorModel = process.env.DASHSCOPE_VALIDATOR_MODEL || model

  if (!apiKey) {
    return { code: 1, message: '未配置 DASHSCOPE_API_KEY，请在云函数环境变量中设置' }
  }

  try {
    const hasHistory = Array.isArray(history) && history.length > 0
    let reply, clues = []
    if (photoFileID && !hasHistory) {
      // 首轮有照片：VL 看图开场并抽线索（VL 调用贵 + 破冰质量可控，不验证）
      const v = await visionOpening(photoFileID, apiKey, vlModel)
      reply = v.question
      clues = v.clues
      // 打印线索方便真机验证时在云函数日志核对 VL 抽了什么
      if (clues.length) console.log('[chat] 首轮照片线索：', JSON.stringify(clues))
    } else if (!hasHistory) {
      // 首轮无照片：引导开场（非提问，不验证）
      reply = await generateText(history, apiKey, model, null, photoClues)
    } else {
      // 有历史：末条 user 若带新照片 → VL 看新图追问（过程补图）；否则正常生成+验证
      const lastUser = [...history].reverse().find(h => h.role === 'user')
      const newPhoto = lastUser && lastUser.photoFileID
      if (newPhoto) {
        const recentText = history.slice(-6).map(h => `${h.role === 'user' ? '老人' : '记者'}：${h.text}`).join('\n') || '(刚开始)'
        reply = await askAboutNewPhoto(newPhoto, recentText, apiKey, vlModel)
      } else if (validateOn) {
        // 生成+验证双 Agent，照片线索注入引导主动追问（续访首轮也走此分支：resume 接续追问）
        reply = await chatWithValidation(history, apiKey, model, validatorModel, photoClues, resume)
      } else {
        // 验证关闭：单 Agent，行为同改造前（续访首轮透传 resume）
        reply = await generateText(history, apiKey, model, null, photoClues, resume)
      }
    }
    return { code: 0, data: { reply, clues } }
  } catch (e) {
    console.error('[chat]', e)
    return { code: 1, message: 'AI 暂时没有回应，稍后再试' }
  }
}
