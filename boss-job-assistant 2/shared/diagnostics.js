export function reasonCategory(reason = '', status = '') {
  if (status === 'sent') return 'sent';
  if (['queued','delivering'].includes(status)) return status;
  if (status==='skipped' && /^(?:自动批量暂缓猎头\/外包|自动批量暂缓大中型科技\/互联网公司|本地筛选)/u.test(reason)) return 'filtered';
  if (status === 'skipped' && /^HR 活跃筛选/u.test(reason)) return 'filtered';
  if (['delivery_error','send_state_unknown','generation_error'].includes(status)) return status;
  // 模型正常给出“不推荐”是筛选跳过，不是模型调用故障。
  if (status === 'skipped' && /模型/u.test(reason) && !/话术|失败|超时|异常/u.test(reason)) return 'filtered';
  if (/没有完整加载|读取|身份|不一致|未稳定/u.test(reason) || status === 'read_error') return 'read_error';
  if (/话术|模型|接口请求/u.test(reason) || status === 'generation_error') return 'generation_error';
  if (/同公司|同一招聘者|距离首次|已完成三次|已标记招聘者回复|第三次沟通/u.test(reason)) return 'contact_hold';
  if (/当前暂缓方向|明确包含暂缓领域|位置未识别|没有识别到软件/u.test(reason)) return 'filtered';
  return status === 'skipped' ? 'other_skip' : status || 'unknown';
}

export function diagnosticText(value = '', secret = '') {
  let text = String(value || '');
  if (secret) text = text.split(secret).join('[REDACTED]');
  return text.replace(/Bearer\s+\S+/giu, 'Bearer [REDACTED]')
    .replace(/https?:\/\/[^\s，；]+/gu, url => url.split(/[?#]/u)[0])
    .slice(0, 500);
}

export function identitySummary(value = {}, secret = '') {
  const result={};
  for (const key of ['jobKey','title','company','detailCompany','listingCompany','detailCompanySource','recruiterName','recruiterCompany','employerCompany','recruitmentMode']) {
    result[key]=diagnosticText(value[key],secret).slice(0,160);
  }
  return result;
}

export function diagnosticPageUrl(value = '') {
  try {
    const url=new URL(value);
    // 不记录query/hash、userinfo或未知站点的地址。
    return url.protocol==='https:' && url.hostname==='www.zhipin.com' ? `${url.origin}${url.pathname}` : '';
  } catch {return '';}
}

function scopeDiagnostics(value,secret) {
  const count=value=>Number.isFinite(value) && value>=0 ? Math.min(Math.floor(value),100000) : 0;
  const token=value=>typeof value==='string' && /^[a-z_]{1,64}$/u.test(value) ? value : '';
  const classes=value=>diagnosticText(value,secret).split(/\s/u).filter(part=>/^[A-Za-z0-9_:\[\]-]{1,64}$/u.test(part)).slice(0,12).join(' ').slice(0,160);
  const tag=value=>typeof value==='string' && /^[A-Z][A-Z0-9:-]{0,23}$/u.test(value) ? value : '';
  const node=value=>({tag:tag(value?.tag),className:classes(value?.className)});
  const fields=new Set(['title','recruiter','recruiter_company']);
  const sources=new Set(['[data-job-title]','.job-name','.job-title','.position-name','.position-title','a[href*="/job_detail/"]','h1,h2,h3,strong,b','unique_local_title',
    '.base-info > .name-content > .name-text','[data-recruiter-name]','.boss-name','.recruiter-name','.user-name','.name','.name-box','unique_heading_name','direct_name',
    '.user-info > .base-info > span:not([class])','[data-recruiter-company]','.recruiter-company','.boss-company','.company-name','.company','.company-info','company_role_line']);
  return (Array.isArray(value)?value:[]).slice(0,16).filter(item=>item && typeof item==='object').map(item=>{
    const result={depth:Math.min(count(item.depth),15),rootTag:tag(item.rootTag),rootClass:classes(item.rootClass),reason:token(item.reason),viewJobLinkCount:count(item.viewJobLinkCount)};
    for(const key of ['cardTag']) if(typeof item[key]==='string') result[key]=tag(item[key]);
    for(const key of ['cardClass']) if(typeof item[key]==='string') result[key]=classes(item[key]);
    for(const key of ['cardStopReason','headerSource']) if(typeof item[key]==='string') result[key]=token(item[key]);
    if(Number.isFinite(item.headerElementCount)) result.headerElementCount=count(item.headerElementCount);
    for(const key of ['contactSearchFound','contactAreaFound','titleFound','recruiterFound','companyFound']) if(typeof item[key]==='boolean') result[key]=item[key];
    result.headerRoots=(Array.isArray(item.headerRoots)?item.headerRoots:[]).slice(0,8).map(node);
    result.headerAttempts=(Array.isArray(item.headerAttempts)?item.headerAttempts:[]).slice(0,12).map(entry=>({...node(entry),source:token(entry?.source),reason:token(entry?.reason)}));
    result.cardAttempts=(Array.isArray(item.cardAttempts)?item.cardAttempts:[]).slice(0,7).map(entry=>({...node(entry),depth:Math.min(count(entry?.depth),6),reason:token(entry?.reason)}));
    result.fieldAttempts=(Array.isArray(item.fieldAttempts)?item.fieldAttempts:[]).filter(entry=>entry && fields.has(entry.field)).slice(0,24)
      .map(entry=>({field:entry.field,source:sources.has(entry.source) ? entry.source : '',matchedCount:count(entry.matchedCount),acceptedCount:count(entry.acceptedCount)}));
    return result;
  });
}

export function diagnosticDetails(value = {}, secret = '') {
  const result={};
  for(const key of ['buttonTag','buttonHrefKind']) if(typeof value[key]==='string') result[key]=diagnosticText(value[key],secret).slice(0,40);
  for (const key of ['code','identityCode','pageType','visibility','readyState','rootSource','rootTag','rootClass','headerSource','titleSource','recruiterSource','recruiterCompanySource','recruiterContainerTag','recruiterContainerClass','conversationScope','scopeStopReason','observedMeaning','errorName','errorSite','deliveryStage','pageEvent','sourcePlan','navigationType','textState','continuation','deliveryId','hrActivityFilter','hrActivityLabel','hrActivitySource']) {
    if (typeof value[key]==='string') result[key]=diagnosticText(value[key],secret).slice(0,180);
  }
  if (value.pageUrl) result.pageUrl=diagnosticText(diagnosticPageUrl(value.pageUrl),secret);
  for (const key of ['elapsedMs','attempts','modelAttempt','descriptionLength','expectedDescriptionLength','viewJobLinkCount','headerElementCount','scopeDepth','lastScopeDepth','selectedScopeDepth','cardCount']) {
    if (Number.isFinite(value[key]) && value[key]>=0) result[key]=Math.min(Math.floor(value[key]),10000000);
  }
  for (const key of ['rootFound','recruiterContainerFound','communicationButtonFound','inputFound','titleMatched','recruiterMatched','recruiterCompanyMatched','descriptionEqual','automaticRecovery','modelCalled','buttonDisabled','dialogPresent','chatTabBound']) {
    if (typeof value[key]==='boolean') result[key]=value[key];
  }
  if(Array.isArray(value.scopeAttempts)) result.scopeAttempts=scopeDiagnostics(value.scopeAttempts,secret);
  const fields=new Set(['job_id','title','recruiter','recruiter_id','recruiter_company']);
  const statuses=new Set(['match','mismatch','missing_expected','missing_observed','not_checked']);
  result.checks=(Array.isArray(value.checks)?value.checks:[]).filter(item=>item && fields.has(item.field) && statuses.has(item.status)).slice(0,5)
    .map(item=>({field:item.field,label:diagnosticText(item.label,secret).slice(0,30),status:item.status,
      expected:diagnosticText(item.expected,secret).slice(0,160),observed:diagnosticText(item.observed,secret).slice(0,160)}));
  return result;
}

export function sessionDiagnostics(session) {
  if (!session) return null;
  const counts = {};
  const rows = (session.candidates || []).map(row => {
    const category = reasonCategory(row.reason, row.status);
    counts[category] = (counts[category] || 0) + 1;
    return {...identitySummary({...row.job,jobKey:row.jobKey}),category,status:row.status,
      reason:diagnosticText(row.reason),at:row.updatedAt || row.createdAt || session.updatedAt};
  });
  return {id:session.id,status:session.status,startedAt:session.startedAt,updatedAt:session.updatedAt,
    sourcePlan:session.sourcePlan?.label || '',hrActivityFilter:session.hrActivityFilter || '',successCount:session.successCount,scannedCount:session.scannedCount,counts,rows};
}
