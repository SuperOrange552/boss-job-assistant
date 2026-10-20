import {normalizeText} from './core.js';

const MESSAGE_AREAS = '.message-list,.message-content,.message-item,.chat-message-list,.chat-record,.chat-record-list,.chat-history,.message-history,[data-message-list],[data-message],.item-myself,.item-friend,[role="log"]';
const CONTACT_AREAS = '.contact-list,.user-list,.friend-list,[data-conversation-list]';
const CONTACT_SEARCH = 'input[placeholder*="联系人"],input[placeholder*="搜索联系"]';
// BOSS chat-new/v5535 ConversationTopInfo 的 UserInfo 与职位卡是兄弟节点。
// 不能选整个 top-info-content 后再把岗位文本混入招聘者抬头。
const HEADER_AREAS = '.top-info-content > .user-info-wrap,[data-chat-header],.chat-header,.chat-title,.chat-head,.chat-top,.conversation-header,.conversation-title,.im-title,.boss-info';
const TITLE_FIELDS = ['[data-job-title]','.job-name','.job-title','.position-name','.position-title','a[href*="/job_detail/"]','h1,h2,h3,strong,b'];
const NAME_FIELDS = ['.base-info > .name-content > .name-text','[data-recruiter-name]','.boss-name','.recruiter-name','.user-name','.name','.name-box'];
// 官方模板 companyName 是 base-info 的无 class 直属 span；base-title 是职务。
// 只在上方会话抬头内查找，并由下方唯一性判断拒绝多个无 class span 的歧义布局。
const COMPANY_FIELDS = ['.user-info > .base-info > span:not([class])','[data-recruiter-company]','.recruiter-company','.boss-company','.company-name','.company','.company-info'];
const VIEW_JOB = /^查看职位(?:\s*[>›〉»])?$/u;

function shown(element) {
  if (!element?.getBoundingClientRect) return false;
  const rect=element.getBoundingClientRect();
  const style=element.ownerDocument?.defaultView?.getComputedStyle(element);
  return rect.width>0 && rect.height>0 && style?.display!=='none' && style?.visibility!=='hidden' && Number(style?.opacity || 1)!==0;
}

function text(element) {return normalizeText(element?.innerText ?? element?.textContent);}
function ownText(element) {return normalizeText([...element.childNodes].filter(node=>node.nodeType===3).map(node=>node.textContent).join(' '));}
function query(root,selector) {return [...root.querySelectorAll(selector)].filter(shown);}
function unsafe(element) {return Boolean(element.closest(`${MESSAGE_AREAS},${CONTACT_AREAS}`));}
function usable(element,input,card=null) {return !unsafe(element) && !element.contains(input) && (!card || !card.contains(element));}
function leaves(root,selector='span,a,strong,b,p,div') {
  return query(root,selector).filter(element=>!element.children.length && text(element));
}
function unique(values) {return [...new Set(values.filter(Boolean))];}
function structure(element) {
  return {tag:String(element?.tagName || '').slice(0,24),className:String(element?.className || '').split(/\s/u)
    .filter(value=>/^[A-Za-z0-9_:-]{1,64}$/u.test(value)).slice(0,12).join(' ').slice(0,160)};
}
function fieldAttempt(trace,field,source,matchedCount,acceptedCount) {
  if(trace && trace.fieldAttempts.length<24) trace.fieldAttempts.push({field,source,matchedCount,acceptedCount});
}
function headerAttempt(trace,element,source,reason) {
  if(trace && trace.headerAttempts.length<12) trace.headerAttempts.push({...structure(element),source,reason});
}

function titleText(element) {
  const direct=ownText(element);
  if (direct) return direct;
  const nested=unique(query(element,'[data-job-title],.job-title,.position-title,.position-name').map(child=>ownText(child) || text(child)));
  if(nested.length===1) return nested[0];
  const values=unique([...element.children].filter(child=>shown(child)
    && !child.matches('.salary,.job-salary,.city,.location,.job-area,.area,.tags,.tag,.job-tags'))
    .map(text).filter(value=>value && !/^(?:\d+(?:\.\d+)?\s*[-–~]\s*\d+(?:\.\d+)?\s*[kK万千]|\d+\s*年|本科|大专|上海)/u.test(value)));
  if(values.length===1) return values[0];
  // 多个未能解释的子字段不得拼接成一个虚假的职位名称。
  return element.children.length ? '' : text(element);
}

function readTitle(card,link,trace=null) {
  const valid=element=>element!==link && !element.contains(link) && !link.contains(element) && !unsafe(element);
  for (const selector of TITLE_FIELDS) {
    const matches=query(card,selector).filter(valid);
    const candidates=unique(matches.map(titleText).filter(value=>value.length<=160 && !VIEW_JOB.test(value)));
    fieldAttempt(trace,'title',selector,matches.length,candidates.length);
    if (candidates.length===1) return {value:candidates[0],source:`job_card:${selector}`};
    if (candidates.length>1) return {value:'',source:'job_card:ambiguous_title'};
  }
  // 未知类名仅允许局部卡片内唯一的岗位标题文本，不扫描整个会话寻找任务中的预期词。
  const matches=leaves(card).filter(valid);
  const candidates=unique(matches.map(text).filter(value=>value.length<=120
    && /测试|工程师|开发|\b(?:QA|SDET)\b/iu.test(value) && !/[。；\n]/u.test(value)));
  fieldAttempt(trace,'title','unique_local_title',matches.length,candidates.length);
  return candidates.length===1 ? {value:candidates[0],source:'job_card:unique_local_title'} : {value:'',source:'job_card:title_missing'};
}

function findCard(link,root,input,trace=null) {
  let candidate=link.parentElement;
  for (let depth=0;candidate && candidate!==root && depth<7;depth++,candidate=candidate.parentElement) {
    if (candidate.contains(input) || unsafe(candidate)) {
      if(trace) trace.cardStopReason=candidate.contains(input) ? 'contains_input' : 'unsafe_area';
      break;
    }
    const local={fieldAttempts:[]};
    const title=readTitle(candidate,link,local);
    if(trace){trace.cardAttempts.push({...structure(candidate),depth,reason:title.value ? 'title_found' : 'title_missing'});trace.fieldAttempts=local.fieldAttempts;}
    if (title.value) return {element:candidate,title};
  }
  return null;
}

function headerRoots(root,card,input,trace=null) {
  const cardRect=card.getBoundingClientRect();
  const semantic=query(root,HEADER_AREAS).filter(element=>{
    const allowed=usable(element,input,card),position=element.getBoundingClientRect().top<=cardRect.bottom+4;
    headerAttempt(trace,element,'semantic',!allowed ? 'unsafe_or_input_or_card' : !position ? 'below_card' : 'accepted');
    return allowed && position;
  });
  if (semantic.length) return {elements:semantic,source:'semantic_chat_header'};
  // 允许 HR 抬头在岗位卡片外层：沿卡片祖先找位于卡片之前的兄弟区块。
  // 只读卡片上方的小区块，排除聊天记录、联系人区、输入区，不使用链接文字的高度裁切父容器。
  const structural=[];
  let branch=card;
  while (branch && branch!==root) {
    for (let sibling=branch.previousElementSibling;sibling;sibling=sibling.previousElementSibling) {
      if (!shown(sibling) || !usable(sibling,input,card) || sibling.querySelector(`${MESSAGE_AREAS},${CONTACT_AREAS},${CONTACT_SEARCH}`)) {
        headerAttempt(trace,sibling,'preceding_sibling',!shown(sibling) ? 'not_visible' : !usable(sibling,input,card) ? 'unsafe_or_input_or_card' : 'contains_excluded_area');
        continue;
      }
      const rect=sibling.getBoundingClientRect();
      const position=rect.bottom<=cardRect.top+4,short=text(sibling).length<=300;
      headerAttempt(trace,sibling,'preceding_sibling',!position ? 'not_above_card' : !short ? 'region_too_long' : 'accepted');
      if (position && short) structural.push(sibling);
    }
    branch=branch.parentElement;
  }
  return {elements:structural,source:structural.length ? 'preceding_local_header' : 'header_missing'};
}

function headerNodes(headers,selector,input,card) {
  const result=[];
  for (const root of headers) {
    if (root.matches(selector) && shown(root) && usable(root,input,card)) result.push(root);
    result.push(...query(root,selector).filter(element=>usable(element,input,card)));
  }
  return [...new Set(result)];
}

function readRecruiter(headers,input,card,trace=null) {
  const nameLike=value=>value && value.length<=24 && !/[|｜·，。:：]/u.test(value) && (!/\s/u.test(value) || /^[A-Za-z][A-Za-z .'-]+$/u.test(value))
    && !/公司|工程师|经理|主管|总监|招聘|人事|更多|查看职位|在线|活跃|上海/u.test(value);
  let name='',nameSource='header:name_missing';
  for (const selector of NAME_FIELDS) {
    const matches=headerNodes(headers,selector,input,card);
    // 官方 name-text 明确承载显示名，“陈经理”等是真实姓名显示，不是旁边的职务。
    // 角色词黑名单只用于泛选择器/启发式回退，不能否定这个明确字段。
    const validName=selector==='.base-info > .name-content > .name-text'
      ? value=>Boolean(value && value.length<=80) : nameLike;
    const values=unique(matches.map(element=>ownText(element) || text(element)).filter(validName));
    fieldAttempt(trace,'recruiter',selector,matches.length,values.length);
    if (values.length>1) return {name:'',company:'',nameSource:'header:ambiguous_name',companySource:'header:unresolved'};
    if (values.length===1) {name=values[0];nameSource=`header:${selector}`;break;}
  }
  if (!name) {
    const matches=headerNodes(headers,'strong,b,h1,h2,h3',input,card);
    const candidates=matches.map(text).filter(nameLike);
    fieldAttempt(trace,'recruiter','unique_heading_name',matches.length,unique(candidates).length);
    if (unique(candidates).length===1) {name=candidates[0];nameSource='header:unique_heading_name';}
  }
  if (!name) {
    const candidates=unique(headers.map(ownText).filter(nameLike));
    fieldAttempt(trace,'recruiter','direct_name',headers.length,candidates.length);
    if(candidates.length===1) {name=candidates[0];nameSource='header:direct_name';}
  }
  let company='',companySource='header:company_missing';
  const companyText=value=>normalizeText(value.split(/[·｜|]/u)[0]);
  for (const selector of COMPANY_FIELDS) {
    const matches=headerNodes(headers,selector,input,card);
    // 官方独立公司字段不是“公司 · 职务”合并行，企业名自身的分隔符必须保留。
    const readCompany=selector==='.user-info > .base-info > span:not([class])' ? normalizeText : companyText;
    const values=unique(matches.map(text).map(readCompany).filter(value=>value && value!==name && value.length<=160));
    fieldAttempt(trace,'recruiter_company',selector,matches.length,values.length);
    if (values.length>1) return {name,company:'',nameSource,companySource:'header:ambiguous_company'};
    if (values.length===1) {company=values[0];companySource=`header:${selector}`;break;}
  }
  if (!company) {
    const matches=headerNodes(headers,'span,p,div',input,card);
    const lines=matches.map(ownText).filter(value=>/[·｜|]/u.test(value));
    const values=unique(lines.map(companyText).filter(value=>value && value!==name && !value.startsWith(`${name} `) && value.length<=160));
    fieldAttempt(trace,'recruiter_company','company_role_line',matches.length,values.length);
    if (values.length===1) {company=values[0];companySource='header:company_role_line';}
  }
  return {name,company,nameSource,companySource};
}

// 只读当前输入框所在会话，返回页面实际文字；不接收待发送任务，不可能以预期值补造 observed。
export function readChatIdentity(input,trace=null) {
  const record=values=>{if(trace) Object.assign(trace,values);};
  record({inputFound:Boolean(input),conversationScope:input ? 'scope_missing' : 'input_missing',viewJobLinkCount:0,headerElementCount:0,
    headerSource:'not_found',titleSource:'not_found',recruiterSource:'not_found',recruiterCompanySource:'not_found',scopeDepth:0,
    scopeAttempts:[],scopeStopReason:input ? 'scope_missing' : 'input_missing',lastScopeDepth:0});
  if (!input?.ownerDocument || !shown(input)) {record({scopeStopReason:input ? 'input_unavailable' : 'input_missing'});return null;}
  const document=input.ownerDocument;
  let best=null,bestTrace=null;
  const scopeAttempts=[];
  let scopeStopReason='body_boundary';
  for (let root=input.parentElement,depth=0;root && root!==document.body && depth<16;root=root.parentElement,depth++) {
    const attempt={depth,rootTag:structure(root).tag,rootClass:structure(root).className,reason:'no_unique_job_link',viewJobLinkCount:0,
      cardAttempts:[],headerAttempts:[],fieldAttempts:[]};
    scopeAttempts.push(attempt);record({scopeAttempts,lastScopeDepth:depth});
    if(depth===15) scopeStopReason='depth_limit';
    if (root.querySelector(CONTACT_SEARCH) || root.matches(CONTACT_AREAS) || root.querySelector(CONTACT_AREAS)) {
      attempt.reason='contains_contact_list';attempt.contactSearchFound=Boolean(root.querySelector(CONTACT_SEARCH));
      attempt.contactAreaFound=Boolean(root.matches(CONTACT_AREAS) || root.querySelector(CONTACT_AREAS));
      scopeStopReason='contains_contact_list';
      if(!best) record({conversationScope:'contains_contact_list',scopeDepth:depth});
      break;
    }
    const candidates=query(root,'a,button,span,div').filter(element=>!unsafe(element) && VIEW_JOB.test(text(element)));
    const links=candidates.filter(element=>!candidates.some(child=>child!==element && element.contains(child)));
    attempt.viewJobLinkCount=links.length;
    record({viewJobLinkCount:links.length,scopeDepth:depth});
    if (links.length!==1) continue;
    const card=findCard(links[0],root,input,attempt);
    if (!card) {attempt.reason='card_not_found';continue;}
    attempt.cardTag=structure(card.element).tag;attempt.cardClass=structure(card.element).className;
    const headers=headerRoots(root,card.element,input,attempt);
    const recruiter=readRecruiter(headers.elements,input,card.element,attempt);
    Object.assign(attempt,{reason:'identity_incomplete',headerSource:headers.source,headerElementCount:headers.elements.length,
      headerRoots:headers.elements.slice(0,8).map(structure),titleFound:Boolean(card.title.value),recruiterFound:Boolean(recruiter.name),companyFound:Boolean(recruiter.company)});
    const actual={title:card.title.value,recruiterName:recruiter.name,recruiterCompany:recruiter.company};
    const details={conversationScope:'scoped_header',viewJobLinkCount:1,scopeDepth:depth,headerElementCount:headers.elements.length,
      headerSource:headers.source,titleSource:card.title.source,recruiterSource:recruiter.nameSource,recruiterCompanySource:recruiter.companySource};
    if (!best || Boolean(actual.recruiterName)+Boolean(actual.recruiterCompany)>Boolean(best.recruiterName)+Boolean(best.recruiterCompany)) {best=actual;bestTrace=details;}
    if (actual.title && actual.recruiterName && actual.recruiterCompany) {
      attempt.reason='identity_complete';record({...details,selectedScopeDepth:depth,scopeStopReason:'identity_complete'});return actual;
    }
  }
  if(bestTrace) record(bestTrace);
  record({scopeStopReason,...(bestTrace ? {selectedScopeDepth:bestTrace.scopeDepth} : {})});
  return best;
}
