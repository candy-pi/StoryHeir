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

module.exports = { call }
