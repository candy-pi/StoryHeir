const express = require('express')
const fetch = require('node-fetch')
const readline = require('readline')
const { buildTextMessages } = require('./chat')

const app = express()
app.use(express.json({
  limit: '256kb',
  type: ['application/json', 'application/octet-stream']
}))

const modelUrl =
  'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'

app.post('/chat', async (req, res) => {
  const { history, photoClues, resume } = req.body || {}
  console.log('[chatStream] body shape', {
    contentType: req.get('content-type'),
    bodyType: typeof req.body,
    bodyKeys: Object.keys(req.body || {}),
    historyType: Array.isArray(history) ? 'array' : typeof history,
    firstRole: history?.[0]?.role,
    firstTextType: typeof history?.[0]?.text
  })
  const apiKey = process.env.DASHSCOPE_API_KEY
  const model = process.env.DASHSCOPE_MODEL || 'glm-5.2'

  if (!apiKey) {
    console.error('[chatStream] 未配置 DASHSCOPE_API_KEY')
    return res.status(500).json({ error: '流式访谈服务未配置' })
  }

  if (!Array.isArray(history) || history.some(message =>
    !message ||
    !['user', 'assistant'].includes(message.role) ||
    typeof message.text !== 'string'
  )) {
    return res.status(400).json({ error: '访谈历史格式错误' })
  }

  const controller = new AbortController()
  res.once('close', () => {
    if (!res.writableEnded) {
      controller.abort()
    }
  })

  const send = data => {
    if (!res.destroyed && !res.writableEnded) {
      res.write(`data: ${JSON.stringify(data)}\n\n`)
    }
  }

  try {
    const messages = buildTextMessages(
      history,
      null,
      Array.isArray(photoClues) ? photoClues.filter(clue => typeof clue === 'string') : [],
      resume === true
    )

    const upstream = await fetch(modelUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.8,
        max_tokens: 512,
        thinking: { type: 'disabled' },
        stream: true
      }),
      signal: controller.signal
    })

    if (!upstream.ok) {
      throw new Error(`百炼返回 HTTP ${upstream.status}: ${await upstream.text()}`)
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    res.flushHeaders()

    const lines = readline.createInterface({
      input: upstream.body,
      crlfDelay: Infinity
    })

    let hasText = false

    for await (const line of lines) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()

      if (payload === '[DONE]') {
        if (!hasText) throw new Error('模型未返回问题文字')
        send({ done: true })
        return res.end()
      }

      const chunk = JSON.parse(payload)
      if (chunk.error) {
        throw new Error(chunk.error.message || '模型流式调用失败')
      }

      const delta = chunk.choices?.[0]?.delta?.content
      if (typeof delta === 'string' && delta.length > 0) {
        hasText = true
        send({ delta })
      }
    }

    throw new Error('模型连接提前结束')
  } catch (error) {
    if (res.destroyed) return
    console.error('[chatStream] 流式请求失败', error.name || 'Error')

    if (!res.headersSent) {
      return res.status(502).json({ error: 'AI 暂时没有回应' })
    }

    send({ error: 'AI 回复中断，请重试' })
    res.end()
  }
})

app.listen(9000)
