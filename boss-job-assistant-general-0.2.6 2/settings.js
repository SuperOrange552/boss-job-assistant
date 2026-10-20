import { DEFAULT_FILTERS } from './shared/config.js';

// 分发包不包含使用者的经历、密钥或简历。新安装使用独立扩展存储。
export const DEFAULT_SETTINGS = Object.freeze({
  candidateSummary: '',
  greetingMode: 'template',
  greetingMaxChars:200,
  greetingTemplate: '{称呼}，我对贵公司的{岗位}岗位很感兴趣，希望进一步了解工作内容，期待您的回复，感谢！',
  greetingRules: '自然、有礼貌、简洁。以岗位职责和要求为主，只选择个人总结中1至2项相关经历回应，不要罗列整份简历。不要编造个人经历或地点关系。',
  modelProvider: 'zhipu', apiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: '', apiKey: '',
  filters: DEFAULT_FILTERS,
  dailyLimit: 500, defaultRunLimit: 20,
  perSendRestMinSeconds: 1, perSendRestMaxSeconds: 3, batchSize: 10, restMinSeconds: 10, restMaxSeconds: 30,
  // 都是最长等待上限；页面或控件提前就绪会立即继续。
  detailLoadTimeoutSeconds: 30,
  chatReadyTimeoutSeconds: 60,
  sendEvidenceTimeoutSeconds: 15,
  resumeSendTimeoutSeconds: 45,
  // 沟通次数与间隔均由使用者设置，不再写死为“三次、第三次次日”。
  secondContactMinHours: 4, laterContactMinHours: 24, laterContactsRequireNextDay: true,
  companyCooldownHours: 24, maxContactsPerJob: 3,
  attachResumeImage: false, previewBeforeSend: true, enableDirectSend: false,
  activationMode: 'template',
  activationTemplate: '您好，想再跟进一下之前沟通的机会，方便时期待您的回复，感谢！',
  activationRules: '礼貌、自然、简短地跟进此前的求职沟通，不施压，不假设对方已经看过简历，不使用具体姓名、公司、岗位或未经提供的经历。',
  activationReadFilter: 'all', activationReplyFilter: 'all', activationSentFilter: 'sent',
  activationUseCategories: false,
  activationTemplates: {
    read: '您好，想再跟进一下之前沟通的机会，方便时期待您的回复，感谢！',
    unread: '您好，再向您问候一下，我仍在关注这次机会，您方便时我们可以进一步沟通，感谢！',
    replied: '您好，想跟进一下我们之前沟通的机会，请问目前是否有进一步安排？感谢！',
    never_sent: '您好，很高兴与您联系，希望有机会进一步了解岗位，感谢！'
  },
  activationCooldownHours: 24, activationRunLimit: 10
});

export function normalizeApiBaseUrl(value = '') {
  return String(value).trim().replace(/\/+$/u, '').replace(/\/chat\/completions$/iu, '').replace(/\/+$/u, '');
}
