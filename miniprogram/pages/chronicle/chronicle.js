// 家族编年志：把多篇家族故事按事件年代汇编成册
// 通过 family 云函数读取当前家族故事，成员权限在云端校验。
// era 由 genStory 抽取（四位年份）；旧数据无 era 则扫正文历史时期词兜底定位（不回退收录年）

const api = require('../../utils/api')
const call = (action, data) => api.call('family', { action, ...data })

// 年代中文标签；2000 年后中文称呼不统一且易歧义，统一改阿拉伯数字更直观
const DECADE_LABEL = {
  1930: '三十年代', 1940: '四十年代', 1950: '五十年代',
  1960: '六十年代', 1970: '七十年代', 1980: '八十年代',
  1990: '九十年代', 2000: '2000年代', 2010: '2010年代', 2020: '2020年代'
}

Page({
  data: {
    ready: false,
    empty: false,
    book: null,        // { count, span, chapters:[{ decade, range, stories, toneClass }] }
    valuesText: ''     // 家风关键词拼接，封面展示；空则不显示家风行
  },

  onLoad(options) {
    this.familyId = (options && options.familyId) || ''
    if (!this.familyId) {
      this.setData({ ready: true, empty: true })
      return
    }
    this.loadChronicle()
  },

  // 下拉刷新：补了新故事后，老人不必退出重进，下拉即重新汇编
  async onPullDownRefresh() {
    await this.loadChronicle()
    wx.stopPullDownRefresh()
  },

  // 从 era 归一化出一个年份，用于时间线定位与排序
  // 老人口述时间常模糊（89年、八十年代初），需逐级兜底，避免被误判成"年代不详"
  parseYear(story) {
    const raw = (story.era || '').trim()
    // 1. 四位年份（19xx / 20xx）最优先
    let m = raw.match(/(19|20)\d{2}/)
    if (m) {
      const y = parseInt(m[0], 10)
      if (y >= 1900 && y <= 2099) return y
    }
    // 2. 年代词："八十年代"→1980；"80年代"→1980（取该年代首年）
    const decadeCN = { '三十':1930,'四十':1940,'五十':1950,'六十':1960,'七十':1970,'八十':1980,'九十':1990 }
    let dm = raw.match(/(三十|四十|五十|六十|七十|八十|九十)年代/)
    if (dm && decadeCN[dm[1]]) return decadeCN[dm[1]]
    dm = raw.match(/(\d{1,2})\s*年代/)
    // "80年代"→1980：head 已是年代数(80)，直接加到 1900；不是乘 10（否则 80→2700）
    if (dm) { const head = parseInt(dm[1], 10); return 1900 + head }
    // 3. 两位年份："89年" / 裸"89" → 家族故事多落 20 世纪：≥24 补 19xx，否则 20xx
    let two = raw.match(/(\d{2})\s*年/)
    if (!two) two = raw.match(/^(\d{2})$/)
    if (two) {
      const n = parseInt(two[1], 10)
      return n >= 24 ? 1900 + n : 2000 + n
    }
    // 4. era 判断不出时，扫正文里的历史时期词兜底定位（如"解放前后""抗战""插队"）
    const byText = this._eraFromText(raw + ' ' + (story.content || ''))
    if (byText) return byText
    // 5. 都判断不出 → 返回 null 归入"岁月留痕"。不用收录年冒充故事年代，
    //    否则刚录入的老故事会被错算成今年（如解放前后的往事被当成 2026）
    return null
  },

  // 从文本识别历史时期关键词 → 粗略年份，给 era 缺失的老故事兜底定位
  _eraFromText(text) {
    const rules = [
      [/解放前后|解放初|新中国成立|建国初|四九年/, 1949],
      [/抗战|抗日|兵荒马乱|逃难|溃兵/, 1940],
      [/大跃进|三年困难|闹饥荒|六〇年/, 1960],
      [/上山下乡|插队|知青|文革/, 1969],
      [/改革开放|个体户|下海/, 1980]
    ]
    for (const r of rules) if (r[0].test(text)) return r[1]
    return null
  },

  // 年代 → 色档：给编年志章节配代表色，翻阅时不同年代有视觉区分（时间纵深感）
  _toneFor(decade) {
    const d = Number(decade)
    if (!d) return 'tone-unknown'
    if (d <= 1940) return 'tone-early'
    if (d <= 1960) return 'tone-mid'
    if (d <= 1980) return 'tone-warm'
    return 'tone-late'
  },

  // 单篇故事卡片数据：年代标签 + 正文预览 + 头图（优先彩色版）
  _card(s, year) {
    const content = s.content || ''
    return {
      _id: s._id,
      title: s.title || '一段往事',
      yearText: year ? year + '年' : (s.era || '年代不详'),
      preview: content.length > 60 ? content.slice(0, 60) + '…' : content,
      photoFileID: s.colorizedFileID || s.photoFileID || ''
    }
  },

  async loadChronicle() {
    try {
      const result = await call('chronicle', { familyId: this.familyId })
      const list = result.stories || []
      const values = (result.values || []).slice().sort((a, b) => (b.count || 0) - (a.count || 0))
      this.setData({ valuesText: values.slice(0, 8).map(value => value.value).join(' · ') })
      if (!list.length) {
        this.setData({ ready: true, empty: true })
        return
      }
      // 归一化出年份，分有/无两组
      const items = list.map(s => ({ s, year: this.parseYear(s) }))
      const has = items.filter(x => x.year != null).sort((a, b) => a.year - b.year)
      const noYear = items.filter(x => x.year == null)

      // 有年份的按十年分章
      const groupMap = {}
      has.forEach(x => {
        const decade = Math.floor(x.year / 10) * 10
        if (!groupMap[decade]) groupMap[decade] = []
        groupMap[decade].push(this._card(x.s, x.year))
      })
      const chapters = Object.keys(groupMap).map(Number).sort((a, b) => a - b).map(d => ({
        decade: DECADE_LABEL[d] || (d + '年代'),
        range: `${d}-${d + 9}`,
        stories: groupMap[d],
        toneClass: this._toneFor(d)
      }))
      // 无年代的故事单列一章，置于卷末
      if (noYear.length) {
        chapters.push({
          decade: '岁月留痕',
          range: '未标注年代',
          stories: noYear.map(x => this._card(x.s, null)),
          toneClass: 'tone-unknown'
        })
      }

      const span = has.length >= 2
        ? `${has[0].year}—${has[has.length - 1].year}年`
        : (has[0] ? `${has[0].year}年` : '')

      // 时间线节点：有年份的升序在前，年代不详排末。每节点带原文标签，便于点选跳转
      const timeline = [...has, ...noYear].map(x => {
        const s = x.s
        const eraRaw = (s.era || '').trim()
        // 纯四位数字归一成"1989年"；含描述性文字(如"89年某一天""八十年代初")保留原文；都无则"年代不详"
        const isPureNum = /^\d+$/.test(eraRaw)
        const yearText = (eraRaw && !isPureNum) ? eraRaw
          : (x.year ? x.year + '年' : '年代不详')
        return {
          _id: s._id,
          title: s.title || '一段往事',
          yearText,
          photoFileID: s.colorizedFileID || s.photoFileID || '',
          year: x.year
        }
      })

      this.setData({
        ready: true,
        book: { count: list.length, span, chapters, timeline }
      })
    } catch (e) {
      // 集合未建或权限未开时落到空态
      this.setData({ ready: true, empty: true })
    }
  },

  goToStory(e) {
    wx.navigateTo({ url: `/pages/family/family?familyId=${encodeURIComponent(this.familyId)}&storyId=${encodeURIComponent(e.currentTarget.dataset.id)}` })
  },

  // 分享整本编年志到家族群，家人打开可看全册
  onShareAppMessage() {
    const count = this.data.book ? this.data.book.count : 0
    return {
      title: count ? `我们的家族编年志 · 共 ${count} 篇` : '我们的家族编年志',
      path: `/pages/chronicle/chronicle?familyId=${encodeURIComponent(this.familyId)}`
    }
  },

  // 生成"家风卷册"分享海报：离屏 canvas 绘制封面+卷目 → 导出图片 → 弹微信分享菜单
  // 不走云函数：复用已加载的 book 数据，原生 canvas 排版导出即可
  async drawPoster() {
    const book = this.data.book
    if (!book) return wx.showToast({ title: '编年志还在准备', icon: 'none' })
    wx.showLoading({ title: '生成海报中…', mask: true })
    try {
      const canvas = await this._getPosterCanvas()
      const ctx = canvas.getContext('2d')
      const chapters = book.chapters || []
      const W = 750
      const COVER_H = 560          // 封面区固定高度
      const TOC_TITLE_Y = COVER_H + 90
      const ROW_START = COVER_H + 180
      const ROW_H = 76
      const FOOTER = 150
      // 高度随章节数伸缩，避免年代多时溢出；dpr 限 2 防超 canvas 物理像素上限(约 4096)
      const H = ROW_START + chapters.length * ROW_H + FOOTER
      const pdpr = Math.min((wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2, 2)
      canvas.width = W * pdpr
      canvas.height = H * pdpr
      ctx.scale(pdpr, pdpr)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      // —— 封面区：红棕底白字，复用编年志页封面的书卷视觉 ——
      ctx.fillStyle = '#A0522D'
      ctx.fillRect(0, 0, W, COVER_H)

      // 印章「志」：白描边圆角方框 + 白字，与页面 cover-mark 一致
      const sx = W / 2, sy = 130, sw = 96
      this._roundRect(ctx, sx - sw / 2, sy - sw / 2, sw, sw, 14)
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'
      ctx.lineWidth = 3
      ctx.stroke()
      ctx.fillStyle = 'rgba(255,255,255,0.95)'
      ctx.font = 'bold 46px sans-serif'
      ctx.fillText('志', sx, sy + 2)

      // 书名 / 跨度篇数 / 家风 / slogan
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 60px sans-serif'
      ctx.fillText('家族编年志', W / 2, 270)
      ctx.font = '32px sans-serif'
      const sub = book.span ? `${book.span} · 共 ${book.count} 篇` : `共 ${book.count} 篇往事`
      ctx.fillText(sub, W / 2, 330)
      if (this.data.valuesText) {
        ctx.font = '30px sans-serif'
        ctx.fillText('家风 · ' + this._truncate(ctx, this.data.valuesText, W - 120), W / 2, 390)
      }
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.font = '28px sans-serif'
      ctx.fillText('把这些散落的往事', W / 2, 460)
      ctx.fillText('汇成一本可以传下去的书', W / 2, 500)

      // 金色分隔线，书卷感
      ctx.strokeStyle = '#c9a86a'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(120, COVER_H)
      ctx.lineTo(W - 120, COVER_H)
      ctx.stroke()

      // —— 卷目区：米底深字 ——
      ctx.fillStyle = '#FBF7F0'
      ctx.fillRect(0, COVER_H, W, H - COVER_H)
      ctx.fillStyle = '#2B2218'
      ctx.font = 'bold 38px sans-serif'
      ctx.fillText('卷  目', W / 2, TOC_TITLE_Y)

      // 各年代篇数：decade 左对齐、篇数右对齐
      let y = ROW_START
      chapters.forEach(ch => {
        ctx.textAlign = 'left'
        ctx.fillStyle = '#3a3228'
        ctx.font = '32px sans-serif'
        ctx.fillText(ch.decade, 100, y)
        ctx.textAlign = 'right'
        ctx.fillStyle = '#A0522D'
        ctx.font = '30px sans-serif'
        ctx.fillText(`${ch.stories.length} 篇`, W - 100, y)
        y += ROW_H
      })

      // 落款
      ctx.textAlign = 'right'
      ctx.fillStyle = '#9c8d78'
      ctx.font = '26px sans-serif'
      ctx.fillText('—— 小传 整理', W - 100, H - 60)

      // 导出图片 → 直接弹微信"分享图片"菜单（可发聊天 / 朋友圈 / 收藏）
      const tempPath = await this._canvasToTemp(canvas)
      wx.hideLoading()
      wx.showShareImageMenu({
        path: tempPath,
        fail: () => wx.previewImage({ urls: [tempPath] })   // 低版本兜底：预览图长按可保存
      })
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '生成失败，稍后再试', icon: 'none' })
    }
  },

  _getPosterCanvas() {
    return new Promise((resolve, reject) => {
      wx.createSelectorQuery().in(this)
        .select('#posterCanvas').fields({ node: true, size: true })
        .exec(res => {
          if (res[0] && res[0].node) resolve(res[0].node)
          else reject(new Error('canvas 未就绪'))
        })
    })
  },

  _canvasToTemp(canvas) {
    return new Promise((resolve, reject) => {
      wx.canvasToTempFilePath({ canvas, success: r => resolve(r.tempFilePath), fail: reject })
    })
  },

  // 圆角矩形路径（canvas 2d 兼容写法，避开 roundRect 兼容差异）
  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  },

  // 按当前字体宽度截断，超宽加省略号（家风关键词兜底防溢出）
  _truncate(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text
    let s = text
    while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1)
    return s + '…'
  }
})
