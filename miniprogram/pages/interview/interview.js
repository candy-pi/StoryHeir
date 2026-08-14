// 访谈页：核心闭环。老人可语音可文字，照片可选；AI 记者主动提问追问
// 语音走 asr 云函数（百炼 Paraformer），文字直接作为作答；首轮有照片走 Qwen-VL 看图，无照片走兜底开场
const api = require('../../utils/api.js')
const db = wx.cloud.database()

let recorderManager = null // 录音管理器全局单例，避免重复创建

Page({
  data: {
    photoTempPath: '',  // 照片本地预览（可选）
    photoFileID: '',    // 照片云端 ID，传给 AI 识别（可选）
    messages: [],       // 消息流 {role, text, loading}
    toView: '',         // scroll-into-view 锚点，自动滚到最新消息
    recording: false,
    recordTime: 0,      // 录音已录秒数（mp3 无实时音量帧，用计时给老人"录了多久"的直观反馈）
    recordText: '00:00',
    busy: false,        // 识别/AI 思考时禁用按钮，防误触
    inputMode: 'voice', // 作答方式：voice 语音 / text 文字（纸质版故事可直接粘贴）
    textInput: '',      // 文字输入内容
    // 方言识别（paraformer-v2 录音文件识别目前仅粤语，其它方言后续接入）
    dialect: 'zh',
    dialectIndex: 0,
    dialectOptions: ['普通话', '粤语（测试版）'],
    dialectCodes: ['zh', 'yue'],
    // 故事风格：documentary 纪实 / warm 温暖 / formal 正式，默认温暖
    style: 'warm',
    styleIndex: 1,
    styleOptions: ['纪实', '温暖', '正式'],
    styleCodes: ['documentary', 'warm', 'formal'],
    // 话题脚手架：无照片开场前给老人话题引子，点一下替他开口
    topics: [
      { label: '童年往事', text: '我想讲讲小时候的事' },
      { label: '父母亲', text: '我想讲讲我的父亲母亲' },
      { label: '老伙计', text: '我想讲讲一个老伙计' },
      { label: '第一份工', text: '我想讲讲我第一份工作' },
      { label: '过年', text: '我想讲讲从前过年的样子' },
      { label: '老房子', text: '我想讲讲我们家的老房子' },
      { label: '出远门', text: '我想讲讲第一次出远门' },
      { label: '心里话', text: '我有些话想留给后人' }
    ]
  },

  onLoad(options) {
    recorderManager = wx.getRecorderManager()
    recorderManager.onStop(res => this._onRecordStop(res))
    recorderManager.onError(() => {
      clearInterval(this._recTimer)
      this.setData({ recording: false })
      wx.showToast({ title: '录音出了点问题', icon: 'none' })
    })
    // 续访入口：故事页带 storyId 进入，预填原对话并自动接续追问
    if (options && options.storyId) this._startResume(options.storyId)
  },

  // 续访：打开原故事 → 预填原访谈对话 → 标记续访 → 自动触发首轮接续追问（不破冰）
  async _startResume(storyId) {
    wx.showLoading({ title: '打开故事中…' })
    try {
      const sres = await db.collection('story').doc(storyId).get()
      const story = sres.data
      if (!story) { wx.hideLoading(); return wx.showToast({ title: '故事不存在', icon: 'none' }) }
      // 拉原访谈对话用于预填 + 续访首轮上下文（拉不到则从空开始）
      let msgs = []
      if (story.interviewId) {
        try {
          const ires = await db.collection('interview').doc(story.interviewId).get()
          msgs = Array.isArray(ires.data.messages) ? ires.data.messages : []
        } catch (e) {}
      }
      this.storyId = storyId
      this.isResume = true
      const pre = msgs.filter(m => m && m.text).map(m => ({ role: m.role, text: m.text, loading: false }))
      this.setData({
        photoFileID: story.photoFileID || '',
        messages: pre,
        toView: pre.length ? `msg-${pre.length - 1}` : ''
      })
      // 续访首轮：让 AI 接续原故事、挑三要素薄弱处追问一个，而不是重新破冰
      if (pre.length) this._askAI(pre.map(m => ({ role: m.role, text: m.text })), true)
    } catch (e) {
      wx.showToast({ title: '打开失败，稍后再试', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  // 选老照片作为访谈引子（可选：很多老故事并没有照片留存）
  onChoosePhoto() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: res => {
        const tempPath = res.tempFiles[0].tempFilePath
        this.setData({ photoTempPath: tempPath })
        this._uploadPhotoAndStart(tempPath)
      }
    })
  },

  _uploadPhotoAndStart(tempPath) {
    wx.showLoading({ title: 'AI 正在看照片…' })
    const cloudPath = `photos/${Date.now()}-${Math.floor(Math.random() * 1000)}.jpg`
    wx.cloud.uploadFile({
      cloudPath,
      filePath: tempPath,
      success: res => {
        this.setData({ photoFileID: res.fileID })
        // 照片就绪，请 AI 记者基于照片开场提问
        this._askAI([])
      },
      fail: () => wx.showToast({ title: '照片上传失败', icon: 'none' }),
      complete: () => wx.hideLoading()
    })
  },

  // 访谈中补一张照片：上传后作为带图的用户消息插入，触发 AI 看新图追问
  onAddPhoto() {
    if (this.data.busy) return
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: res => this._uploadAddedPhoto(res.tempFiles[0].tempFilePath)
    })
  },

  _uploadAddedPhoto(tempPath) {
    wx.showLoading({ title: '上传照片…' })
    const cloudPath = `photos/${Date.now()}-${Math.floor(Math.random() * 1000)}.jpg`
    wx.cloud.uploadFile({
      cloudPath,
      filePath: tempPath,
      success: r => {
        // 插带图消息：text 占位可读，photoFileID 让 chat 末条带图 → 这轮看新图追问
        this._pushMessage('user', '（给记者看一张新照片）', false, r.fileID)
        this._askAI(this._historyForAI())
      },
      fail: () => wx.showToast({ title: '照片上传失败', icon: 'none' }),
      complete: () => wx.hideLoading()
    })
  },

  // 没有照片也能开始：直接触发首轮，chat 云函数走无照片兜底开场
  onStartNoPhoto() {
    if (this.data.busy || this.data.messages.length) return
    this._askAI([])
  },

  // 切换作答方式：语音 / 文字
  switchMode(e) {
    this.setData({ inputMode: e.currentTarget.dataset.m })
  },

  // 切换识别方言（picker 联动）
  onDialectChange(e) {
    const idx = Number(e.detail.value)
    this.setData({ dialectIndex: idx, dialect: this.data.dialectCodes[idx] })
  },

  // 切换故事风格（picker 联动）
  onStyleChange(e) {
    const idx = Number(e.detail.value)
    this.setData({ styleIndex: idx, style: this.data.styleCodes[idx] })
  },

  // 点按切换录音：老人手抖，点按比长按更稳
  onToggleRecord() {
    if (this.data.busy) return
    if (this.data.recording) {
      recorderManager.stop()
    } else {
      this._startRecord()
    }
  },

  _startRecord() {
    wx.getSetting({
      success: res => {
        // 未授权录音时引导开启，而非静默失败
        if (res.authSetting['scope.record'] === false) {
          wx.openSetting()
          return
        }
        recorderManager.start({
          duration: 600000,  // 最长 10 分钟，给老人充足讲述时间
          sampleRate: 16000,
          numberOfChannels: 1,
          encodeBitRate: 48000,
          format: 'mp3'
        })
        this.setData({ recording: true, recordTime: 0, recordText: '00:00' })
        // mp3 拿不到实时音量帧，用每秒计数给老人"录了多久"的反馈
        this._recTimer = setInterval(() => {
          const t = this.data.recordTime + 1
          const mm = String(Math.floor(t / 60)).padStart(2, '0')
          const ss = String(t % 60).padStart(2, '0')
          this.setData({ recordTime: t, recordText: `${mm}:${ss}` })
        }, 1000)
      }
    })
  },

  // 录音停止：上传 → 识别 → 把回答交给 AI 追问
  async _onRecordStop(res) {
    clearInterval(this._recTimer)
    this.setData({ recording: false })
    // 录音过短识别必失败：提示而非空跑一次云函数识别
    if (this.data.recordTime < 2) {
      wx.showToast({ title: '太短啦，多讲几句试试', icon: 'none' })
      return
    }
    this.setData({ busy: true })
    wx.showLoading({ title: '正在识别…' })
    try {
      const fileID = await this._uploadAudio(res.tempFilePath)
      const text = await api.call('asr', { fileID, dialect: this.data.dialect })
      this._pushMessage('user', text)
      await this._askAI(this._historyForAI())
    } catch (e) {
      wx.showToast({ title: '没听清，再说一次？', icon: 'none' })
    } finally {
      this.setData({ busy: false })
      wx.hideLoading()
    }
  },

  _uploadAudio(tempFilePath) {
    const cloudPath = `audio/${Date.now()}.mp3`
    return new Promise((resolve, reject) => {
      wx.cloud.uploadFile({
        cloudPath,
        filePath: tempFilePath,
        success: r => resolve(r.fileID),
        fail: reject
      })
    })
  },

  // 文字作答：纸质版故事可直接打字或粘贴，提交后与语音一样进入对话
  async onSendText() {
    const text = (this.data.textInput || '').trim()
    if (!text || this.data.busy) return
    this.setData({ textInput: '' })
    this._pushMessage('user', text)
    await this._askAI(this._historyForAI())
  },

  // 点话题 chip：替老人预填一条话术开口，AI 顺着话题问第一个问题
  async onPickTopic(e) {
    if (this.data.busy || this.data.messages.length) return
    const text = e.currentTarget.dataset.text
    this._pushMessage('user', text)
    await this._askAI(this._historyForAI())
  },

  onTextInput(e) {
    this.setData({ textInput: e.detail.value })
  },

  // 调 chat 云函数拿到 AI 记者的下一句。
  // chat 返回 { reply, clues }：首轮有照片时 clues 是 VL 抽的照片线索，
  // 缓存到 this.photoClues，后续每轮带上，引导 AI 主动追问没聊到的点
  async _askAI(history, resume) {
    this._pushMessage('assistant', '', true) // 先放"思考中"占位气泡
    this.setData({ busy: true })
    try {
      const { reply, clues } = await api.call('chat', {
        photoFileID: this.data.photoFileID,
        history,
        photoClues: this.photoClues || [],
        resume: !!resume   // 续访首轮为 true：让 AI 接续追问而非破冰
      })
      // 首轮带回来的线索缓存一次即可，之后复用，不覆盖
      if (Array.isArray(clues) && clues.length && !this.photoClues) this.photoClues = clues
      // 用真实回复替换占位气泡
      const messages = this.data.messages.slice()
      messages[messages.length - 1] = { role: 'assistant', text: reply, loading: false }
      this.setData({ messages, toView: `msg-${messages.length - 1}` })
    } catch (e) {
      // 失败则移除占位气泡，避免界面卡住
      this.setData({ messages: this.data.messages.slice(0, -1) })
    } finally {
      this.setData({ busy: false })
    }
  },

  _pushMessage(role, text, loading = false, photoFileID) {
    const msg = { role, text, loading }
    if (photoFileID) msg.photoFileID = photoFileID   // 带图消息：补图时让 chat 末条带图、走看图追问
    const messages = this.data.messages.concat([msg])
    this.setData({ messages, toView: `msg-${messages.length - 1}` })
  },

  // 给 AI 的历史：去掉 loading 等渲染字段，过滤空消息
  _historyForAI() {
    return this.data.messages
      .filter(m => !m.loading && m.text)
      .map(m => {
        const o = { role: m.role, text: m.text }
        if (m.photoFileID) o.photoFileID = m.photoFileID   // 透传带图标记，chat 据此判断这轮看新图
        return o
      })
  },

  // 把访谈内容交给 genStory 云函数，生成可分享的家族故事
  async onGenStory() {
    if (this.data.busy) return
    const history = this._historyForAI()
    if (history.length < 2) {
      wx.showToast({ title: '先和 AI 多聊几句', icon: 'none' })
      return
    }
    this.setData({ busy: true })
    wx.showLoading({ title: '正在撰写故事…' })
    try {
      const story = await api.call('genStory', {
        history,
        photoFileID: this.data.photoFileID,
        style: this.data.style,
        // 续访模式带 storyId：云函数 update 原故事而非新增；首次成稿留空走 add
        storyId: this.isResume ? this.storyId : ''
      })
      // 续访：返回原故事页并就地刷新它（故事页就在栈下一层），避免压入重复页 / 显示旧内容
      if (this.isResume) {
        const pages = getCurrentPages()
        const prev = pages[pages.length - 2]
        if (prev && prev.route === 'pages/story/story' && prev._loadFromCloud) {
          prev._loadFromCloud(this.storyId)
          wx.navigateBack()
        } else {
          wx.navigateTo({ url: `/pages/story/story?id=${this.storyId}` })
        }
        return
      }
      wx.setStorageSync('lastStory', story)
      if (story && story._id) {
        // 落库成功：带 id 跳转，story 页从云数据库读，列表 / 下次回看都走同一条记录
        wx.navigateTo({ url: `/pages/story/story?id=${story._id}` })
      } else {
        // 故事生成但没落库：本次靠本地缓存能看，但不会进列表、下次就丢，提示去查集合
        wx.showModal({
          title: '生成成功但未保存',
          content: '故事已生成，但没存进云端，刷新或换设备就看不到了。请到云开发控制台确认 story、interview 两个集合已创建。',
          showCancel: false,
          confirmText: '先看看'
        })
        wx.navigateTo({ url: '/pages/story/story' })
      }
    } catch (e) {
      // 续访非作者时云函数返回"仅作者可完善"等明确信息，直接透出比"生成失败"更友好
      wx.showToast({ title: (e && e.message) || '生成失败，稍后再试', icon: 'none' })
    } finally {
      this.setData({ busy: false })
      wx.hideLoading()
    }
  }
})
