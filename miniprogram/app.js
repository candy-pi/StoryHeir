// app.js —— 小程序入口
const config = require('./config.js')

App({
  onLaunch() {
    // 初始化云开发：访谈录音、故事数据、AI 云函数都依赖它
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
      return
    }
    wx.cloud.init({
      env: config.envId,
      traceUser: true
    })
  },

  // 全局状态：当前选中的家族，简化多页面间传参
  globalData: {
    currentFamilyId: null,
    userInfo: null
  }
})
