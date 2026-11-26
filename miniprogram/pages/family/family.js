const api = require('../../utils/api')
const app = getApp()
const call = (action, data) => api.call('family', { action, ...data })

Page({
  data: { families: [], familyId: '', familyName: '', people: [], stories: [],
    name: '', invite: '', narratorName: '', reporterName: '', narratorId: '',
    sourceId: '', reading: null, showTranscript: false,
    canInvite: false, canPublish: false,
    values: [], valuesLoaded: false, valuePop: null,
    more: false, busy: false, error: '' },

  onLoad(options) {
    this.setData({ sourceId: options.sourceId || '', invite: options.invite || '' })
    this.run(async () => {
      await this.refreshFamilies(options.familyId)
      if (options.familyId && options.storyId) {
        if (this.data.familyId !== options.familyId) {
          throw new Error('请先加入这个家族，再打开故事')
        }
        await this.read(options.storyId)
      }
    })
  },

  async run(work) {
    if (this.data.busy) return
    this.setData({ busy: true, error: '' })
    try { await work() } catch (error) {
      this.setData({ error: error.message || '操作失败，请稍后重试' })
    } finally { this.setData({ busy: false }) }
  },

  input(event) {
    const field = event.currentTarget.dataset.field
    const next = { [field]: event.detail.value }
    if (field === 'narratorName') {
      next.narratorId = ''
      next.selectedNarrator = ''
    }
    this.setData(next, () => this.updateCanPublish())
  },

  updateCanPublish() {
    this.setData({
      canPublish: !!(
        (this.data.narratorId || (this.data.narratorName || '').trim()) &&
        (this.data.reporterName || '').trim()
      )
    })
  },

  async refreshFamilies(preferredId) {
    const families = await call('list')
    this.setData({ families })
    const family = families.find(item => item._id === preferredId) ||
      families.find(item => item._id === app.globalData.currentFamilyId) || families[0]
    if (family) await this.openFamily(family)
  },

  async openFamily(family) {
    const page = await call('browse', { familyId: family._id })
    app.globalData.currentFamilyId = family._id
    this.setData({ familyId: family._id, familyName: family.name, reading: null,
      narratorId: '', selectedNarrator: '', canPublish: false,
      people: page.people, stories: page.stories,
      values: this.formatValues(page.values || []), valuesLoaded: true, valuePop: null,
      canInvite: page.canInvite, more: page.stories.length === 20 })
  },

  formatValues(values) {
    return values.slice().sort((a, b) => (b.count || 0) - (a.count || 0)).map(value => ({
      ...value,
      sizeClass: value.count >= 3 ? 'lg' : value.count === 2 ? 'md' : 'sm'
    }))
  },

  async refreshValues() {
    if (!this.data.familyId || this.data.busy) return
    this.setData({ busy: true, error: '' })
    wx.showLoading({ title: '正在提炼家风…', mask: true })
    try {
      const result = await api.call('extractValues', { familyId: this.data.familyId })
      const values = this.formatValues(result?.values || [])
      this.setData({ values, valuesLoaded: true })
      wx.showToast({ title: values.length ? '家风已更新' : '暂未提炼出家风', icon: 'none' })
    } catch (error) {
      this.setData({ error: error.message || '家风提炼失败' })
    } finally {
      this.setData({ busy: false })
      wx.hideLoading()
    }
  },

  onTapValue(event) {
    this.setData({ valuePop: this.data.values[Number(event.currentTarget.dataset.idx)] })
  },

  closeValuePop() { this.setData({ valuePop: null }) },

  goToChronicle() {
    if (!this.data.familyId) return
    wx.navigateTo({ url: `/pages/chronicle/chronicle?familyId=${encodeURIComponent(this.data.familyId)}` })
  },

  pickFamily(event) {
    const family = this.data.families[Number(event.detail.value)]
    if (family) this.run(() => this.openFamily(family))
  },

  create() {
    this.run(async () => {
      const family = await call('create', { name: this.data.name })
      this.setData({ name: '' })
      await this.refreshFamilies(family._id)
    })
  },

  join() {
    this.run(async () => {
      const family = await call('join', { invite: this.data.invite.trim() })
      this.setData({ invite: '' })
      await this.refreshFamilies(family._id)
    })
  },

  copyInvite() {
    this.run(async () => {
      const code = await call('invite', { familyId: this.data.familyId })
      wx.setClipboardData({ data: code })
    })
  },

  pickNarrator(event) {
    const person = this.data.people[Number(event.detail.value)]
    if (person) this.setData({
      narratorId: person._id,
      selectedNarrator: person.name,
      narratorName: ''
    }, () => this.updateCanPublish())
  },

  addNarrator() {
    this.run(async () => {
      const person = await call('addNarrator', { familyId: this.data.familyId, name: this.data.narratorName })
      this.setData({ people: this.data.people.concat(person), narratorId: person._id,
        selectedNarrator: person.name, narratorName: '' }, () => this.updateCanPublish())
    })
  },

  publish() {
    this.run(async () => {
      const { familyId, reporterName, sourceId: storyId } = this.data
      let narratorId = this.data.narratorId
      if (!narratorId) {
        const person = await call('addNarrator', {
          familyId,
          name: (this.data.narratorName || '').trim()
        })
        narratorId = person._id
      }
      const published = await call('publish', { familyId, narratorId, reporterName, storyId })
      this.setData({ sourceId: '' })
      await this.refreshFamilies(familyId)
      await this.read(published._id)
      wx.showToast({ title: '已发布', icon: 'success' })
    })
  },

  moreStories() {
    this.run(async () => {
      const { familyId, stories } = this.data
      const page = await call('browse', { familyId, skip: stories.length })
      this.setData({ stories: stories.concat(page.stories), more: page.stories.length === 20 })
    })
  },

  openStory(event) {
    this.run(() => this.read(event.currentTarget.dataset.id))
  },

  async read(storyId) {
    const reading = await call('read', { familyId: this.data.familyId, storyId })
    this.setData({ reading: { ...reading, storyId }, showTranscript: false })
  },

  toggleTranscript() {
    this.setData({ showTranscript: !this.data.showTranscript })
  },

  deleteReading() {
    const { reading, familyId, busy } = this.data
    if (!reading?.canDelete || busy) return
    wx.showModal({
      title: '删除这篇故事？',
      content: '故事及关联访谈删除后无法恢复。',
      confirmText: '删除',
      confirmColor: '#a23220',
      success: result => {
        if (!result.confirm) return
        this.run(async () => {
          const { sourceId } = await call('deleteStory', { familyId, familyStoryId: reading.storyId })
          if (sourceId && wx.getStorageSync('lastStory')?._id === sourceId) wx.removeStorageSync('lastStory')
          this.closeStory()
          this.setData({ stories: this.data.stories.filter(item => item._id !== reading.storyId) })
          wx.showToast({ title: '已删除', icon: 'success' })
          await this.refreshFamilies(familyId)
        })
      }
    })
  },

  listen() {
    this.run(async () => {
      this.stopAudio()
      const reading = this.data.reading
      if (!reading || this.hidden) return
      const { audioUrl } = await api.call('tts', {
        familyId: this.data.familyId, familyStoryId: reading.storyId
      })
      if (this.hidden || this.data.reading?.storyId !== reading.storyId) return
      const audio = wx.createInnerAudioContext()
      this.audio = audio
      audio.onEnded(() => {
        if (this.audio === audio) this.stopAudio()
      })
      audio.onError(() => {
        if (this.audio !== audio) return
        this.stopAudio()
        this.setData({ error: '音频播放失败，请稍后重试' })
      })
      audio.src = audioUrl.replace(/^http:\/\//, 'https://')
      audio.play()
    })
  },

  stopAudio() {
    const audio = this.audio
    this.audio = null
    if (audio) audio.destroy()
  },

  onShow() { this.hidden = false },
  onHide() { this.hidden = true; this.stopAudio() },
  onUnload() { this.hidden = true; this.stopAudio() },

  onShareAppMessage() {
    const { reading, familyId } = this.data
    return reading
      ? { title: reading.title, path: '/pages/family/family?familyId=' +
        encodeURIComponent(familyId) + '&storyId=' + encodeURIComponent(reading.storyId) }
      : { title: '家族故事库', path: '/pages/family/family' }
  },

  closeStory() {
    this.stopAudio()
    this.setData({ reading: null, showTranscript: false })
  }
})
