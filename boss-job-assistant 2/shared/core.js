const CORE_CONTACT_DEFAULTS = Object.freeze({
  dailyLimit: 500,
  batchSize: 10,
  restMinSeconds: 10,
  restMaxSeconds: 30,
  secondContactMinHours: 4,
  companyCooldownHours: 24,
  secondContactSameDay: true,
  thirdContactNextDay: true,
  maxContactsPerJob: 3
});

export const POSTPONE_GROUPS = Object.freeze({
  hardware: [
    "硬件", "软硬件", "硬件测试", "硬件开发", "电气工程", "电子电路", "pcb", "芯片测试", "射频",
    "emc", "电机", "电驱动", "伺服", "伺服驱动", "驱动器调试", "示波器", "万用表",
    "测试治具", "台架测试", "负载箱", "传感器测试", "执行器测试", "机械电气",
    "机电一体化", "硬件在环", "半导体设备", "电源搭建"
  ],
  embedded: [
    "嵌入式", "嵌入式测试", "嵌入式软件", "固件测试", "mcu", "单片机", "串口测试",
    "总线测试", "驱动测试", "驱动器测试", "嵌入式系统", "航空航天"
  ],
  automotive: [
    "整车", "车载", "汽车行业", "车辆测试", "整车测试", "车载测试", "汽车测试", "车身", "车身功能", "数字钥匙", "adas", "自动驾驶",
    "ecu", "hil", "canoe", "canalyzer", "can总线", "can网络", "lin总线", "uds",
    "autosar", "实车道路测试", "道路测试", "故障注入", "三电", "汽车底盘",
    "电驱动台架", "汽车零部件", "标定工程师", "车联网"
  ],
  optical: [
    "光学", "光学测试", "光学设备", "光学设计", "光学仿真", "激光", "光学算法",
    "精密设备测试", "光学精密设备"
  ]
});

export const SOFTWARE_TEST_KEYWORDS = Object.freeze([
  "软件测试", "测试工程师", "测试开发", "测开", "qa", "质量保障", "功能测试",
  "接口测试", "api测试", "自动化测试", "性能测试", "压力测试", "app测试", "web测试",
  "h5测试", "客户端测试", "服务端测试", "业务测试", "游戏测试", "手游测试", "端游测试", "回归测试", "兼容性测试",
  "测试用例", "缺陷管理", "缺陷跟踪", "postman", "apifox", "pytest", "selenium",
  "appium", "requests", "jmeter", "charles", "sql", "mysql", "allure", "adb logcat",
  "接口自动化", "数据一致性", "权限测试", "边界测试", "异常测试", "压测"
]);

const SELF_DISADVANTAGE_PATTERNS = Object.freeze([
  /(?:没有|没|未|尚未|暂未).{0,12}(?:做过|接触过|使用过|参与过|实操|经验|经历|掌握)/u,
  /(?:不会|不懂|不知道|不(?:太|够|是很)?熟悉|不(?:太|够|是很)?了解)/u,
  /(?:缺乏|缺少|欠缺).{0,10}(?:经验|能力|技能|实践)/u,
  /(?:经验|能力|技能).{0,6}(?:不足|有限|欠缺|较少|较浅|不多)/u,
  /(?:零经验|小白|非科班|转行|刚开始接触)/u,
  /(?:还需|还需要|需要|有待).{0,8}(?:学习|提升|加强|补足)/u
]);

const GREETING_LIST_TERMS = Object.freeze([
  "功能测试", "接口测试", "自动化测试", "性能测试", "兼容性测试", "异常测试", "边界测试", "权限测试",
  "postman", "apifox", "mysql", "sql", "charles", "adb", "linux", "python", "requests", "pytest", "yaml", "allure", "jmeter", "dify", "llm-as-judge"
]);

const PROFILE_POINT_RULES = Object.freeze([
  { label: "Android App、Web及H5端测试", terms: ["android", "app", "web", "h5", "移动端", "客户端"] },
  { label: "功能、业务流程、异常与边界测试", terms: ["功能测试", "业务测试", "流程测试", "异常测试", "边界测试", "测试用例"] },
  { label: "接口测试与登录鉴权、参数和状态流转验证", terms: ["接口测试", "api", "postman", "apifox", "鉴权", "参数校验", "错误码"] },
  { label: "MySQL数据查询与跨端数据一致性验证", terms: ["mysql", "sql", "数据库", "数据一致性", "数据验证"] },
  { label: "Charles、adb logcat及Linux日志链路排查", terms: ["charles", "adb", "logcat", "linux", "日志", "抓包", "问题定位"] },
  { label: "订单、支付、课程权益与CRM业务测试", terms: ["订单", "支付", "课程", "课时", "退款", "crm", "客户管理"] },
  { label: "Python、Requests和pytest接口自动化回归", terms: ["python", "requests", "pytest", "接口自动化", "自动化回归"] },
  { label: "YAML测试数据与Allure测试报告", terms: ["yaml", "allure", "测试报告", "数据驱动"] },
  { label: "JMeter基础并发与性能回归", terms: ["jmeter", "性能测试", "并发", "tps", "p95", "错误率"] },
  { label: "AI功能测试及Dify、LLM-as-Judge评测", terms: ["ai", "大模型", "llm", "dify", "模型评测", "智能"] },
  { label: "需求评审、用例设计、缺陷跟踪和上线验证", terms: ["需求评审", "需求分析", "用例设计", "缺陷", "回归测试", "上线验证"] }
]);

const COMPOUND_SURNAMES = [
  "欧阳", "司马", "上官", "诸葛", "夏侯", "东方", "皇甫", "尉迟", "公孙", "慕容",
  "令狐", "宇文", "长孙", "司徒", "司空", "端木"
];

export function normalizeText(value = "") {
  return String(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

// 只展示已保存的本轮结果，不重新筛选、不按同名公司推断另一个岗位的结果。
export function jobOutcomeBadge(row) {
  if (!row) return null;
  const reason=normalizeText(row.reason);
  let label='',tone='warning';
  if (row.status==='skipped') {
    label=row.category==='contact_hold' ? '防重跳过' : '筛选跳过';
    if (/HR 活跃筛选/u.test(reason)) label='HR活跃不符';
    else if (/自动批量暂缓猎头\/外包/u.test(reason)) label='猎头/外包跳过';
    else if (/自动批量暂缓大中型科技\/互联网公司/u.test(reason)) label='大中厂留给手动';
    else if (row.category==='other_skip') label='已跳过';
  } else if (row.status==='read_error') {label='读取失败';tone='error';}
  else if (row.status==='generation_error') {label='话术失败';tone='error';}
  else if (row.status==='delivery_error') {label='投递失败';tone='error';}
  else if (row.status==='send_state_unknown') {label='发送结果待核对';tone='error';}
  else if (row.status==='sent') {
    if (/简历图片(?:未确认成功|发送失败|未发送|失败)/u.test(reason)) label='文字已发，图片未确认成功';
    else {label='已发送';tone='success';}
  } else return null; // 尚未处理/生成中不伪装成失败。
  const detail=reason || '未保存具体原因，请查看运行日志';
  // 摘要优先展示真正的限制，完整原始原因留在 title / aria-label。
  const domain=reason.match(/(?:当前暂缓方向|明确包含暂缓领域)：([^；]+)/u)?.[1];
  const brief=(domain ? `暂缓领域：${domain}` : detail).replace(/^本地筛选：/u,'');
  const excerpt=Array.from(brief).slice(0,105).join('')+(Array.from(brief).length>105 ? '…' : '');
  return {text:`本轮${label}：${excerpt}`,title:`本轮${label}：${detail}${row.at ? `\n记录时间：${row.at}` : ''}`,tone,status:row.status};
}

export function containsSelfDisadvantage(value = "") {
  const text = normalizeText(value);
  return SELF_DISADVANTAGE_PATTERNS.some((pattern) => pattern.test(text));
}

export function looksLikeCapabilityMenu(value = "") {
  const normalized = normalizeText(value).toLowerCase();
  const prefix = normalized.match(/^.{0,120}?岗位[，,]/u)?.[0] || "";
  const text = prefix ? normalized.slice(prefix.length) : normalized;
  const matchedTerms = GREETING_LIST_TERMS.filter((term) => text.includes(term.toLowerCase())).length;
  const listSeparators = (text.match(/[、/]/gu) || []).length;
  const tools = ["postman", "apifox", "mysql", "charles", "adb", "linux", "python", "requests", "pytest", "yaml", "allure", "jmeter", "dify", "llm-as-judge", "selenium", "playwright"];
  return matchTerms(text, tools).length > 2 || (matchedTerms >= 4 && listSeparators >= 2);
}

export function cleanJobText(value = "") {
  return normalizeText(String(value)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, "")
    .replace(/[.#][a-zA-Z_][\w-]*\s*\{[^{}]*(?:display|visibility|font-|width|height|overflow)[^{}]*\}/giu, ""));
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

export function matchTerms(text, terms) {
  const source = normalizeText(text).toLowerCase();
  return unique(terms.filter((term) => {
    const lower = term.toLowerCase();
    if (!/^[a-z0-9]+$/u.test(lower)) return source.includes(lower);
    // PCB/ECU/HIL must be tokens, not fragments of random CSS identifiers or English words.
    return new RegExp(`(^|[^a-z0-9_])${lower}($|[^a-z0-9_])`, "u").test(source);
  }));
}

export function isShanghaiLocation(location = "") {
  const value = normalizeText(location);
  return /^上海(?:$|[·\s市])/u.test(value);
}

// 只用左侧卡片标题中的明确测试领域早筛，绝不混入上一条右侧详情或公司行业。
// 通用“驱动测试 / 故障注入 / 硬件”等词留给完整详情判断，避免误排普通软件岗位。
export function precheckExplicitTitle(title = "") {
  const text = normalizeText(title);
  if (/(?:非|不涉及|不含|无需).{0,4}(?:硬件|嵌入式|车载|汽车|整车|光学)/u.test(text)) return null;
  const groups = {
    automotive: ['adas','整车','车载','汽车测试','车辆测试','车身测试','自动驾驶','autosar','can总线'],
    embedded: ['嵌入式','固件测试','单片机测试','mcu测试'],
    hardware: ['硬件测试','伺服测试','电机测试','芯片测试','射频测试','电磁兼容测试','emc测试','硬件在环'],
    optical: ['光学测试','光学设备测试','光学精密设备','激光测试']
  };
  const postponeMatches = Object.fromEntries(Object.entries(groups)
    .map(([group,terms]) => [group,matchTerms(text,terms)]).filter(([,matches]) => matches.length));
  const terms = Object.values(postponeMatches).flat();
  if (!terms.length) return null;
  return {decision:'postpone',category:Object.keys(postponeMatches)[0],score:0,
    reasons:[`左侧标题“${text}”明确包含暂缓领域：${terms.join('、')}；未打开详情，继续下一条`],
    postponeMatches,positiveMatches:[],matchedProfilePoints:[],hr:parseHrSignals()};
}

// 自动批量暂缓名单：按公司身份匹配，不搜索整段JD里的客户/工具名称。
// 名单依据与用户原文别名见 AGENCY_FILTER_SOURCES.md；不是对每个岗位合同性质的断言。
export const AUTO_SKIP_COMPANIES = Object.freeze([
  {name:'科锐国际',aliases:['科锐国际','科瑞国际','career international']},
  {name:'中软国际',aliases:['中软国际','中软','chinasoft international']},
  {name:'京北方',aliases:['京北方','精北方','northking']},
  {name:'软通动力',aliases:['软通动力','isoftstone']},
  {name:'文思海辉',aliases:['文思海辉','pactera']},
  {name:'法本信息',aliases:['法本信息','farben']},
  {name:'微创软件',aliases:['微创软件','wicresoft']}
]);

export function precheckAgency(job = {}) {
  let evidence='';
  const fields=[['列表公司',job.listingCompany || job.company],['招聘者公司',job.recruiterCompany]];
  for(const [field,value] of fields) {
    const company=normalizeText(value).toLowerCase();
    const rule=AUTO_SKIP_COMPANIES.find(item=>item.aliases.some(alias=>{
      if(/[a-z]/u.test(alias)) return new RegExp(`(^|[^a-z])${alias}($|[^a-z])`,'u').test(company);
      return company.includes(alias);
    }));
    if(rule) {evidence=`${field}“${normalizeText(value)}”命中暂缓名单“${rule.name}”`;break;}
  }
  if(!evidence && (job.agencyHint === true || job.recruitmentMode==='agency')) evidence='页面明确标有猎头、代招或外包身份';
  // 不把“管理外包团队/开发外包管理软件/非外包”当成本岗位是外包。
  const clean=cleanJobText(job.description).replace(/(?:非|不是|不属于|不接受|拒绝|无需|不涉及)\s*(?:猎头|外包|派遣|驻场)/gu,'');
  const explicit=clean.match(/(?:本岗位|本职位|该岗位|该职位)\s*(?:是|为|属于|采用).{0,8}(?:外包|劳务派遣)|(?:外派至|派遣至|驻场于|驻场到).{1,20}(?:公司|客户)|(?:与第三方|与外包公司).{0,10}签订.{0,5}(?:劳动|劳务)合同/u);
  if(!evidence && explicit) evidence=`岗位明确说明“${explicit[0]}”`;
  if(!evidence) return null;
  return {decision:'postpone',category:'agency_manual_only',code:'agency_manual_only',score:0,
    reasons:[`自动批量暂缓猎头/外包：${evidence}；按用户要求留给手动投递，本条不调用模型`],
    postponeMatches:{},positiveMatches:[],matchedProfilePoints:[],hr:parseHrSignals()};
}

// 用户的“手动投递保留名单”，不是公司规模排名。只识别当前招聘主体，不扫描JD里的客户/工具。
// 使用较明确的品牌名；不把“科技/信息/网络”、融资轮次或员工人数直接当作大中厂。
// 扩充名单在此处维护；具体适用边界见 TECH_COMPANY_MANUAL_POLICY.md。
export const MANUAL_ONLY_TECH_COMPANIES = Object.freeze([
  {name:'腾讯',aliases:['腾讯','tencent']},
  {name:'阿里巴巴',aliases:['阿里巴巴','阿里云','阿里健康','阿里国际','alibaba'],exactAliases:['阿里']},
  {name:'蚂蚁集团',aliases:['蚂蚁集团','蚂蚁科技集团','支付宝','ant group']},
  {name:'字节跳动',aliases:['字节跳动','抖音集团','bytedance'],exactAliases:['字节','抖音']},
  {name:'百度',aliases:['百度','baidu']},
  {name:'京东',aliases:['京东','jd.com']},
  {name:'美团',aliases:['美团','meituan']},
  {name:'拼多多',aliases:['拼多多','拼多多集团','pdd holdings']},
  {name:'网易',aliases:['网易','netease']},
  {name:'快手',aliases:['快手','kuaishou']},
  {name:'小红书',aliases:['小红书','行吟信息科技']},
  {name:'哔哩哔哩',aliases:['哔哩哔哩','bilibili'],exactAliases:['B站']},
  {name:'携程',aliases:['携程','ctrip','trip.com group']},
  {name:'同程旅行',aliases:['同程旅行','同程网络','同程旅游'],exactAliases:['同程']},
  {name:'滴滴',aliases:['滴滴','didi global']},
  {name:'得物',aliases:['得物','识装信息科技']},
  {name:'唯品会',aliases:['唯品会','vipshop']},
  {name:'贝壳',aliases:['贝壳找房','贝壳集团','贝壳技术'],exactAliases:['贝壳']},
  {name:'满帮',aliases:['满帮','full truck alliance']},
  {name:'新浪/微博',aliases:['新浪','微博','weibo','sina']},
  {name:'搜狐',aliases:['搜狐','sohu']},
  {name:'爱奇艺',aliases:['爱奇艺','iqiyi']},
  {name:'知乎',aliases:['知乎','zhihu']},
  {name:'金山',aliases:['金山软件','金山办公','金山云','kingsoft'],exactAliases:['金山']},
  {name:'奇安信',aliases:['奇安信','qi-anxin']},
  {name:'三六零',aliases:['三六零','奇虎360','奇虎三六零','360集团','360数字安全'],exactAliases:['360']},
  {name:'华为',aliases:['华为','huawei']},
  {name:'小米',aliases:['小米','xiaomi']},
  {name:'联想',aliases:['联想','lenovo']},
  {name:'中兴通讯',aliases:['中兴通讯','zte corporation']},
  {name:'荣耀',aliases:['荣耀终端','荣耀公司','荣耀集团'],exactAliases:['荣耀','HONOR']},
  {name:'OPPO',aliases:['oppo','欧珀','oppo广东移动通信']},
  {name:'vivo',aliases:['vivo','维沃']},
  {name:'微软',aliases:['微软','microsoft']},
  {name:'谷歌',aliases:['谷歌','google']},
  {name:'苹果',aliases:['苹果公司','苹果电脑','苹果研发','apple'],exactAliases:['苹果']},
  {name:'亚马逊',aliases:['亚马逊','amazon']},
  {name:'英伟达',aliases:['英伟达','nvidia']},
  {name:'米哈游',aliases:['米哈游','mihoyo','hoyoverse']},
  {name:'莉莉丝',aliases:['莉莉丝','lilith games']},
  {name:'叠纸',aliases:['叠纸','papergames']},
  {name:'鹰角',aliases:['鹰角','hypergryph']},
  {name:'心动',aliases:['心动网络','心动公司','心动游戏'],exactAliases:['心动']},
  {name:'巨人网络',aliases:['巨人网络']},
  {name:'盛趣游戏',aliases:['盛趣','盛大游戏','shanda games']},
  {name:'完美世界',aliases:['完美世界','perfect world']},
  {name:'三七互娱',aliases:['三七互娱','37互娱']},
  {name:'游族网络',aliases:['游族','yoozoo']},
  {name:'恺英网络',aliases:['恺英','kingnet']},
  {name:'吉比特/雷霆游戏',aliases:['吉比特','雷霆游戏']}
]);

function techCompanyNameMatch(value) {
  const text=normalizeText(value).toLowerCase();
  // 品牌代理商、渠道商不是品牌公司本身，不能因为合作关系就排除。
  if (/(?:代理商|经销商|加盟商|加盟店|授权店|专卖店|合作伙伴|生态伙伴)/u.test(text)) return null;
  return MANUAL_ONLY_TECH_COMPANIES.find(rule=>rule.exactAliases?.some(alias=>alias.toLowerCase()===text) || rule.aliases.some(alias=>{
    const term=alias.toLowerCase();
    if (!/[a-z]/u.test(term)) return text.includes(term);
    const escaped=term.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`,'u').test(text);
  }));
}

function explicitTechTier(value, isTitle=false) {
  const text=normalizeText(value);
  const tiers=/(?:互联网|科技|游戏|软件|IT)\s*(?:大厂|中厂|中大厂|大中厂)|(?:大中型|中大型|大型|中型)\s*(?:互联网|科技|游戏|软件)(?:企业|公司|集团)|(?:大厂|中厂|中大厂|大中厂)/giu;
  for(const match of text.matchAll(tiers)) {
    const before=text.slice(Math.max(0,match.index-24),match.index),after=text.slice(match.index+match[0].length,match.index+match[0].length+28);
    // “大厂经验优先/服务大厂客户/非大厂”不是对当前雇主的规模说明。
    if (/(?:非|不是|不属于|不算|不要求|无需|不需要|有|具备|具有|来自|曾在|对标|合作|服务|对接|面向|赋能)\s*$/u.test(before)
      || /^\s*(?:(?:工作|任职|项目|测试|相关|任意|背景|的)\s*)*(?:经验|经历|背景|出身|优先|客户|合作伙伴|同款|标准)/u.test(after)) continue;
    if (/^(?:大厂|中厂|中大厂|大中厂)$/u.test(match[0]) && !/(?:互联网|科技|游戏|软件|\bIT\b)/iu.test(text)) continue;
    if(isTitle && !/(?:测试|QA|测开|质量)/iu.test(text)) continue;
    return match[0];
  }
  return '';
}

// 仅由自动批量入口调用；手动单条不套用本规则，也不写入“已沟通”历史。
export function precheckTechCompany(job = {}) {
  const fields=[['列表公司',job.listingCompany || job.company],['招聘者公司',job.recruiterCompany]];
  if(job.employerCompanyConfirmed === true) fields.push(['明确用人公司',job.employerCompany]);
  let evidence='';
  for(const [field,value] of fields) {
    const rule=techCompanyNameMatch(value);
    if(rule) {evidence=`${field}“${normalizeText(value)}”命中手动投递名单“${rule.name}”`;break;}
    const tier=explicitTechTier(value);
    if(tier) {evidence=`${field}“${normalizeText(value)}”明确标注“${tier}”`;break;}
  }
  if(!evidence) {
    for(const value of [job.listingTitle,job.title]) {
      const tier=explicitTechTier(value,true);
      if(tier) {evidence=`岗位标题“${normalizeText(value)}”明确标注“${tier}”`;break;}
    }
  }
  if(!evidence) return null;
  return {decision:'postpone',category:'tech_company_manual_only',code:'tech_company_manual_only',score:0,
    reasons:[`自动批量暂缓大中型科技/互联网公司：${evidence}；按用户要求留给手动投递，本条不调用模型`],
    postponeMatches:{},positiveMatches:[],matchedProfilePoints:[],hr:parseHrSignals()};
}

export const HR_ACTIVITY_FILTERS = Object.freeze({online:'当前在线',today:'当天活跃',within3days:'3 天内活跃',any:'不限'});
export const HR_ACTIVITY_LABEL_PATTERN = '(?:当前在线|正在在线|在线|刚刚活跃|刚刚在线|(?:今日|今天|当日)(?:活跃|在线)|(?:昨天|昨日|前天)(?:活跃|在线)|(?:本周|本月|近期)(?:活跃|在线)|(?:[0-9]{1,3}|[一二三七十]+)(?:日|天)(?:内|前)(?:活跃|在线)|[0-9]{1,3}(?:分钟|小时)前(?:活跃|在线)?|半小时前(?:活跃|在线)?)';

export function normalizeHrActivityFilter(value, fallback = 'within3days') {
  return Object.hasOwn(HR_ACTIVITY_FILTERS,value) ? value : fallback;
}

// 只接受独立标签，不能因为公司叫“在线教育”或JD含“在线”就当HR在线。
export function hrActivityLabel(value = '') {
  const text=normalizeText(value).replace(/^[●•]\s*/u,'');
  return new RegExp(`^${HR_ACTIVITY_LABEL_PATTERN}$`,'u').test(text) ? text : '';
}

export function parseHrActivity(value = '', now = new Date()) {
  const label=hrActivityLabel(value);
  const online=/^(?:当前在线|正在在线|在线)$/u.test(label);
  let activeToday=online || /^(?:刚刚(?:活跃|在线)|(?:今日|今天|当日)(?:活跃|在线))$/u.test(label);
  let activeWithin3Days=activeToday || /^(?:昨天|昨日|前天)(?:活跃|在线)$/u.test(label);
  const day=label.match(/^([0-9]+|[一二三七十]+)(?:日|天)(?:内|前)(?:活跃|在线)$/u);
  if(day) {
    const n=Number(day[1]) || ({一:1,二:2,三:3,七:7,十:10})[day[1]];
    activeWithin3Days=Boolean(n>=1 && n<=3);
  }
  const relative=label.match(/^(\d+)(分钟|小时)前(?:活跃|在线)?$/u);
  const minutes=label.startsWith('半小时前') ? 30 : relative ? Number(relative[1])*(relative[2]==='小时' ? 60 : 1) : null;
  if(minutes!==null) {
    activeWithin3Days=minutes<=3*24*60;
    // “1小时前”可能已经是昨天；当天口径使用上海日历日，不拿24小时冒充今天。
    const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
    const elapsed=Number(parts.find(p=>p.type==='hour').value)*60+Number(parts.find(p=>p.type==='minute').value);
    activeToday=minutes<=elapsed;
  }
  return {label,known:Boolean(label),online,activeToday,activeWithin3Days};
}

export function checkHrActivity(activityText, filter = 'within3days', now = new Date()) {
  const mode=normalizeHrActivityFilter(filter),hr=parseHrActivity(activityText,now);
  const allowed=mode==='any' || (mode==='online' ? hr.online : mode==='today' ? hr.activeToday : hr.activeWithin3Days);
  return {...hr,filter:mode,filterLabel:HR_ACTIVITY_FILTERS[mode],allowed,
    code:allowed ? 'hr_activity_passed' : hr.known ? 'hr_activity_filtered' : 'hr_activity_unknown',
    reason:`HR 活跃筛选：本轮要求“${HR_ACTIVITY_FILTERS[mode]}”，页面标签“${hr.label || '未识别/未显示'}”；${allowed ? '通过' : hr.known ? '不满足，跳过本条' : '无法确认满足条件，跳过本条（不等于HR不活跃）'}`};
}

export function parseHrSignals(activityText = "", replyText = "") {
  const combined = normalizeText(`${activityText} ${replyText}`);
  const repliedToday = /今日回复|今天回复|今日回复过|今日回复率高/u.test(normalizeText(replyText));
  const activity = parseHrActivity(activityText);
  const {activeWithin3Days} = activity;
  let priority = 0;
  if (activeWithin3Days) priority += 15;
  if (repliedToday) priority += 20;
  return { ...activity, repliedToday, priority, raw: combined };
}

export function splitResponsibilitiesAndRequirements(description = "") {
  const source = String(description).replace(/\r/g, "").trim();
  if (!source) return { responsibilities: [], requirements: [] };
  const requirementMarker = /(?:任职要求|职位要求|岗位要求|任职资格|任职条件|我们希望你|要求[:：]?)/iu;
  const marker = requirementMarker.exec(source);
  const dutyText = marker ? source.slice(0, marker.index) : source;
  const requirementText = marker ? source.slice(marker.index + marker[0].length) : "";
  const split = (text) => unique(text
    .split(/(?:\n+|[；;]|(?=\d+[、.．)]))/u)
    .map((item) => normalizeText(item).replace(/^[-·•\d、.．)\s]+/u, ""))
    .filter((item) => item.length >= 6)
    .slice(0, 8));
  return { responsibilities: split(dutyText), requirements: split(requirementText) };
}

export function selectProfilePoints(jobText = "", limit = 4) {
  const source = normalizeText(jobText).toLowerCase();
  return PROFILE_POINT_RULES
    .map((rule) => ({
      label: rule.label,
      score: rule.terms.reduce((sum, term) => sum + (source.includes(term.toLowerCase()) ? 1 : 0), 0)
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.label);
}

export function analyzeJob(job = {}) {
  const title = normalizeText(job.title);
  const description = cleanJobText(job.description);
  const tags = Array.isArray(job.tags) ? job.tags.join(" ") : normalizeText(job.tags);
  const source = `${title} ${normalizeText(job.listingTitle)} ${tags} ${description}`;
  const locationOk = isShanghaiLocation(job.location);
  const postponeMatches = {};
  for (const [group, terms] of Object.entries(POSTPONE_GROUPS)) {
    const matches = matchTerms(source, terms);
    if (matches.length) postponeMatches[group] = matches;
  }
  const isGameSoftwareTesting = /游戏测试|手游测试|端游测试|棋牌测试|游戏测开/iu.test(source);
  if (isGameSoftwareTesting && postponeMatches.hardware) {
    const strongHardwareTerms = postponeMatches.hardware.filter((term) => !["硬件", "软硬件"].includes(term));
    if (strongHardwareTerms.length) postponeMatches.hardware = strongHardwareTerms;
    else delete postponeMatches.hardware;
  }
  const positiveMatches = matchTerms(source, SOFTWARE_TEST_KEYWORDS);
  // “生产测试/回收测试”不是软件测试；使用职责对象组合，不能因公司行业就排除其软件岗。
  const strongSoftware=/软件测试|接口测试|自动化测试|功能测试|测试开发|游戏测试|web|\bapp\b|h5|pytest|postman|apifox/iu.test(source);
  const physicalProduction=!strongSoftware && /生产测试|测试工艺|测试导入/u.test(source)
    && /半导体|电子工程|IATF|APQP|PPAP|晶圆|芯片/iu.test(source);
  const physicalRetail=!strongSoftware && /回收|奢侈品|门店|店铺/u.test(title)
    && /回收测试|回收服务|商品.{0,8}(?:整理|包装|评估)|销售接待/u.test(description);
  const hr = parseHrSignals(job.activityText, job.replyText);
  const matchedProfilePoints = selectProfilePoints(source);
  const postponeTerms = Object.values(postponeMatches).flat();
  let decision = "recommend";
  let category = "software_testing";
  const reasons = [];
  let score = 40 + Math.min(positiveMatches.length * 4, 25) + hr.priority;

  if (!locationOk) {
    decision = "exclude";
    category = "non_shanghai";
    score = 0;
    reasons.push("岗位位置未识别为上海");
  } else if (physicalProduction || physicalRetail) {
    decision='postpone';category=physicalProduction ? 'hardware_production' : 'non_software_retail';score=0;
    reasons.push(physicalProduction ? '本地筛选：职责为半导体/电子产品生产测试与测试工艺，不是软件测试；不调用模型'
      : '本地筛选：职责为商品回收、门店服务与实物评估，不是软件测试；不调用模型');
  } else if (postponeTerms.length) {
    decision = "postpone";
    category = Object.keys(postponeMatches)[0];
    score = Math.min(score, 25);
    reasons.push(`当前暂缓方向：${postponeTerms.slice(0, 6).join("、")}`);
  } else if (!positiveMatches.length && !/测试|测开|qa|质量/u.test(source)) {
    decision = "exclude";
    category = "not_software_testing";
    score = Math.min(score, 20);
    reasons.push("没有识别到软件测试职责或技能");
  } else if (positiveMatches.length < 2 && !/软件测试|接口测试|功能测试|自动化测试|测试开发|游戏测试|手游测试|端游测试|棋牌测试|游戏测开|测开/iu.test(source)) {
    decision = "recommend";
    category = "ambiguous_testing";
    score = Math.min(score, 59);
    reasons.push("本地宽松放行：包含测试/质量职责，未命中明确排除条件；不因领域或技术栈描述不足而漏投，模型仅生成招呼语");
  } else {
    reasons.push(`软件测试信号：${positiveMatches.slice(0, 6).join("、")}`);
  }

  if (locationOk) reasons.push(`地点符合：${normalizeText(job.location)}`);
  if (hr.repliedToday) reasons.push("招聘者今天回复过求职者");
  if (hr.activeWithin3Days) reasons.push("招聘者最近3日内活跃");

  return {
    decision,
    category,
    score: Math.max(0, Math.min(100, score)),
    reasons,
    locationOk,
    positiveMatches,
    postponeMatches,
    matchedProfilePoints,
    hr
  };
}

export function recruiterSalutation(displayName = "") {
  const clean = normalizeText(displayName)
    .replace(/(?:在线|刚刚活跃|今日活跃|[123]日内活跃|本周活跃).*$/u, "")
    .replace(/(?:招聘者|招聘经理|人事|HR|猎头顾问).*$/iu, "")
    .trim();
  if (!clean) return "您好";
  const chinese = (clean.match(/[\u3400-\u9fff]/gu) || []).join("");
  if (!chinese) return "您好";
  const surname = COMPOUND_SURNAMES.find((item) => chinese.startsWith(item)) || chinese[0];
  return `${surname}老师您好`;
}

export function stableJobKey(job = {}) {
  const hrefMatch = String(job.url || "").match(/\/job_detail\/([^/?#]+)\.html/iu);
  if (hrefMatch) return hrefMatch[1];
  const source = normalizeText(`${job.company}|${job.title}|${job.location}`);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fallback-${(hash >>> 0).toString(16)}`;
}

export function normalizeCompanyKey(company = "") {
  const value = normalizeText(company).toLowerCase();
  if (!value || /未识别|保密|某[^，。｜|]{0,20}公司/u.test(value)) return "";
  return value
    .replace(/[（(][^）)]{0,40}[）)]/gu, "")
    .replace(/(?:有限责任公司|股份有限公司|有限公司)$/u, "")
    .replace(/[\s·•｜|_-]+/gu, "")
    .trim();
}

// 0.4.19：只统一开头称呼为「X老师您好」，其余开场交给模型按职位描述自然展开，不再套固定的“看贵公司在招聘…岗位”。
export function formatPreferredGreeting(rawGreeting, job = {}) {
  const salutation = recruiterSalutation(job.recruiterName);
  let remainder = normalizeText(rawGreeting).replace(/^[“"]|[”"]$/gu, "")
    .replace(/^(?:[\u3400-\u9fff]{0,4}(?:老师|女士|先生|经理|总|HR|hr)\s*(?:您好|你好|好)?|您好|你好|hi|hello)(?:[，,！!。：:\s]+|$)/iu, "");
  const company = normalizeText(job.company);
  const multiEntity = ['agency','multi_entity'].includes(job.recruitmentMode);
  if (company) remainder = normalizeText(remainder.split(company).join(multiEntity ? '您这边' : '贵公司'));
  remainder = remainder.replace(/^[。；;：:，,\s]+/u, "");
  return `${salutation}，${remainder || "看了咱们这个岗位的职责，和我之前做的事情挺对口的，方便的话想跟您进一步聊聊。"}`;
}

export function buildFocusedFallback(job, candidateSummary = '') {
  const jd = cleanJobText(`${job.title} ${job.description}`).toLowerCase();
  const profile = normalizeText(candidateSummary).toLowerCase();
  const choices = [
    {job:/python|接口自动化/u, profile:/python/u, also:/接口自动化/u, point:'接口自动化', text:'之前一直用Python写接口自动化脚本，平时的回归基本靠它跑'},
    {job:/接口|postman/u, profile:/postman/u, also:/接口/u, point:'接口测试', text:'之前接口这块主要是我在负责，用Postman把正常流程和各种异常参数都过一遍'},
    {job:/性能|jmeter|并发/u, profile:/jmeter/u, also:/性能|并发/u, point:'性能测试', text:'之前用JMeter做过并发测试和性能回归，会盯TPS、响应时间这些指标'},
    {job:/android|app|移动端/u, profile:/android/u, also:/回归/u, point:'App测试', text:'之前Android App的版本回归和新功能测试一直是我在跟'},
    {job:/mysql|sql|数据/u, profile:/mysql/u, also:/查询|sql/u, point:'数据校验', text:'平时会直接写SQL查库，核对接口返回和数据库记录是不是一致'},
    {job:/ai|大模型|评测/u, profile:/dify/u, also:/评测/u, point:'AI功能测试', text:'之前用Dify做过批量评测，AI功能的结果校验也是我在做'},
    {job:/用例|功能|回归/u, profile:/测试用例|用例设计/u, also:/回归/u, point:'功能测试', text:'之前从需求评审、写用例到版本回归都是我自己在跟'}
  ];
  const choice = choices.find(item=>item.job.test(jd) && item.profile.test(profile) && item.also.test(profile));
  if (!choice) return '';
  const years = profile.match(/(?:具备|有)?(\d+)年软件测试/u)?.[1];
  const experience = years ? `做了${years}年测试，` : '';
  return formatPreferredGreeting(`看岗位里比较看重${choice.point}，${experience}${choice.text}，感觉和咱们这边挺对口的，方便的话想跟您细聊一下。`,job);
}

export function contactEligibility(attempts = [], settings = CORE_CONTACT_DEFAULTS, nowValue = Date.now()) {
  const successful = attempts.filter((item) => item && item.status === "sent");
  if (successful.length >= settings.maxContactsPerJob) {
    return { eligible: false, round: successful.length + 1, reason: "该岗位已完成三次沟通，停止继续发送", eligibleAt: null };
  }
  if (!successful.length) return { eligible: true, round: 1, reason: "可以首次沟通", eligibleAt: nowValue };
  const last = successful[successful.length - 1];
  if (successful.length === 1) {
    const minimumHours = Math.max(0, Number(settings.secondContactMinHours ?? CORE_CONTACT_DEFAULTS.secondContactMinHours));
    const eligibleAt = new Date(last.sentAt).getTime() + minimumHours * 60 * 60 * 1000;
    const eligible = nowValue >= eligibleAt;
    return {
      eligible,
      round: 2,
      reason: eligible
        ? "当天可以进行第二次沟通"
        : `距离首次沟通不足 ${minimumHours} 小时，暂不重复发送`,
      eligibleAt
    };
  }
  const shanghaiDateParts = (value) => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
  const lastDate = shanghaiDateParts(last.sentAt);
  const currentDate = shanghaiDateParts(nowValue);
  const eligible = currentDate > lastDate;
  return {
    eligible,
    round: 3,
    reason: eligible ? "次日可以进行第三次沟通" : "第三次沟通需等到上海时间次日",
    eligibleAt: null
  };
}

export function randomRestSeconds(settings = CORE_CONTACT_DEFAULTS, randomValue = Math.random()) {
  const min = Number(settings.restMinSeconds);
  const max = Number(settings.restMaxSeconds);
  return Math.floor(min + Math.max(0, Math.min(0.999999, randomValue)) * (max - min + 1));
}

export function buildModelPayload(job, localAnalysis, settings, round = 1) {
  const sections = splitResponsibilitiesAndRequirements(cleanJobText(job.description));
  return {
    task:'greeting_only',
    job: {
      id: stableJobKey(job),
      companyName: normalizeText(job.company),
      recruitmentMode: job.recruitmentMode || 'unknown',
      listingCompany: normalizeText(job.listingCompany),
      recruiterCompany: normalizeText(job.recruiterCompany),
      employerCompany: job.employerCompanyConfirmed ? normalizeText(job.employerCompany) : '',
      listingJobTitle: normalizeText(job.listingTitle),
      jobTitle: normalizeText(job.title),
      recruiterDisplayName: normalizeText(job.recruiterName),
      recruiterSalutation: recruiterSalutation(job.recruiterName),
      location: normalizeText(job.location),
      tags: Array.isArray(job.tags) ? job.tags.map(normalizeText) : [],
      responsibilities: sections.responsibilities,
      requirements: sections.requirements,
      description: cleanJobText(job.description).slice(0, 7000),
      activityText: normalizeText(job.activityText),
      replyText: normalizeText(job.replyText)
    },
    localAnalysis: {
      screeningPassed: true,
      matchedProfilePoints: localAnalysis.matchedProfilePoints.slice(0, 2)
    },
    candidateSummary: settings.candidateSummary,
    contactRound: round,
    greetingRules: normalizeText(settings.greetingRules)
  };
}

export function parseModelResult(rawValue, {greetingOnly=false} = {}) {
  const raw = typeof rawValue === "string" ? rawValue : JSON.stringify(rawValue);
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  const parsed = JSON.parse(cleaned);
  const allowed = new Set(["recommend", "review", "postpone", "exclude"]);
  if (!greetingOnly && !allowed.has(parsed.decision)) throw new Error("模型 decision 字段无效");
  if(greetingOnly && (typeof parsed.greeting!=='string' || !normalizeText(parsed.greeting))) throw new Error('模型没有生成招呼语');
  const greeting = normalizeText(parsed.greeting || "").replace(/^[“"]|[”"]$/gu, "");
  return {
    decision: greetingOnly ? 'recommend' : parsed.decision,
    category: normalizeText(parsed.category || "unknown"),
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
    matchedKeywords: Array.isArray(parsed.matchedKeywords) ? parsed.matchedKeywords.map(normalizeText).filter(Boolean).slice(0, 4) : [],
    excludedKeywords: Array.isArray(parsed.excludedKeywords) ? parsed.excludedKeywords.map(normalizeText).filter(Boolean).slice(0, 8) : [],
    selectedProfileFacts: Array.isArray(parsed.selectedProfileFacts) ? parsed.selectedProfileFacts.map(normalizeText).filter(Boolean).slice(0, 2) : [],
    reason: normalizeText(parsed.reason || ""),
    greeting
  };
}
