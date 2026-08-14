// tts 云函数：故事朗读（百炼 Qwen-TTS 语音合成）
// 入参 { storyId }：读正文 → 合成语音 → 下载存云存储 → 缓存 story.ttsFileID
// 返回 { code, data:{ fileID } }。已合成过直接返回缓存，不重复计费、即时播放。
// 关键：Qwen-TTS 返回的音频 URL 仅 24h 有效，必须下载转存云存储做永久缓存

const cloud = require('wx-server-sdk')
const fs = require('fs')
// Node 16 运行时没有全局 fetch，引入 node-fetch v2（CommonJS）补齐
const fetch = require('node-fetch')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// Qwen-TTS 非流式接口：与 chat/asr 同走 dashscope 域名，复用 DASHSCOPE_API_KEY，无需 WorkspaceId
const BASE = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'
const apiKey = () => process.env.DASHSCOPE_API_KEY

// 合成语音，返回音频公网 URL（24h 有效）。voice=Cherry 系统女声，language_type=Chinese
async function synth(text) {
  const resp = await fetch(BASE, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'qwen3-tts-flash',
      input: { text, voice: 'Cherry', language_type: 'Chinese' }
    })
  })
  const data = await resp.json()
  // 返回结构 output.audio.url（官方 Java/Python 示例），兜底 output.url 防字段名差异
  const url = (data.output && data.output.audio && data.output.audio.url)
    || (data.output && data.output.url)
  if (!url) throw new Error(data.message || '语音合成未返回音频')
  return url
}

// 下载音频并转存云存储（模式同 restore.persistToCloud），返回持久 fileID
async function persistToCloud(url) {
  const r = await fetch(url)
  const buf = Buffer.from(await r.buffer())  // node-fetch v2 用 buffer() 取字节
  const tmpPath = `/tmp/${Date.now()}.wav`
  fs.writeFileSync(tmpPath, buf)
  try {
    const up = await cloud.uploadFile({
      cloudPath: `tts/${Date.now()}.wav`,
      filePath: tmpPath
    })
    return up.fileID
  } finally {
    fs.unlinkSync(tmpPath)
  }
}

exports.main = async (event) => {
  const { storyId } = event
  if (!storyId) return { code: 1, message: '缺少 storyId' }
  if (!apiKey()) return { code: 1, message: '未配置 DASHSCOPE_API_KEY' }

  try {
    const story = (await db.collection('story').doc(storyId).get()).data
    if (!story) return { code: 1, message: '故事不存在' }

    // 缓存优先：已合成过直接返回，不重复计费、老人再点即时出声
    if (story.ttsFileID) return { code: 0, data: { fileID: story.ttsFileID } }

    const text = (story.content || '').trim()
    if (!text) return { code: 1, message: '这个故事还没有正文' }

    const audioUrl = await synth(text)
    const fileID = await persistToCloud(audioUrl)

    // 缓存写回故事记录，下次任意次数播放都 0 成本
    await db.collection('story').doc(storyId).update({ data: { ttsFileID: fileID } })

    return { code: 0, data: { fileID } }
  } catch (e) {
    console.error('[tts]', e)
    return { code: 1, message: '朗读暂时不可用，稍后再试' }
  }
}
