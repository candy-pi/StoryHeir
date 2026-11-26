// 故事展示页：家族故事 + 老照片 AI 上色 + 人物关系图（网状）+ 家人共建（补充/校对/认人）
// 进入：列表或分享带 ?id= → 从云数据库读；刚生成无 id → 从本地 storage 读

const db = wx.cloud.database()
const api = require('../../utils/api.js')
const TYPE_LABEL = { supplement: '补充', correct: '校对', identify: '认人' }
const STYLE_LABEL = { documentary: '纪实版', warm: '温暖版', formal: '正式版' }

// 点到线段最短距离：点边判定时，判断点击坐标离哪条连线最近
function pointToSegDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1)
  const t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)
  const tc = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (x1 + tc * dx), py - (y1 + tc * dy))
}

Page({
  data: {
    story: null,
    loading: true,      // 故事填充前显示骨架，避免空白像卡死
    personNames: [],     // 认人 picker 的候选人物名
    contributions: [],   // 家人补充列表
    myNick: '',          // 当前用户称呼，存 storage 复用
    ctype: 'supplement', // 当前补充类型
    cperson: '',         // 认人：选中人物 id
    cpersonName: '',     // 认人：选中人物名（显示）
    ccontent: '',        // 补充内容
    styleLabel: '',      // 故事风格标签，如"温暖版"，旧数据为空
    colorizedFileID: '', // 老照片 AI 上色后的彩色图 fileID，空则显示原图
    photos: [],          // 故事照片集（多图轮播；photoFileIDs 优先，回退单图 photoFileID）
    colorizing: false,   // 上色进行中标记，防重复点击
    editing: false,      // 编辑模式：只改标题与正文
    editTitle: '',       // 编辑态标题暂存
    editContent: '',     // 编辑态正文暂存
    relPopup: null,      // 关系详情弹层数据 {a,b,label,co}，null 表示隐藏
    reading: false       // 朗读中标记：true 时按钮变为"暂停朗读"
  },

  onLoad(options) {
    this.setData({ myNick: wx.getStorageSync('myNick') || '' })
    if (options.id) {
      this._loadFromCloud(options.id)
    } else {
      this._loadFromStorage()
    }
  },

  // 从云数据库按 id 读取（分享 / 列表回看场景）
  async _loadFromCloud(id) {
    try {
      const res = await db.collection('story').doc(id).get()
      this.storyId = id
      this._fillStory(res.data)
      this.loadContributions(id)
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: '故事不见了', icon: 'none' })
    }
  },

  // 从本地 storage 读取（刚生成、尚未进列表时）
  _loadFromStorage() {
    const story = wx.getStorageSync('lastStory') || {}
    if (!story.content) {
      this.setData({ loading: false })
      wx.showToast({ title: '还没有故事', icon: 'none' })
      return
    }
    this._fillStory(story)
  },

  // 统一填充 + 触发关系图绘制
  _fillStory(story) {
    story.persons = Array.isArray(story.persons) ? story.persons : []
    story.relations = Array.isArray(story.relations) ? story.relations : []
    // 多图：photoFileIDs 优先，旧数据回退单图 photoFileID；colorizedFileID 是主图(首张)的彩色版
    const photos = (Array.isArray(story.photoFileIDs) && story.photoFileIDs.length)
      ? story.photoFileIDs
      : (story.photoFileID ? [story.photoFileID] : [])
    this.setData({
      story,
      loading: false,
      personNames: story.persons.map(p => p.name),
      styleLabel: STYLE_LABEL[story.style] || '',
      colorizedFileID: story.colorizedFileID || '',
      photos
    })
    // setData 异步，下一帧再拿 canvas 节点画图，确保节点已挂载
    if (story.persons.length) setTimeout(() => this.drawGraph(), 60)
  },

  // 关系图（原生 canvas 2d 手绘）：人物均匀排成圆环、边连成弦，点边弹层
  // 用 canvas 而非 echarts：避开第三方库在小程序的初始化时序坑，确保一定能画出来
  drawGraph() {
    const { persons, relations } = this.data.story
    if (!persons.length) return
    const query = wx.createSelectorQuery().in(this)
    query.select('#graphCanvas').fields({ node: true, size: true }).exec(res => {
      if (!res[0] || !res[0].node) return
      const canvas = res[0].node
      const ctx = canvas.getContext('2d')
      const W = res[0].width, H = res[0].height
      const dpr = (wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2
      canvas.width = W * dpr
      canvas.height = H * dpr
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, W, H)

      // 圆形均匀布局：从正上方顺时针铺开，避免力导向的收敛不稳
      const n = persons.length
      const cx = W / 2, cy = H / 2
      const R = Math.min(W, H) / 2 - 34
      const pos = {}
      persons.forEach((p, i) => {
        const ang = -Math.PI / 2 + (i / n) * Math.PI * 2
        pos[p.id] = { x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang), name: p.name }
      })
      this._nodePos = pos // 供点边判定用

      // 先画边（在节点下层）：直线连接两人
      ;(relations || []).forEach(r => {
        const a = pos[r.from], b = pos[r.to]
        if (!a || !b) return
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.strokeStyle = '#C9B79C'
        ctx.lineWidth = 2
        ctx.stroke()
      })

      // 再画节点：小圆点带阴影 + 白边 + 称呼
      Object.values(pos).forEach(p => {
        ctx.beginPath()
        ctx.arc(p.x, p.y, 16, 0, Math.PI * 2)
        ctx.fillStyle = '#A0522D'
        ctx.shadowBlur = 6
        ctx.shadowColor = 'rgba(160,82,45,0.35)'
        ctx.fill()
        ctx.shadowBlur = 0
        ctx.lineWidth = 3
        ctx.strokeStyle = '#fff'
        ctx.stroke()
        ctx.fillStyle = '#2B2218'
        ctx.font = '16px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(p.name, p.x, p.y - 24)
      })
    })
  },

  // 点关系图：命中某条边则弹两人关系 + 同框情节
  // 用 touch 事件的 touches[0].x/y（canvas 专属，相对画布逻辑坐标）而非 bindtap.detail，后者基准不可靠
  onGraphTap(e) {
    const pos = this._nodePos
    const { relations } = this.data.story
    const t = e.touches && e.touches[0]
    if (!pos || !relations || !relations.length || !t || typeof t.x !== 'number') return
    const x = t.x, y = t.y
    for (const r of relations) {
      const a = pos[r.from], b = pos[r.to]
      if (!a || !b) continue
      // 阈值 20px：线只有 2px，手指点偏也能命中
      if (pointToSegDist(x, y, a.x, a.y, b.x, b.y) < 20) {
        this.openRelPopup({ source: r.from, target: r.to, value: r.label })
        return
      }
    }
  },

  // 一键给老照片 AI 上色（万相 wanx2.1-imageedit colorization）
  // 上色在云函数完成并写回 story 记录，家人刷新也能看到同一张彩色照
  async onColorize() {
    if (this.data.colorizing) return
    if (!this.storyId) return wx.showToast({ title: '请从故事列表打开', icon: 'none' })
    this.setData({ colorizing: true })
    wx.showLoading({ title: '正在为老照片上色…', mask: true })
    try {
      const { fileID } = await api.call('restore', { storyId: this.storyId })
      this.setData({ colorizedFileID: fileID })
      wx.showToast({ title: '上色完成', icon: 'success' })
    } catch (e) {
      // 失败提示由 api.call 统一处理，这里只兜底收尾
    } finally {
      this.setData({ colorizing: false })
      wx.hideLoading()
    }
  },

  // 一键朗读故事正文：看不清也能听。有缓存直接播，无则先合成（Qwen-TTS）再播
  // 音频存云存储后缓存到 story.ttsFileID，二次播放即时出声、0 成本
  async onRead() {
    // 已创建过音频实例：复用做播/停切换，避免重复合成
    if (this._audio) {
      if (this.data.reading) { this._audio.pause(); this.setData({ reading: false }) }
      else { this._audio.play(); this.setData({ reading: true }) }
      return
    }
    if (!this.storyId) return wx.showToast({ title: '请从故事列表打开', icon: 'none' })
    wx.showLoading({ title: '正在准备朗读…', mask: true })
    try {
      // 有缓存（之前合成过）直接播；否则调云函数合成并写回 story.ttsFileID
      let fileID = this.data.story.ttsFileID
      if (!fileID) {
        const res = await api.call('tts', { storyId: this.storyId })
        fileID = res.fileID
        this.setData({ 'story.ttsFileID': fileID })
      }
      const audio = wx.createInnerAudioContext()
      audio.src = fileID
      audio.onEnded(() => this.setData({ reading: false }))
      audio.onError(() => { this.setData({ reading: false }); wx.showToast({ title: '朗读播放失败', icon: 'none' }) })
      this._audio = audio
      audio.play()
      this.setData({ reading: true })
    } catch (e) {
      // 失败提示由 api.call 统一处理
    } finally {
      wx.hideLoading()
    }
  },

  // 离开页面必停音频，否则老人返回上一页朗读声还在响
  onUnload() {
    if (this._audio) {
      this._audio.stop()
      this._audio.destroy()
      this._audio = null
    }
  },

  // 拉家人补充 / 校对 / 认人记录
  async loadContributions(storyId) {
    try {
      const res = await db.collection('contribution')
        .where({ storyId })
        .orderBy('createdAt', 'asc')
        .get()
      // 认人记录要把 targetPersonId 翻成可读的人名
      const pmap = {}
      ;(this.data.story && this.data.story.persons || []).forEach(p => { pmap[p.id] = p.name })
      this.setData({
        contributions: res.data.map(c => ({
          ...c,
          typeLabel: TYPE_LABEL[c.type] || '补充',
          personName: pmap[c.targetPersonId] || '',
          timeText: this._fmtTime(c.createdAt)
        }))
      })
    } catch (e) {
      // 集合未建或权限未开时静默
    }
  },

  // 发布一条补充 / 校对 / 认人
  async publishContribution() {
    const { myNick, ctype, cperson, ccontent } = this.data
    if (!myNick || !myNick.trim()) return wx.showToast({ title: '先填一下称呼', icon: 'none' })
    if (ctype === 'identify' && !cperson) return wx.showToast({ title: '选一个人物', icon: 'none' })
    if (!ccontent.trim()) return wx.showToast({ title: '写点什么吧', icon: 'none' })
    if (!this.storyId) return wx.showToast({ title: '请从故事列表打开', icon: 'none' })
    try {
      await db.collection('contribution').add({
        data: {
          storyId: this.storyId,
          nickName: myNick.trim(),
          type: ctype,
          targetPersonId: cperson || '',
          content: ccontent.trim(),
          createdAt: db.serverDate()
        }
      })
      this.setData({ ccontent: '', cperson: '', cpersonName: '' })
      this.loadContributions(this.storyId)
      wx.showToast({ title: '感谢补充', icon: 'success' })
    } catch (e) {
      // 暴露真实错误到控制台：最常见是 contribution 集合未在云开发控制台创建，或写权限不足
      console.error('[publishContribution]', e)
      wx.showToast({ title: '提交失败，稍后再试', icon: 'none' })
    }
  },

  // 继续完善这个故事：进入续访，带着原对话让小传再采访一轮、把故事织得更完整
  onResume() {
    if (!this.storyId) return wx.showToast({ title: '请从故事列表打开', icon: 'none' })
    wx.navigateTo({ url: `/pages/interview/interview?storyId=${this.storyId}` })
  },

  // 进入编辑模式：只改标题与正文。需 storyId（本地兜底的无 id 故事不能改）
  onEdit() {
    if (!this.storyId) return wx.showToast({ title: '请从故事列表打开', icon: 'none' })
    this.setData({
      editing: true,
      editTitle: this.data.story.title || '',
      editContent: this.data.story.content || ''
    })
  },
  onCancelEdit() {
    this.setData({ editing: false })
  },
  onTitleInput(e) { this.setData({ editTitle: e.detail.value }) },
  onEditInput(e) { this.setData({ editContent: e.detail.value }) },

  // 保存编辑：更新 title/content；persons/relations 不动，关系图无需重画
  async onSaveEdit() {
    const title = (this.data.editTitle || '').trim()
    const content = (this.data.editContent || '').trim()
    if (!title) return wx.showToast({ title: '标题不能为空', icon: 'none' })
    wx.showLoading({ title: '保存中…', mask: true })
    try {
      await db.collection('story').doc(this.storyId).update({ data: { title, content } })
      // 同步本地 story，免得再读一次库
      this.setData({ 'story.title': title, 'story.content': content, editing: false })
      wx.showToast({ title: '已保存', icon: 'success' })
    } catch (e) {
      // 多为权限不足（非创建者）或网络异常
      wx.showModal({ title: '保存失败', content: '只有故事作者能修改，或网络异常稍后再试', showCancel: false })
    } finally {
      wx.hideLoading()
    }
  },

  // 删除故事：二次确认后删 story + 关联 interview，返回列表（onShow 自动刷新）
  onDelete() {
    wx.showModal({
      title: '删除这个故事？',
      content: '删除后不可恢复，关联的访谈记录也会一并删除。',
      confirmText: '删除',
      confirmColor: '#b03a2e',
      success: async res => {
        if (!res.confirm || this._deletingStory) return
        this._deletingStory = true
        wx.showLoading({ title: '删除中…', mask: true })
        try {
          if (this.storyId) await api.call('family', { action: 'deleteStory', storyId: this.storyId })
          const cached = wx.getStorageSync('lastStory')
          if (cached && (this.storyId ? cached._id === this.storyId : !cached._id)) {
            wx.removeStorageSync('lastStory')
          }
          this.setData({ story: null })
          wx.showToast({ title: '已删除', icon: 'success' })
          // 返回列表（onShow 自动刷新）；从分享打开无上一页时回首页
          const pages = getCurrentPages()
          setTimeout(() => {
            if (pages.length > 1) wx.navigateBack()
            else wx.reLaunch({ url: '/pages/index/index' })
          }, 600)
        } catch (e) {
          wx.showModal({ title: '删除失败', content: '只有故事作者能删除，或网络异常稍后再试', showCancel: false })
        } finally {
          this._deletingStory = false
          wx.hideLoading()
        }
      }
    })
  },

  onNickBlur(e) {
    const v = e.detail.value
    this.setData({ myNick: v })
    wx.setStorageSync('myNick', v)
  },
  setType(e) { this.setData({ ctype: e.currentTarget.dataset.t }) },
  onPersonChange(e) {
    const p = this.data.story.persons[+e.detail.value]
    this.setData({ cperson: p.id, cpersonName: p.name })
  },
  onContentInput(e) { this.setData({ ccontent: e.detail.value }) },

  // 简单时间格式：今天显示"今天"，否则"X月X日"
  _fmtTime(t) {
    if (!t) return ''
    const d = new Date(t)
    const now = new Date()
    if (d.toDateString() === now.toDateString()) return '今天'
    return `${d.getMonth() + 1}月${d.getDate()}日`
  },

  // 从正文里提取两人同框的句子（同时含两人称呼），按句切，取前 3 条
  coMention(content, aName, bName) {
    if (!content || !aName || !bName) return []
    const sents = content.split(/[。！？\n；]/).map(s => s.trim()).filter(s => s.length)
    return sents.filter(s => s.includes(aName) && s.includes(bName)).slice(0, 3)
  },

  // 点边后填充弹层：两人称呼、关系名、同框情节
  openRelPopup(link) {
    const { persons, content } = this.data.story
    const aP = persons.find(p => p.id === link.source)
    const bP = persons.find(p => p.id === link.target)
    this.setData({
      relPopup: {
        a: (aP && aP.name) || '某',
        b: (bP && bP.name) || '某',
        label: link.value || '',
        co: this.coMention(content, aP && aP.name, bP && bP.name)
      }
    })
  },

  closeRelPopup() {
    this.setData({ relPopup: null })
  },

  // 分享到家族群：带 id 让家人也能打开看
  onShareAppMessage() {
    const s = this.data.story || {}
    if (s.familyId && s.familyStoryId) {
      return {
        title: s.title || '我们家的故事',
        path: `/pages/family/family?familyId=${encodeURIComponent(s.familyId)}&storyId=${encodeURIComponent(s.familyStoryId)}`
      }
    }
    const id = s._id ? `?id=${s._id}` : ''
    return {
      title: s.title || '我们家的故事',
      path: `/pages/story/story${id}`
    }
  }
})
