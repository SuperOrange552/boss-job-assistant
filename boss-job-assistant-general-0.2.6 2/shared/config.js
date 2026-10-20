// 业务筛选字段集中定义在这里。新增字段时，配置页、校验器和筛选引擎会自动使用同一份定义，
// 避免在多个文件中再次写死一套条件。
export const FILTER_FIELD_DEFINITIONS = Object.freeze([
  { key: 'title', label: '岗位标题', source: '职位名称', placeholder: '例如：行政专员，行政助理', match: 'term' },
  { key: 'description', label: '职位正文', source: '岗位职责和任职要求', placeholder: '例如：会议安排，档案管理', match: 'term' },
  { key: 'tags', label: '岗位标签', source: '页面展示的技能/经验标签', placeholder: '例如：Office，行政管理', match: 'term' },
  { key: 'company', label: '公司名称', source: '当前岗位卡片公司名称', placeholder: '例如：某某集团，某某科技', match: 'fragment' },
  { key: 'location', label: '工作地点', source: '岗位地点文字', placeholder: '例如：杭州，滨江区', match: 'fragment' },
  { key: 'recruiter', label: '招聘者姓名', source: '招聘者显示名称', placeholder: '例如：张女士，李先生', match: 'fragment' },
  { key: 'activity', label: '招聘者活跃标签', source: '例如“在线”“刚刚活跃”“3日内活跃”', placeholder: '例如：在线，刚刚活跃', match: 'fragment' },
  { key: 'reply', label: '招聘者回复标签', source: '例如“今日回复”“回复率高”', placeholder: '例如：今日回复', match: 'fragment' }
]);

export const KEYWORD_GROUPS = Object.freeze(FILTER_FIELD_DEFINITIONS.flatMap(({ key }) => [`${key}Include`, `${key}Exclude`]));
const FILTER_GROUP_DEFAULTS = Object.fromEntries(KEYWORD_GROUPS.flatMap((key) => [[key, ''], [`${key}Mode`, 'any'], [`${key}Count`, 2]]));

export const DEFAULT_FILTERS = Object.freeze({
  ...FILTER_GROUP_DEFAULTS,
  // 0 表示不限制；正整数表示“最多 N 天内活跃”。宽松范围天然包含更严格范围。
  hrActiveDays: 0,
  hrUnknownPolicy: 'skip'
});

export function parseKeywords(value = '') {
  return [...new Map(String(value).split(/[\n\r,，;；]+/u).map((word) => word.trim()).filter(Boolean).map((word) => [word.toLowerCase(), word])).values()];
}

export function normalizeFilters(input = {}) {
  const result = Object.fromEntries(Object.keys(DEFAULT_FILTERS).map((key) => [key, input[key] ?? DEFAULT_FILTERS[key]]));
  // 兼容旧通用版导出的配置。
  for (const key of ['titleInclude', 'descriptionInclude']) if (input[`${key}Mode`] === undefined && input.includeMode) result[`${key}Mode`] = input.includeMode;
  if (!result.locationInclude && Array.isArray(input.cities)) result.locationInclude = input.cities.join('，');
  if (!result.replyInclude && input.requireRepliedToday) result.replyInclude = '今日回复，今天回复';
  return result;
}

export function keywordThreshold(terms, mode, count) { return mode === 'all' ? terms.length : mode === 'count' ? Number(count) : 1; }
export function keywordRuleLabel(mode, count) { return mode === 'all' ? '全部命中' : mode === 'count' ? `至少命中${count}个不同词` : '命中任意1个'; }

export function validateSettings(settings) {
  const result = { greetingMaxChars: 200, ...settings, filters: normalizeFilters(settings.filters) };
  if (!['ai', 'template'].includes(result.greetingMode) || !['ai', 'template'].includes(result.activationMode)) throw new Error('话术方式必须是AI或自定义模板');
  for (const key of KEYWORD_GROUPS) {
    const mode = result.filters[`${key}Mode`], raw = result.filters[`${key}Count`], count = Number(raw);
    if (!['any', 'all', 'count'].includes(mode)) throw new Error(`${key} 的关键词匹配方式无效`);
    if (raw === '' || raw === null || !Number.isInteger(count) || count < 1 || count > 100) throw new Error(`${key} 的命中数量必须是1至100的整数`);
    result.filters[`${key}Count`] = count;
    const terms = parseKeywords(result.filters[key]);
    if (mode === 'count' && terms.length && count > terms.length) throw new Error(`${key} 的至少命中数量不能超过不同关键词数量（当前${terms.length}个）`);
    result.filters[key] = String(result.filters[key] || '').trim();
    if (result.filters[key].length > 5000) throw new Error(`${key} 的筛选词不能超过5000字`);
  }
  result.filters.hrActiveDays = Number(result.filters.hrActiveDays);
  if (!Number.isInteger(result.filters.hrActiveDays) || result.filters.hrActiveDays < 0 || result.filters.hrActiveDays > 3650) throw new Error('招聘者活跃天数必须是0至3650的整数，0表示不限制');
  if (!['skip', 'allow'].includes(result.filters.hrUnknownPolicy)) throw new Error('活跃状态未知时的处理方式无效');
  if (!['all', 'read', 'unread'].includes(result.activationReadFilter)) throw new Error('已读/未读筛选无效');
  if (!['all', 'replied', 'unreplied'].includes(result.activationReplyFilter)) throw new Error('回复筛选无效');
  if (!['all', 'sent', 'unsent'].includes(result.activationSentFilter)) throw new Error('我方发送筛选无效');
  const numbers = {
    greetingMaxChars: [20, 2000, '单条打招呼字数上限'], dailyLimit: [1, 500, '每日上限'], defaultRunLimit: [1, 500, '单轮上限'], batchSize: [1, 100, '每批数量'],
    perSendRestMinSeconds: [1, 3600, '每条最短间隔'], perSendRestMaxSeconds: [1, 3600, '每条最长间隔'], restMinSeconds: [1, 3600, '每批最短间隔'], restMaxSeconds: [1, 3600, '每批最长间隔'],
    detailLoadTimeoutSeconds: [5, 180, '岗位详情加载等待'], chatReadyTimeoutSeconds: [10, 300, '沟通页与输入框等待'],
    sendEvidenceTimeoutSeconds: [5, 120, '文字发送确认等待'], resumeSendTimeoutSeconds: [10, 180, '简历图片发送确认等待'],
    secondContactMinHours: [0, 720, '二次沟通间隔'], laterContactMinHours: [0, 720, '后续沟通间隔'], maxContactsPerJob: [1, 10, '同岗位最多沟通次数'], companyCooldownHours: [0, 720, '同公司防重时间'],
    activationCooldownHours: [1, 720, '激活防重时间'], activationRunLimit: [1, 100, '激活单轮上限']
  };
  for (const [key, [min, max, label]] of Object.entries(numbers)) {
    const raw = result[key], number = Number(raw);
    if (raw === '' || raw === null || !Number.isInteger(number) || number < min || number > max) throw new Error(`${label}必须是${min}至${max}的整数`);
    result[key] = number;
  }
  if (result.perSendRestMaxSeconds < result.perSendRestMinSeconds) throw new Error('每条最长间隔不能小于最短间隔');
  if (result.restMaxSeconds < result.restMinSeconds) throw new Error('每批最长间隔不能小于最短间隔');
  result.laterContactsRequireNextDay = Boolean(result.laterContactsRequireNextDay);
  for (const key of ['greetingTemplate', 'activationTemplate']) {
    result[key] = String(result[key] || '').trim();
    if (result[key].length > 2000) throw new Error('自定义模板不能超过2000字');
  }
  result.activationTemplates = { ...result.activationTemplates };
  for (const group of ['read', 'unread', 'replied', 'never_sent']) {
    result.activationTemplates[group] = String(result.activationTemplates[group] || '').trim();
    if (result.activationTemplates[group].length > 2000) throw new Error('分组激活模板不能超过2000字');
  }
  return result;
}

export function modeLabel(mode) { return mode === 'ai' ? 'AI生成' : '自定义模板'; }
export function pacingLabel(settings) { return `每条成功后 ${settings.perSendRestMinSeconds}–${settings.perSendRestMaxSeconds} 秒；每 ${settings.batchSize} 条额外 ${settings.restMinSeconds}–${settings.restMaxSeconds} 秒`; }
