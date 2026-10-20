import { FILTER_FIELD_DEFINITIONS, normalizeFilters, parseKeywords, keywordThreshold, keywordRuleLabel } from './config.js';
const CORE_CONTACT_DEFAULTS = Object.freeze({dailyLimit:500,batchSize:10,restMinSeconds:10,restMaxSeconds:30,secondContactMinHours:4,laterContactMinHours:24,laterContactsRequireNextDay:true,companyCooldownHours:24,maxContactsPerJob:3});
const COMPOUND_SURNAMES = [
  "欧阳", "司马", "上官", "诸葛", "夏侯", "东方", "皇甫", "尉迟", "公孙", "慕容",
  "令狐", "宇文", "长孙", "司徒", "司空", "端木"
];

export function normalizeText(value = "") {
  return String(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
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

function matchFragments(text, terms) {
  const source = normalizeText(text).toLowerCase();
  return unique(terms.filter((term) => source.includes(String(term).toLowerCase())));
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

// 原始岗位标题继续用于岗位身份核对、筛选、日志和防重复；这个函数只负责生成
// 更适合自然对话的岗位简称。规则故意保持保守：只移除明确的招聘修饰、尾部括号
// 说明和福利尾巴；无法可靠区分时保留原题，避免把真实岗位含义清空。
const CONVERSATIONAL_ROLE_WORDS = /(?:顾问|专员|助理|经理|主管|代表|销售|客服|工程师|运营|策划|会计|财务|人事|行政|文员|教师|老师|医生|护士|设计师|开发|测试|产品|采购|仓管|司机|厨师|技师|分析师|研究员|BD|HR)/iu;
const TITLE_RECRUITING_PREFIX = /^(?:(?:高薪|急)?诚聘|高薪招聘|诚招|急招|直招|招聘)\s*/iu;
const TITLE_BENEFIT_TAIL = /^(?:员工宿舍|提供住宿|免费住宿|包住|包吃住|包吃|五险(?:一金)?|双休|周末双休|提成|奖金|补贴|年终奖|带薪年假|节日福利|餐补|房补|交通补贴|下午茶|不加班|轻松无压力|时间自由|就近安排)$/iu;

export function conversationalJobTitle(rawTitle = "") {
  const original = normalizeText(rawTitle);
  if (!original) return "";
  let title = original;

  // BOSS 标题中括号尾巴通常是地点、方向或招聘卖点；对话里只保留岗位主名称。
  let previous = "";
  while (title !== previous) {
    previous = title;
    title = normalizeText(title.replace(/\s*[（(【\[][^）)】\]]{1,80}[）)】\]]\s*$/u, ""));
  }

  // “岗位＋员工宿舍”只去掉明确福利；“产品+运营”等复合岗位不会被拆掉。
  const plusParts = title.split(/\s*[+＋]\s*/u).map(normalizeText).filter(Boolean);
  if (plusParts.length > 1 && plusParts.slice(1).every((part) => TITLE_BENEFIT_TAIL.test(part))) {
    title = plusParts[0];
  }

  // 斜杠前后只有一段像岗位时，选那一段；多段都像岗位时保留第一主标题。
  const slashParts = title.split(/\s*[/／|｜]\s*/u).map((part) => normalizeText(part).replace(TITLE_RECRUITING_PREFIX, "")).filter(Boolean);
  if (slashParts.length > 1) {
    const roleParts = slashParts.filter((part) => CONVERSATIONAL_ROLE_WORDS.test(part));
    if (roleParts.length) title = roleParts[0];
  }

  title = normalizeText(title.replace(TITLE_RECRUITING_PREFIX, "").replace(/^[·•:：,，\-—\s]+|[·•:：,，\-—\s]+$/gu, ""));
  return title || original;
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


export function contactEligibility(attempts = [], settings = CORE_CONTACT_DEFAULTS, nowValue = Date.now()) {
  const successful = attempts.filter((item) => item && item.status === "sent");
  const maximum = Math.max(1, Number(settings.maxContactsPerJob ?? CORE_CONTACT_DEFAULTS.maxContactsPerJob));
  if (successful.length >= maximum) {
    return { eligible: false, round: successful.length + 1, reason: `该岗位已完成 ${maximum} 次沟通，达到当前设置的上限`, eligibleAt: null };
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
  const minimumHours = Math.max(0, Number(settings.laterContactMinHours ?? CORE_CONTACT_DEFAULTS.laterContactMinHours));
  const hourEligibleAt = new Date(last.sentAt).getTime() + minimumHours * 60 * 60 * 1000;
  const requiresNextDay = settings.laterContactsRequireNextDay ?? CORE_CONTACT_DEFAULTS.laterContactsRequireNextDay;
  const dayEligible = !requiresNextDay || shanghaiDateParts(nowValue) > shanghaiDateParts(last.sentAt);
  const eligible = nowValue >= hourEligibleAt && dayEligible;
  return {
    eligible,
    round: successful.length + 1,
    reason: eligible ? `可以进行第 ${successful.length + 1} 次沟通` : `后续沟通需间隔 ${minimumHours} 小时${requiresNextDay ? '，并到北京时间下一自然日' : ''}`,
    eligibleAt: hourEligibleAt
  };
}

export function randomRestSeconds(settings = CORE_CONTACT_DEFAULTS, randomValue = Math.random()) {
  const min = Number(settings.restMinSeconds);
  const max = Number(settings.restMaxSeconds);
  return Math.floor(min + Math.max(0, Math.min(0.999999, randomValue)) * (max - min + 1));
}


export function parseModelResult(rawValue) {
  const raw = typeof rawValue === "string" ? rawValue : JSON.stringify(rawValue);
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  const parsed = JSON.parse(cleaned);
  const allowed = new Set(["recommend", "review", "postpone", "exclude"]);
  if (!allowed.has(parsed.decision)) throw new Error("模型 decision 字段无效");
  const greeting = normalizeText(parsed.greeting || "").replace(/^[“"]|[”"]$/gu, "");
  return {
    decision: parsed.decision,
    category: normalizeText(parsed.category || "unknown"),
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
    matchedKeywords: Array.isArray(parsed.matchedKeywords) ? parsed.matchedKeywords.map(normalizeText).filter(Boolean).slice(0, 4) : [],
    excludedKeywords: Array.isArray(parsed.excludedKeywords) ? parsed.excludedKeywords.map(normalizeText).filter(Boolean).slice(0, 8) : [],
    selectedProfileFacts: Array.isArray(parsed.selectedProfileFacts) ? parsed.selectedProfileFacts.map(normalizeText).filter(Boolean).slice(0, 2) : [],
    reason: normalizeText(parsed.reason || ""),
    greeting
  };
}

export function parseHrSignals(activityText='',replyText='') {
  const raw=normalizeText(activityText);
  // 只认活跃标识，不用“今日回复”推断活跃，不把“在线教育/不在线”当成在线。
  const text=raw.replace(/不在线|未在线|在线教育|在线课程|在线客服|在线招聘/gu,'');
  let activeDays=null,evidence='';
  const immediate=text.match(/当前在线|目前在线|正在在线|(?<![\p{L}\p{N}])在线(?![\p{L}\p{N}])|刚刚活跃|刚刚在线|今日活跃|今天活跃|当天活跃/u);
  const elapsed=text.match(/(\d+)\s*(分钟|小时)前(?:活跃|在线)/u);
  const numeric=text.match(/(\d+|一|二|两|三|四|五|六|七|八|九|十)\s*(?:日|天)(以内|内|前|以外|外|以上)(?:活跃|在线)?/u);
  if(immediate){activeDays=1;evidence=immediate[0];}
  else if(elapsed){activeDays=elapsed[2]==='分钟'?Math.max(1,Math.ceil(Number(elapsed[1])/1440)):Math.max(1,Math.ceil(Number(elapsed[1])/24));evidence=elapsed[0];}
  else if(numeric){const digits={'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10};activeDays=digits[numeric[1]]||Number(numeric[1]);if(/以外|外|以上/u.test(numeric[2]))activeDays++;evidence=numeric[0];}
  else if(/昨日活跃|昨天活跃/u.test(text)){activeDays=2;evidence='昨日活跃';}
  else if(/本周活跃/u.test(text)){activeDays=7;evidence='本周活跃';}
  else if(/本月活跃/u.test(text)){activeDays=30;evidence='本月活跃';}
  else if(/长期未活跃|很久未活跃|长期未上线/u.test(text)){activeDays=365;evidence='长期未活跃';}
  const rangeOnly=Boolean(numeric&&/内/u.test(numeric[2]))||/本周活跃|本月活跃/u.test(evidence);
  return {activeDays,activeWithin3Days:activeDays!==null&&activeDays<=3,rangeOnly,raw,evidence};
}

export function analyzeJob(job={},settings={}) {
  const f=normalizeFilters(settings.filters);
  // 每个可见字段独立筛选，避免“标签命中”被误记成“正文命中”。
  const fields={title:cleanJobText(job.title),description:cleanJobText(job.description),tags:cleanJobText(Array.isArray(job.tags)?job.tags.join(' '):(job.tags||'')),company:cleanJobText(job.company),location:cleanJobText(job.location),recruiter:cleanJobText(job.recruiterName),activity:cleanJobText(job.activityText),reply:cleanJobText(job.replyText)};
  const reasons=[],positiveMatches=[],postponeMatches={};
  let failed=false;
  // 所有字段复用同一套“包含/排除 + 匹配阈值”规则。空白组完全不参与判断。
  for(const definition of FILTER_FIELD_DEFINITIONS) {
    for(const excluded of [false,true]) {
      const key=`${definition.key}${excluded?'Exclude':'Include'}`;
      const terms=parseKeywords(f[key]); if(!terms.length)continue;
      const matcher=definition.match==='fragment'?matchFragments:matchTerms;
      const hits=matcher(fields[definition.key],terms),mode=f[key+'Mode'],threshold=keywordThreshold(terms,mode,f[key+'Count']);
      const matched=hits.length>=threshold;
      if(excluded&&matched){failed=true;postponeMatches[key]=hits;}else if(!excluded){positiveMatches.push(...hits);if(!matched)failed=true;}
      reasons.push(`${definition.label}${excluded?'排除':'包含'}词：${keywordRuleLabel(mode,f[key+'Count'])}；实际命中 ${hits.length}/${terms.length}（${hits.join('、')||'无'}）→ ${excluded?(matched?'跳过':'未触发排除'):(matched?'通过':'未通过')}`);
    }
  }
  const hr=parseHrSignals(job.activityText);
  if(f.hrActiveDays>0){
    if(hr.activeDays===null){const skip=f.hrUnknownPolicy!=='allow';if(skip)failed=true;reasons.push('活跃状态未知：'+(skip?'按设置跳过（不是判定超过'+f.hrActiveDays+'天）':'按设置放行（不是判定在'+f.hrActiveDays+'天内）'));}
    else if(hr.activeDays>f.hrActiveDays){failed=true;reasons.push(hr.rangeOnly?'页面只显示“'+hr.evidence+'”，无法确认在'+f.hrActiveDays+'天内 → 跳过':'活跃标识“'+hr.evidence+'”超过'+f.hrActiveDays+'天范围 → 跳过');}
    else reasons.push('活跃标识“'+hr.evidence+'”在'+f.hrActiveDays+'天范围内（含在线/当天及更近状态）→ 通过');
  }
  if(!failed)reasons.push('通过当前筛选；所有未填写的字段组均不作限制');
  return {decision:failed?'exclude':'recommend',category:failed?'custom_filter':'custom_match',score:failed?0:80,reasons,positiveMatches,postponeMatches,locationOk:true,matchedProfilePoints:[],hr};
}

export const TEMPLATE_VARIABLES = ['称呼','招聘者','公司','岗位','城市','沟通次数'];
export function validateTemplate(template) {
  const value=String(template||'').trim();
  if(!value)throw new Error('请先填写并保存自定义模板');
  if(value.length>2000)throw new Error('模板不能超过2000字');
  for(const match of value.matchAll(/\{([^{}]+)\}/gu))if(!TEMPLATE_VARIABLES.includes(match[1]))throw new Error('不支持的模板变量：{'+match[1]+'}');
  if(/[{}]/u.test(value.replace(/\{([^{}]+)\}/gu,'')))throw new Error('模板变量请使用单层大括号，例如{岗位}');
  return value;
}
export function renderGreetingTemplate(template,job={},round=1) {
  const value=validateTemplate(template);
  const variables={'称呼':recruiterSalutation(job.recruiterName),'招聘者':normalizeText(job.recruiterName),'公司':normalizeText(job.company),'岗位':conversationalJobTitle(job.title),'城市':normalizeText(job.location).split(/[·\s]/u)[0],'沟通次数':String(round)};
  const rendered=value.replace(/\{([^{}]+)\}/gu,(_,key)=>{
    if(!variables[key])throw new Error('模板需要{'+key+'}，但该岗位没有读到对应信息，未发送');
    return variables[key];
  });
  if(rendered.length>2000)throw new Error('替换后的话术超过2000字，请缩短模板');
  return rendered;
}
export function buildModelPayload(job,localAnalysis,settings,round=1) {
  const sections=splitResponsibilitiesAndRequirements(cleanJobText(job.description));
  return {job:{companyName:normalizeText(job.company),jobTitle:conversationalJobTitle(job.title),recruiterDisplayName:normalizeText(job.recruiterName),recruiterSalutation:recruiterSalutation(job.recruiterName),location:normalizeText(job.location),...sections,description:cleanJobText(job.description).slice(0,7000)},
    localAnalysis:{decision:localAnalysis.decision,reasons:localAnalysis.reasons},candidateSummary:settings.candidateSummary,contactRound:round,greetingRules:settings.greetingRules,greetingMaxChars:settings.greetingMaxChars??200};
}
