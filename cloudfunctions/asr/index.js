// asr 云函数：语音转写（阿里云百炼 Paraformer 录音文件识别）
// 入参 { fileID, dialect }（云存储音频 + 方言码），返回 { code, data:转写文本 }
// 复用 chat 的 DASHSCOPE_API_KEY，无需额外密钥；支持普通话及部分方言
// 注意：识别为异步（提交任务+轮询），云函数超时需调到 30s 以上

const cloud = require('wx-server-sdk')
// Node 16 运行时没有全局 fetch，引入 node-fetch 补齐（v2 支持 CommonJS require）
const fetch = require('node-fetch')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const BASE = 'https://dashscope.aliyuncs.com/api/v1'
const apiKey = () => process.env.DASHSCOPE_API_KEY

// 方言 → paraformer-v2 的 language_hints 语种码
// 官方录音文件识别明确支持 zh/en/ja/yue/ko/de/fr/ru，方言目前仅 yue（粤语）
// 其它方言（四川话/吴语等）需 Fun-ASR 1.5，赛期先打通粤语，UI 标"测试版"
const DIALECT_HINTS = { zh: ['zh', 'en'], yue: ['yue'] }

const sleep = ms => new Promise(r => setTimeout(r, ms))

// 提交录音文件识别任务，返回 task_id
async function submitTask(fileUrl, languageHints) {
  const resp = await fetch(`${BASE}/services/audio/asr/transcription`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey()}`,
      'X-DashScope-Async': 'enable', // 异步模式，提交后返回 task_id
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'paraformer-v2',
      input: { file_urls: [fileUrl] },
      // 不开 disfluency_removal_enabled：保留老人语气词原貌，口述史贵在真实
      parameters: { language_hints: languageHints }
    })
  })
  const data = await resp.json()
  if (!data.output || !data.output.task_id) {
    throw new Error(data.message || '提交识别任务失败')
  }
  return data.output.task_id
}

// 轮询任务直到完成或失败
async function pollTask(taskId) {
  // 最多等 ~30s（与云函数超时上限匹配）
  for (let i = 0; i < 35; i++) {
    await sleep(1000)
    const resp = await fetch(`${BASE}/tasks/${taskId}`, {
      headers: { 'Authorization': `Bearer ${apiKey()}` }
    })
    const data = await resp.json()
    const status = data.output && data.output.task_status
    if (status === 'SUCCEEDED') return data.output
    if (status === 'FAILED') throw new Error('识别任务失败')
    // PENDING / RUNNING 继续轮询
  }
  throw new Error('识别超时，请缩短录音后重试')
}

exports.main = async (event) => {
  const { fileID, dialect } = event
  const { OPENID, ENV } = cloud.getWXContext()
  const expected = /^cloud:\/\/([^/]+)\/private-media\/([\w-]+)\/audio\/[\w-]+\.mp3$/;
  const ownsFile = id => {
    const match = typeof id === 'string' && id.match(expected)
    return !!(match && OPENID && ENV && match[2] === OPENID &&
      (match[1] === ENV || match[1].startsWith(ENV + '.')))
  }
  if (!ownsFile(fileID)) return { code: 1, message: '无法访问这段录音' }
  if (!fileID) return { code: 1, message: '缺少 fileID' }
  if (!apiKey()) return { code: 1, message: '未配置 DASHSCOPE_API_KEY' }

  try {
    // 云存储 fileID 需转成公网可访问的临时 URL，百炼才能拉取音频
    const { fileList } = await cloud.getTempFileURL({ fileList: [fileID] })
    const fileUrl = fileList[0] && fileList[0].tempFileURL
    if (!fileUrl) return { code: 1, message: '获取音频地址失败' }

    const languageHints = DIALECT_HINTS[dialect] || DIALECT_HINTS.zh
    const taskId = await submitTask(fileUrl, languageHints)
    const output = await pollTask(taskId)

    // 结果是个 JSON 文件 URL，下载后取 transcripts[0].text
    const resultUrl = output.results && output.results[0] && output.results[0].transcription_url
    if (!resultUrl) return { code: 1, message: '未拿到识别结果' }
    const r = await fetch(resultUrl)
    const result = await r.json()
    const text = (result.transcripts && result.transcripts[0] && result.transcripts[0].text) || ''
    return { code: 0, data: text }
  } catch (e) {
    console.error('[asr] 转写失败', e.name || 'Error')
    return { code: 1, message: '语音识别失败，请稍后再试' }
  }
}
