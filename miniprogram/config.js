// 全局配置：所有需要你在微信平台填写/替换的值都集中在这里
module.exports = {
  // 云开发环境 ID
  envId: 'cloud1-d2gusddkl26721954',

  // 云函数名常量：改名时只改这里，调用处不用动
  cloudFns: {
    family: 'family',
    chat: 'chat',         // 访谈对话（百炼 GLM）
    asr: 'asr',           // 语音转写（百炼 Paraformer）
    genStory: 'genStory', // 故事生成（百炼 GLM）
    restore: 'restore',   // 老照片 AI 上色（万相 wanx2.1-imageedit）
    extractValues: 'extractValues', // 家风价值观提炼（百炼 GLM）
    tts: 'tts'                      // 故事朗读（百炼 Qwen-TTS）
  }
}
