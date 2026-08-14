// 首页：产品调性 + 家风墙 + 访谈入口 + 家族故事列表（从云数据库读取，可回看）
const db = wx.cloud.database()
const api = require('../../utils/api.js')

Page({
  data: {
    stories: [],        // 历史家族故事
    loading: true,      // 首次加载骨架标记；回首页静默刷新不再显示骨架，避免列表闪动
    values: [],         // 家风价值观（从 familyValue 集合读）
    valuesLoaded: false,// 家风是否已尝试加载（区分"空"与"加载中"）
    valuePop: null      // 点标签展开的家风详情 { value, quotes, sources }
  },

  onShow() {
    // 每次回到首页刷新列表，刚生成的故事能立刻出现
    this.loadStories()
    this.loadValues()
  },

  // 下拉刷新：补了新故事或换设备后，下拉即重拉最新列表
  async onPullDownRefresh() {
    await this.loadStories()
    await this.loadValues()
    wx.stopPullDownRefresh()
  },

  async loadStories() {
    try {
      const res = await db.collection('story')
        .orderBy('createdAt', 'desc')
        .limit(20)
        .get()
      this.setData({ loading: false, stories: res.data.map(s => ({ ...s, timeText: this._fmtTime(s.createdAt) })) })
    } catch (e) {
      // 集合未建或权限未开时静默，不阻塞首页主入口
      this.setData({ loading: false })
    }
  },

  // 拉家风：按出现频次降序；count 越大字号越大（sizeClass）
  async loadValues() {
    try {
      const res = await db.collection('familyValue')
        .orderBy('count', 'desc')
        .limit(30)
        .get()
      const values = res.data.map(v => ({
        ...v,
        sizeClass: v.count >= 3 ? 'lg' : v.count === 2 ? 'md' : 'sm'
      }))
      this.setData({ values, valuesLoaded: true })
    } catch (e) {
      // 集合未建或权限未开时静默
      this.setData({ valuesLoaded: true })
    }
  },

  // 手动刷新家风：调云函数全量重算（清旧重写）
  async onRefreshValues() {
    wx.showLoading({ title: '正在提炼家风…', mask: true })
    try {
      await api.call('extractValues')
      await this.loadValues()
      wx.showToast({ title: this.data.values.length ? '家风已更新' : '暂未提炼出家风', icon: 'none' })
    } catch (e) {
      // 失败提示由 api.call 统一处理
    } finally {
      wx.hideLoading()
    }
  },

  onTapValue(e) {
    this.setData({ valuePop: this.data.values[e.currentTarget.dataset.idx] })
  },
  closeValuePop() {
    this.setData({ valuePop: null })
  },

  // 简单时间格式：今天显示"今天"，否则显示"X月X日"
  _fmtTime(t) {
    if (!t) return ''
    const d = new Date(t)
    const now = new Date()
    if (d.toDateString() === now.toDateString()) return '今天'
    return `${d.getMonth() + 1}月${d.getDate()}日`
  },

  goToStory(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/story/story?id=${id}` })
  },

  // 载入一批示例故事（一个家族横跨多个年代，含"89年""八十年代初"等模糊年份），
  // 撑起列表 / 关系图 / 编年志 / 时间线。评审 Demo 与开发期 UI 验证用，无需真机录音与 API key。
  // 按标题去重：可重复点击，已载入的不再重复插入
  async loadDemo() {
    const demos = [
      {
        title: '1942年的逃难',
        era: '1942',
        style: 'documentary',
        content: '一九四二年闹饥荒，又逢兵荒马乱，太爷爷挑着两个竹筐，一头是铺盖，一头是才三岁的爷爷，带着太奶奶从苏北一路往南逃。\n\n路上走了二十多天，太奶奶的脚肿得穿不上鞋。太爷爷把仅有的一小袋米留给娘俩，自己啃树皮、挖草根。后来在苏州河边落脚，靠给码头扛包换口饭吃。\n\n爷爷那会儿太小，记不得事，这些都是太奶奶活着时一遍遍讲的。她说最险的一次是过江时遇到溃兵，太爷爷把爷爷塞进船舱底，自己挡在外面，差点没了命。\n\n我们这一辈能安生读书过日子，都是太爷爷那代人拿命换的。',
        persons: [{ id: 'p1', name: '太爷爷' }, { id: 'p2', name: '太奶奶' }, { id: 'p3', name: '爷爷' }],
        relations: [{ from: 'p1', to: 'p2', label: '夫妻' }, { from: 'p1', to: 'p3', label: '父子' }, { from: 'p2', to: 'p3', label: '母子' }]
      },
      {
        title: '1959年的口粮',
        era: '1959',
        style: 'warm',
        content: '一九五九年开春，食堂的稀饭越来越稀。爷爷那会儿十七八岁，正是长身体能吃的时候，可每顿只能分到半碗照得见人影的粥。\n\n奶奶比爷爷小两岁，两家是邻居。奶奶说她家还算好，太外公在供销社，能悄悄带点麸皮回来，她常把自己那份省下一半，隔着院墙递给爷爷。\n\n后来爷爷总念叨，他这条命有一半是奶奶那几把麸皮救回来的。两人因此定了亲，第二年就成了家。\n\n爸爸是一九六〇年底生的，瘦得像只小猫，奶奶没奶水，靠米汤一口口喂活。说起那段日子，奶奶总是先笑后掉眼泪。',
        persons: [{ id: 'p1', name: '爷爷' }, { id: 'p2', name: '奶奶' }, { id: 'p3', name: '爸爸' }],
        relations: [{ from: 'p1', to: 'p2', label: '夫妻' }, { from: 'p1', to: 'p3', label: '父子' }, { from: 'p2', to: 'p3', label: '母子' }]
      },
      {
        title: '1969年去插队',
        era: '1969',
        style: 'documentary',
        content: '一九六九年冬天，姑姑十七岁，胸前别着大红花，坐上了去黑龙江插队的绿皮火车。\n\n站台上一片哭声，奶奶抓着车窗不肯松手。姑姑后来讲，火车一开动，她扭过头眼泪就下来了，可还是冲家里使劲挥手，怕奶奶担心。\n\n在北大荒一待就是八年，开荒、割麦、喂猪，手上的冻疮年年裂。姑姑说最想家的是过年，一帮知青围着火盆唱《我的祖国》，唱着唱着就都哭了。\n\n一九七七年姑姑才回城，带回来一箱子书和一身的关节炎。后来她常说，那段日子苦是真苦，可也教会她什么都能扛。',
        persons: [{ id: 'p1', name: '姑姑' }, { id: 'p2', name: '奶奶' }, { id: 'p3', name: '爷爷' }],
        relations: [{ from: 'p1', to: 'p2', label: '母女' }, { from: 'p1', to: 'p3', label: '父女' }, { from: 'p2', to: 'p3', label: '夫妻' }]
      },
      {
        title: '1972年的纺织厂',
        era: '1972',
        style: 'warm',
        content: '那是一九七二年的春天，爷爷刚满二十四岁，从苏北乡下到上海，进了第七纺织厂当学徒。\n\n那时候车间里机器轰隆隆响，爷爷分在细纱车间，带他的就是王师傅。王师傅是上海本地人，技术好，脾气倔，可对这个乡下小伙子格外照顾，手把手教他接头、换纱。\n\n爷爷总说，没有王师傅，就没有后来他在厂里站稳脚跟。爸爸是一九七五年在厂宿舍出生的，爷爷说那时候最盼望的就是下班抱抱孩子。\n\n后来厂子改制，王师傅退休回了虹口的老房子，断了几年联系。直到前几年爷爷托人打听，才知道老师傅已经走了。爷爷说起这事，眼眶红红的。',
        persons: [{ id: 'p1', name: '爷爷' }, { id: 'p2', name: '爸爸' }, { id: 'p3', name: '王师傅' }],
        relations: [{ from: 'p1', to: 'p2', label: '父亲' }, { from: 'p1', to: 'p3', label: '师徒' }]
      },
      {
        title: '1985年的婚事',
        era: '1985',
        style: 'warm',
        content: '爸妈是一九八五年春天结的婚。那时候办喜事不像现在，没有大酒店，就在老宅的天井里摆了八桌。\n\n奶奶提前半个月就开始忙，腌咸肉、做圆子、借隔壁家的八仙桌。姑姑那年十九岁，当的伴娘，穿一件水红的的确良衬衫，是全家最体面的姑娘。\n\n妈妈记得最清楚的是奶奶给的那对银镯子，说是太奶奶传下来的，叮嘱她好好收着，往后也是要传下去的。那对镯子妈妈戴了快四十年，前年又亲手套到了我媳妇手腕上。',
        persons: [{ id: 'p1', name: '爸爸' }, { id: 'p2', name: '妈妈' }, { id: 'p3', name: '奶奶' }, { id: 'p4', name: '姑姑' }],
        relations: [{ from: 'p1', to: 'p2', label: '夫妻' }, { from: 'p1', to: 'p3', label: '母子' }, { from: 'p1', to: 'p4', label: '兄妹' }, { from: 'p2', to: 'p3', label: '婆媳' }]
      },
      {
        title: '八十年代初的个体户',
        era: '八十年代初',
        style: 'warm',
        content: '八十年代初政策松了，爸爸是厂里第一个砸了铁饭碗的人。\n\n爷爷气得几天没跟他说话，说放着好好的工人不当，去当什么「倒爷」，丢人。妈妈那会儿还没过门，却偷偷把攒的嫁妆钱塞给爸爸进货。\n\n爸爸骑着二八大杠，凌晨四点去批发市场进了一批电子表和蛤蟆镜，再转手到县城卖，第一个月就赚了三个月的工资。爷爷嘴上不说，悄悄把爸爸的自行车擦得锃亮。\n\n后来个体户越来越多，爸爸生意起起落落，但常说，是那个年代给了他胆子，也给了妈妈敢跟他赌一把的勇气。',
        persons: [{ id: 'p1', name: '爸爸' }, { id: 'p2', name: '爷爷' }, { id: 'p3', name: '妈妈' }],
        relations: [{ from: 'p1', to: 'p2', label: '父子' }, { from: 'p1', to: 'p3', label: '夫妻' }, { from: 'p2', to: 'p3', label: '翁媳' }]
      },
      {
        title: '89年的那场台风',
        era: '89年某一天',
        style: 'warm',
        content: '一九八九年的夏天，一场台风把老房子的瓦片掀了一大片。那一年我还没出生，都是爷爷和爸爸讲的。\n\n雨水顺着房梁往下漏，家里所有的盆桶都接上了，叮叮咚咚响了一夜。爸爸那时刚和妈妈处对象，半夜冒雨骑车去妈妈家，怕她那边更糟。\n\n爷爷说那天风大得出奇，门口那棵老榆树被吹断了半截，第二天满地都是断枝和碎瓦，全家人连着修了三天房。\n\n爸爸后来总拿这事打趣，说他这辈子最浪漫的事，就是台风天骑车去见妈妈。妈妈每次听完都笑着拍他一下，说那时年轻，不知怕。',
        persons: [{ id: 'p1', name: '爷爷' }, { id: 'p2', name: '爸爸' }, { id: 'p3', name: '妈妈' }],
        relations: [{ from: 'p1', to: 'p2', label: '父子' }, { from: 'p2', to: 'p3', label: '夫妻' }]
      },
      {
        title: '1998年老宅拆迁',
        era: '1998',
        style: 'documentary',
        content: '一九九八年秋天，虹口的老宅拆迁。\n\n那栋两层的老房子是太爷爷民国年间置下的，楼下开店，楼上住人，一家人挤了快五十年。拆迁通知下来那天，爷爷在门槛上坐了一整夜没说话。\n\n搬家时最舍不得的是堂屋那张八仙桌，太爷爷传给爷爷，爷爷说桌面的道道划痕都是日子磨出来的。新楼放不下，最后还是留给了收旧货的。\n\n那年我七岁，只记得搬家那天下大雨，爸爸扛着八仙桌的一头，爷爷扛着另一头，两个人都淋透了。后来爷爷再没提过老宅，只在除夕多喝两杯时，会念叨一句那张桌子真好啊。',
        persons: [{ id: 'p1', name: '爷爷' }, { id: 'p2', name: '爸爸' }, { id: 'p3', name: '我' }, { id: 'p4', name: '太爷爷' }],
        relations: [{ from: 'p1', to: 'p2', label: '父子' }, { from: 'p2', to: 'p3', label: '父子' }, { from: 'p1', to: 'p4', label: '父子' }]
      },
      {
        title: '2008年的五月',
        era: '2008',
        style: 'warm',
        content: '二〇〇八年五月十二日下午，我在学校上课，忽然觉得桌椅晃了一下，老师愣了几秒，才反应过来是地震。\n\n电视里全是汶川的画面，奶奶每天守着新闻抹眼泪。爸爸第二天就去单位报了名，跟着救援队进了四川，一去就是半个月。\n\n那半个月家里没一个睡好觉的，妈妈把爸爸的衣物叠了又叠，奶奶天天烧香。爸爸回来那天瘦了一圈，胡子拉碴，进门先抱了我一下，声音哑哑地说了一句平安就好。\n\n那一年全家人凑钱捐了三回，姑姑把压箱底的金戒指都捐了。爷爷说，国家有难匹夫有责，咱家虽不富裕，这份心不能少。',
        persons: [{ id: 'p1', name: '我' }, { id: 'p2', name: '爸爸' }, { id: 'p3', name: '妈妈' }, { id: 'p4', name: '爷爷' }],
        relations: [{ from: 'p2', to: 'p3', label: '夫妻' }, { from: 'p2', to: 'p1', label: '父子' }, { from: 'p4', to: 'p2', label: '父子' }]
      },
      {
        title: '记不清的那年',
        era: '',
        style: 'warm',
        content: '爷爷讲过一段往事，可具体哪一年，他自己也说不清了，只记得是解放前后的光景。\n\n那时候家里还开着个小杂货铺，门口有棵老槐树。有一年腊月，一个路过的人又冷又饿，倒在店门口，太爷爷把他扶进屋，热了碗面端给他。\n\n那人走时留下一句话，说日后若到江南，必来还这碗面。爷爷说后来真有人来找过，可太爷爷已经不在了，来人磕了三个头就走了。\n\n这段故事爷爷讲了好几遍，每次结尾都说，人这一辈子记不住的事多，可一碗面的情分记着呢。年代说不清不要紧，要紧的是这份心传下去了。',
        persons: [{ id: 'p1', name: '太爷爷' }, { id: 'p2', name: '爷爷' }, { id: 'p3', name: '我' }],
        relations: [{ from: 'p1', to: 'p2', label: '父子' }, { from: 'p2', to: 'p3', label: '祖孙' }]
      }
    ]
    try {
      // 按这批标题精确查重：小程序端单次 get 只回 20 条，全量拉取在故事变多后会漏判、重复插入
      const got = await db.collection('story')
        .where({ title: db.command.in(demos.map(d => d.title)) })
        .get()
      const exist = new Set((got.data || []).map(s => s.title))
      let n = 0
      for (const d of demos) {
        if (exist.has(d.title)) continue
        await db.collection('story').add({ data: { ...d, createdAt: db.serverDate() } })
        n++
      }
      this.loadStories()
      wx.showToast({ title: n ? `已载入 ${n} 篇示例` : '示例已全部载入', icon: 'success' })
    } catch (e) {
      console.error('[loadDemo]', e)
      wx.showToast({ title: '载入失败，稍后再试', icon: 'none' })
    }
  },

  goToInterview() {
    wx.navigateTo({ url: '/pages/interview/interview' })
  },

  // 家族编年志：把已记录的故事按事件年代汇编成册
  goToChronicle() {
    wx.navigateTo({ url: '/pages/chronicle/chronicle' })
  }
})
