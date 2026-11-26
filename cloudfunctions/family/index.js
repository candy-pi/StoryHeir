const cloud = require('wx-server-sdk')
const { randomBytes, createHash } = require('crypto')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const families = db.collection('families')
const narrators = db.collection('familyNarrators')
const stories = db.collection('familyStories')

function required(value, label, max = 100) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new Error(label + '无效')
  }
  return value.trim()
}

async function getFamily(familyId, openid) {
  const { data } = await families.doc(required(familyId, '家族')).get()
  if (!data || !data.members.includes(openid)) throw new Error('请先加入这个家族')
  return data
}

async function removeByFamily(collectionName, familyId) {
  const collection = db.collection(collectionName)
  while (true) {
    const page = await collection.where({ familyId }).limit(100).get()
    if (!page.data.length) break
    await Promise.all(page.data.map(item => collection.doc(item._id).remove()))
    if (page.data.length < 100) break
  }
}

async function detachPersonalStories(familyId) {
  const collection = db.collection('story')
  while (true) {
    const page = await collection.where({ familyId }).limit(100).get()
    if (!page.data.length) break
    await Promise.all(page.data.map(item => collection.doc(item._id).update({ data: {
      familyId: db.command.remove(), familyStoryId: db.command.remove()
    } })))
    if (page.data.length < 100) break
  }
}

const actions = {
  async mediaOwner(_, openid) {
    return openid
  },
  async list(_, openid) {
    const { data } = await families.where({ members: db.command.all([openid]) })
      .field({ name: true, owner: true }).limit(100).get()
    return data.map(family => ({
      _id: family._id,
      name: family.name,
      canDelete: family.owner === openid
    }))
  },

  async create(event, openid) {
    const name = required(event.name, '家族名称', 40)
    const { _id } = await families.add({ data: {
      name, owner: openid, members: [openid], invite: randomBytes(16).toString('hex')
    } })
    return { _id, name, familyId: _id }
  },

  async invite(event, openid) {
    const family = await getFamily(event.familyId, openid)
    if (family.owner !== openid) throw new Error('只有家族创建者可以邀请')
    return family._id
  },

  async join(event, openid) {
    const familyId = required(event.familyId || event.invite, '家族ID', 64)
    let family
    try { family = (await families.doc(familyId).get()).data } catch (_) {}
    // 兼容旧版已经分享出去的邀请码。
    if (!family && /^[a-f0-9]{32}$/.test(familyId)) {
      const result = await families.where({ invite: familyId }).limit(1).get()
      family = result.data[0]
    }
    if (!family) throw new Error('家族ID无效')
    await families.doc(family._id).update({ data: { members: db.command.addToSet(openid) } })
    return { _id: family._id, name: family.name }
  },

  async browse(event, openid) {
    const family = await getFamily(event.familyId, openid)
    const skip = Number.isSafeInteger(event.skip) && event.skip >= 0 ? event.skip : 0
    const [people, page, valuePage] = await Promise.all([
      narrators.where({ familyId: family._id }).field({ name: true }).limit(100).get(),
      stories.where({ familyId: family._id }).orderBy('publishedAt', 'desc')
        .field({ title: true, narratorName: true, reporterName: true }).skip(skip).limit(20).get(),
      db.collection('familyValue').where({ familyId: family._id }).limit(30).get()
    ])
    return { people: people.data, stories: page.data, values: valuePage.data,
      canInvite: family.owner === openid }
  },

  async chronicle(event, openid) {
    const family = await getFamily(event.familyId, openid)
    const valuePage = await db.collection('familyValue').where({ familyId: family._id }).limit(30).get()
    const allStories = []
    const pageSize = 100
    for (let skip = 0; skip <= 500; skip += pageSize) {
      const page = await stories.where({ familyId: family._id })
        .field({ title: true, content: true, era: true, publishedAt: true,
          photoFileID: true, colorizedFileID: true, interviewerOpenid: true })
        .skip(skip).limit(pageSize).get()
      allStories.push(...page.data)
      if (page.data.length < pageSize) break
    }
    allStories.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
    const cards = await Promise.all(allStories.map(async item => {
      const { interviewerOpenid, ...card } = item
      const photo = card.colorizedFileID || card.photoFileID
      if (typeof photo === 'string' && photo.includes('/private-media/')) {
        card.colorizedFileID = ''
        card.photoFileID = ''
        const path = photo.match(/^cloud:\/\/[^/]+\/private-media\/([\w-]+)\/photos\/[\w-]+\.jpg$/)
        const env = cloud.getWXContext().ENV
        const bucket = photo.slice('cloud://'.length).split('/')[0]
        if (path && path[1] === interviewerOpenid && env &&
            (bucket === env || bucket.startsWith(env + '.'))) {
          try {
            const { fileList } = await cloud.getTempFileURL({ fileList: [{ fileID: photo, maxAge: 600 }] })
            card.photoFileID = fileList[0]?.tempFileURL || ''
          } catch (_) {}
        }
      }
      return card
    }))
    return { familyName: family.name, stories: cards, values: valuePage.data }
  },

  async delete(event, openid) {
    const family = await getFamily(event.familyId, openid)
    if (family.owner !== openid) throw new Error('只有家族创建者可以删除家族')
    await Promise.all([
      removeByFamily('familyStories', family._id),
      removeByFamily('familyNarrators', family._id),
      removeByFamily('familyValue', family._id),
      detachPersonalStories(family._id)
    ])
    await families.doc(family._id).remove()
    return { _id: family._id }
  },

  async addNarrator(event, openid) {
    const family = await getFamily(event.familyId, openid)
    const name = required(event.name, '讲述人', 40)
    const { _id } = await narrators.add({ data: { familyId: family._id, name } })
    return { _id, name }
  },

  async publish(event, openid) {
    const family = await getFamily(event.familyId, openid)
    const storyId = required(event.storyId, '故事')
    const narratorId = required(event.narratorId, '讲述人')
    const reporterName = required(event.reporterName, '采访人署名', 40)
    const [{ data: story }, { data: narrator }] = await Promise.all([
      db.collection('story').doc(storyId).get(),
      narrators.doc(narratorId).get()
    ])
    if (!story || story._openid !== openid) throw new Error('只有原作者可以发布这篇故事')
    if (story.familyId && story.familyId !== family._id) throw new Error('这篇故事不属于当前家族')
    if (!narrator || narrator.familyId !== family._id) throw new Error('请选择这个家族的讲述人')
    let interviewMessages = []
    if (story.interviewId) {
      try {
        const interview = (await db.collection('interview').doc(story.interviewId).get()).data
        interviewMessages = interview?._openid === openid &&
          (!interview.familyId || interview.familyId === family._id) &&
          Array.isArray(interview.messages)
          ? interview.messages.filter(message => message && typeof message.text === 'string' && message.text.trim())
            .map(message => ({ role: message.role === 'assistant' ? 'assistant' : 'user', text: message.text.trim() }))
          : []
      } catch (_) {}
    }
    const id = createHash('sha256').update(JSON.stringify([family._id, storyId])).digest('hex').slice(0, 32)
    await stories.doc(id).set({ data: {
      familyId: family._id, sourceStoryId: storyId, narratorId,
      narratorName: narrator.name, reporterName,
      interviewerOpenid: openid, title: story.title || '未命名故事',
      content: story.content || '', era: story.era || '', style: story.style || '',
      persons: story.persons || [], relations: story.relations || [],
      photoFileID: story.photoFileID || '', photoFileIDs: story.photoFileIDs || [],
      colorizedFileID: story.colorizedFileID || '', interviewMessages,
      publishedAt: db.serverDate()
    } })
    await db.collection('story').doc(storyId).update({
      data: { familyId: family._id, familyStoryId: id }
    })
    return { _id: id }
  },

  async deleteStory(event, openid) {
    const source = db.collection('story')
    let sourceId
    let familyId
    let sharedId
    if (event.familyStoryId) {
      const family = await getFamily(event.familyId, openid)
      familyId = family._id
      sharedId = required(event.familyStoryId, '故事')
      const { data: shared } = await stories.doc(sharedId).get()
      if (shared?.familyId !== familyId || shared.interviewerOpenid !== openid) {
        throw new Error('只有故事发布者可以删除')
      }
      const linked = await source.where({ familyId, familyStoryId: sharedId, _openid: openid }).limit(1).get()
      sourceId = linked.data[0]?._id
    } else {
      sourceId = required(event.storyId, '故事')
      const { data: draft } = await source.doc(sourceId).get()
      if (draft?._openid !== openid) throw new Error('只有故事作者可以删除')
      familyId = draft.familyId
      if (familyId) {
        sharedId = createHash('sha256').update(JSON.stringify([familyId, sourceId])).digest('hex').slice(0, 32)
      }
    }
    let interviewId
    if (sourceId) {
      const { data } = await source.where({ _id: sourceId, _openid: openid }).limit(1).get()
      const candidate = data[0]?.interviewId
      const scope = data[0]?.familyId
      if (typeof candidate === 'string' && candidate) {
        const { data: records } = await db.collection('interview')
          .where({ _id: candidate, _openid: openid }).limit(1).get()
        if (records[0] && (!records[0].familyId || records[0].familyId === scope)) interviewId = candidate
      }
    }
    const shared = sharedId && (await stories
      .where({ _id: sharedId, familyId, interviewerOpenid: openid }).limit(1).get()).data[0]
    await db.runTransaction(async transaction => {
      if (shared) await transaction.collection('familyStories').doc(sharedId).remove()
      if (interviewId) await transaction.collection('interview').doc(interviewId).remove()
      if (sourceId) await transaction.collection('story').doc(sourceId).remove()
    })
    return { sourceId: sourceId || '' }
  },

  async read(event, openid) {
    const family = await getFamily(event.familyId, openid)
    const { data: story } = await stories.doc(required(event.storyId, '故事')).get()
    if (!story || story.familyId !== family._id) throw new Error('这篇故事不在当前家族')
    let interviewMessages = Array.isArray(story.interviewMessages) ? story.interviewMessages : []
    // 兼容旧数据：旧家族故事没有访谈快照时，回溯个人故事关联的 interview。
    if (!interviewMessages.length) {
      try {
        let sourceStory
        if (story.sourceStoryId) {
          sourceStory = (await db.collection('story').doc(story.sourceStoryId).get()).data
        } else {
          const sourcePage = await db.collection('story').where({
            familyStoryId: story._id, _openid: story.interviewerOpenid, familyId: family._id
          }).limit(1).get()
          sourceStory = sourcePage.data[0]
        }
        if (story.interviewerOpenid && sourceStory?.interviewId &&
            sourceStory._openid === story.interviewerOpenid && sourceStory.familyId === family._id &&
            createHash('sha256').update(JSON.stringify([family._id, sourceStory._id]))
              .digest('hex').slice(0, 32) === story._id) {
          const interview = (await db.collection('interview').doc(sourceStory.interviewId).get()).data
          interviewMessages = interview?._openid === story.interviewerOpenid &&
            (!interview.familyId || interview.familyId === family._id) &&
            Array.isArray(interview.messages) ? interview.messages : []
        }
      } catch (_) {}
    }
    interviewMessages = interviewMessages
      .filter(message => message && typeof message.text === 'string' && message.text.trim())
      .map(message => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        roleLabel: message.role === 'assistant' ? 'AI 记者' : '被采访人',
        text: message.text.trim()
      }))
    const { title, content, narratorName, reporterName } = story
    return { title, content, narratorName, reporterName, interviewMessages,
      canDelete: story.interviewerOpenid === openid }
  }
}

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  const action = event?.action
  if (!OPENID || !Object.prototype.hasOwnProperty.call(actions, action)) {
    return { code: 1, message: '请求无效' }
  }
  try {
    return { code: 0, data: await actions[action](event, OPENID) }
  } catch (error) {
    console.error('[family]', action, error.code || error.name)
    return { code: 1, message: error.errCode || error.code ? '家族操作失败，请稍后重试' : error.message }
  }
}
