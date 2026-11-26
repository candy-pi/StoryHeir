// restore 云函数：老照片 AI 上色（万相 wanx2.1-imageedit，function=colorization）
// 入参 { storyId }：读取故事的 photoFileID → 上色 → 转存云存储 → 写回 story.colorizedFileID
// 返回 { code, data:{ fileID } }。黑白变彩色，结果写回记录让家人共享。
// 注意：万相结果 URL 仅 24h 有效，必须下载转存；任务 5-15s，云函数超时需 60s。

const cloud = require('wx-server-sdk')
const fs = require('fs')
// Node 16 运行时没有全局 fetch，引入 node-fetch 补齐（v2 支持 CommonJS require）
const fetch = require('node-fetch')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const BASE = 'https://dashscope.aliyuncs.com/api/v1'
const apiKey = () => process.env.DASHSCOPE_API_KEY
const sleep = ms => new Promise(r => setTimeout(r, ms))

// 提交上色任务，返回 task_id
async function submitColorize(baseUrl) {
  const resp = await fetch(`${BASE}/services/aigc/image2image/image-synthesis`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey()}`,
      'X-DashScope-Async': 'enable', // 图像类接口强制异步
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'wanx2.1-imageedit',
      input: {
        function: 'colorization',
        // prompt 留空：颜色由模型依据画面自动推断，老照片上色最稳，不强行指定
        prompt: '',
        base_image_url: baseUrl
      },
      parameters: { n: 1 }
    })
  })
  const data = await resp.json()
  if (!data.output || !data.output.task_id) {
    throw new Error(data.message || '提交上色任务失败')
  }
  return data.output.task_id
}

// 轮询任务直到拿到彩色图 URL（万相建议查询节奏不宜过密，这里 2s × 30 ≈ 60s 上限）
async function pollColorize(taskId) {
  for (let i = 0; i < 30; i++) {
    await sleep(2000)
    const resp = await fetch(`${BASE}/tasks/${taskId}`, {
      headers: { 'Authorization': `Bearer ${apiKey()}` }
    })
    const data = await resp.json()
    const status = data.output && data.output.task_status
    if (status === 'SUCCEEDED') {
      const url = data.output.results && data.output.results[0] && data.output.results[0].url
      if (!url) throw new Error('上色结果为空')
      return url
    }
    if (status === 'FAILED') throw new Error((data.output && data.output.message) || '上色任务失败')
    // PENDING / RUNNING 继续轮询
  }
  throw new Error('上色超时，请稍后重试')
}

// 下载彩色图并转存到云存储，返回持久 fileID（万相结果 URL 24h 失效，必须转存）
async function persistToCloud(url) {
  const r = await fetch(url)
  const buf = Buffer.from(await r.buffer())  // node-fetch v2 用 buffer() 取字节，无 arrayBuffer
  const tmpPath = `/tmp/${Date.now()}.png`
  fs.writeFileSync(tmpPath, buf)
  try {
    const up = await cloud.uploadFile({
      cloudPath: `photos/colorized/${Date.now()}.png`,
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
    const { OPENID, ENV } = cloud.getWXContext()
    if (!OPENID || story?._openid !== OPENID) return { code: 1, message: '只有原作者可以操作个人故事' }
    if (!story) return { code: 1, message: '故事不存在' }
    if (!story.photoFileID) return { code: 1, message: '这个故事没有老照片' }

    // 云存储 fileID 转公网临时 URL，万相才能拉取上色
    const photo = typeof story.photoFileID === 'string' && story.photoFileID.match(
      /^cloud:\/\/([^/]+)\/(?:private-media\/([\w-]+)\/)?photos\/[\w-]+\.jpg$/
    )
    if (!photo || !ENV || (photo[1] !== ENV && !photo[1].startsWith(ENV + '.')) ||
        (photo[2] && photo[2] !== OPENID)) {
      return { code: 1, message: '无法访问这张照片' }
    }
    const { fileList } = await cloud.getTempFileURL({ fileList: [story.photoFileID] })
    const baseUrl = fileList[0] && fileList[0].tempFileURL
    if (!baseUrl) return { code: 1, message: '获取照片地址失败' }

    const taskId = await submitColorize(baseUrl)
    const colorUrl = await pollColorize(taskId)
    const fileID = await persistToCloud(colorUrl)

    // 上色图写回故事记录，家人刷新也能看到（云函数具备管理员写权限，绕过集合写权限）
    await db.collection('story').doc(storyId).update({ data: { colorizedFileID: fileID } })

    return { code: 0, data: { fileID } }
  } catch (e) {
    console.error('[restore] 上色失败', e.name || 'Error')
    return { code: 1, message: '上色失败：' + (e.message || '未知错误') }
  }
}
