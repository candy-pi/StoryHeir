// utils/api.js —— 云函数调用统一封装
// 目的：把 wx.cloud.callFunction 的样板代码收口，统一错误提示，调用处更简洁
const config = require('../config.js')

/**
 * 调用云函数
 * @param {string} fnKey config.cloudFns 中的键名，避免硬编码函数名
 * @param {object} data 入参
 * @returns {Promise<any>} 云函数 result
 */
function call(fnKey, data = {}) {
  const name = config.cloudFns[fnKey]
  return wx.cloud.callFunction({ name, data })
    .then(res => {
      // 云函数内部约定：result.code === 0 为成功，其余为业务错误
      if (res.result && res.result.code !== 0) {
        return Promise.reject(new Error(res.result.message || '云函数返回异常'))
      }
      return res.result ? res.result.data : null
    })
    .catch(err => {
      console.error(`[callFunction:${name}]`, err)
      // 真实失败原因进开发者控制台；对老人只给一句友好的轻提示。
      // 调用处若有更贴切的文案（如"没听清""生成失败"）会自行覆盖此 toast。
      wx.showToast({ title: '网络开小差了，稍后再试', icon: 'none' })
      return Promise.reject(err)
    })
}

function streamChat(data, onDelta) {
  return new Promise((resolve, reject) => {
    let pendingLine = ''
    let finished = false

    wx.cloud.callHTTPFunction({
      name: 'chatStream',
      path: '/chat',
      method: 'post',
      header: { 'Content-Type': 'application/json' },
      data,
      enableChunked: true,

      onChunkedReceived({ data: chunk }) {
        if (finished) return

        try {
          for (const byte of new Uint8Array(chunk)) {
            if (byte !== 10) {
              pendingLine += '%' + byte.toString(16).padStart(2, '0')
              continue
            }

            const line = decodeURIComponent(pendingLine)
            pendingLine = ''
            if (!line.startsWith('data:')) continue

            const event = JSON.parse(line.slice(5))
            if (event.error) throw new Error(event.error)
            if (event.done === true) {
              finished = true
              resolve()
              return
            }
            if (typeof event.delta === 'string') onDelta(event.delta)
          }
        } catch (error) {
          finished = true
          reject(error)
        }
      },

      success({ statusCode }) {
        if (finished) return
        finished = true
        reject(new Error(`流式回复未收到结束标记（HTTP ${statusCode}）`))
      },

      fail(error) {
        finished = true
        reject(error)
      }
    })
  })
}

module.exports = { call, streamChat }
