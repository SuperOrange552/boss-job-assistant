// Regression baseline only: loaded BOSS extension 0.4.11 shared/chat.js.
// SHA-256 of the original loaded module: e925a2bfc0c136a69a4096579e487b254f570f97127303ad0275afe47199ef5a
// Original import/export wrappers removed; test harness provides normalizeText.
// Do not load this old reader in the extension or update it with production fixes.

const MESSAGE_AREAS = '.message-list,.message-content,.message-item,.chat-message-list,.chat-record,.chat-record-list,.chat-history,.message-history,[data-message-list],[data-message],.item-myself,.item-friend,[role="log"]';
const CONTACT_AREAS = '.contact-list,.user-list,.friend-list,[data-conversation-list]';
const CONTACT_SEARCH = 'input[placeholder*="联系人"],input[placeholder*="搜索联系"]';
const HEADER_AREAS = '[data-chat-header],.chat-header,.chat-title,.chat-head,.chat-top,.conversation-header,.conversation-title,.im-title,.boss-info';
const TITLE_FIELDS = ['[data-job-title]','.job-name','.job-title','.position-name','.position-title','a[href*="/job_detail/"]','h1,h2,h3,strong,b'];
const NAME_FIELDS = ['[data-recruiter-name]','.boss-name','.recruiter-name','.user-name','.name','.name-box'];
const COMPANY_FIELDS = ['[data-recruiter-company]','.recruiter-company','.boss-company','.company-name','.company','.company-info'];
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

function readTitle(card,link) {
  const valid=element=>element!==link && !element.contains(link) && !link.contains(element) && !unsafe(element);
  for (const selector of TITLE_FIELDS) {
    const candidates=unique(query(card,selector).filter(valid).map(titleText).filter(value=>value.length<=160 && !VIEW_JOB.test(value)));
    if (candidates.length===1) return {value:candidates[0],source:`job_card:${selector}`};
    if (candidates.length>1) return {value:'',source:'job_card:ambiguous_title'};
  }
  // 未知类名仅允许局部卡片内唯一的岗位标题文本，不扫描整个会话寻找任务中的预期词。
  const candidates=unique(leaves(card).filter(valid).map(text).filter(value=>value.length<=120
    && /测试|工程师|开发|\b(?:QA|SDET)\b/iu.test(value) && !/[。；\n]/u.test(value)));
  return candidates.length===1 ? {value:candidates[0],source:'job_card:unique_local_title'} : {value:'',source:'job_card:title_missing'};
}

function findCard(link,root,input) {
  let candidate=link.parentElement;
  for (let depth=0;candidate && candidate!==root && depth<7;depth++,candidate=candidate.parentElement) {
    if (candidate.contains(input) || unsafe(candidate)) break;
    const title=readTitle(candidate,link);
    if (title.value) return {element:candidate,title};
  }
  return null;
}

function headerRoots(root,card,input) {
  const cardRect=card.getBoundingClientRect();
  const semantic=query(root,HEADER_AREAS).filter(element=>usable(element,input,card)
    && element.getBoundingClientRect().top<=cardRect.bottom+4);
  if (semantic.length) return {elements:semantic,source:'semantic_chat_header'};
  // 允许 HR 抬头在岗位卡片外层：沿卡片祖先找位于卡片之前的兄弟区块。
  // 只读卡片上方的小区块，排除聊天记录、联系人区、输入区，不使用链接文字的高度裁切父容器。
  const structural=[];
  let branch=card;
  while (branch && branch!==root) {
    for (let sibling=branch.previousElementSibling;sibling;sibling=sibling.previousElementSibling) {
      if (!shown(sibling) || !usable(sibling,input,card) || sibling.querySelector(`${MESSAGE_AREAS},${CONTACT_AREAS},${CONTACT_SEARCH}`)) continue;
      const rect=sibling.getBoundingClientRect();
      if (rect.bottom<=cardRect.top+4 && text(sibling).length<=300) structural.push(sibling);
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

function readRecruiter(headers,input,card) {
  const nameLike=value=>value && value.length<=24 && !/[|｜·，。:：]/u.test(value) && (!/\s/u.test(value) || /^[A-Za-z][A-Za-z .'-]+$/u.test(value))
    && !/公司|工程师|经理|主管|总监|招聘|人事|更多|查看职位|在线|活跃|上海/u.test(value);
  let name='',nameSource='header:name_missing';
  for (const selector of NAME_FIELDS) {
    const values=unique(headerNodes(headers,selector,input,card).map(element=>ownText(element) || text(element)).filter(nameLike));
    if (values.length>1) return {name:'',company:'',nameSource:'header:ambiguous_name',companySource:'header:unresolved'};
    if (values.length===1) {name=values[0];nameSource=`header:${selector}`;break;}
  }
  if (!name) {
    const candidates=headerNodes(headers,'strong,b,h1,h2,h3',input,card).map(text).filter(nameLike);
    if (unique(candidates).length===1) {name=candidates[0];nameSource='header:unique_heading_name';}
  }
  if (!name) {
    const candidates=unique(headers.map(ownText).filter(nameLike));
    if(candidates.length===1) {name=candidates[0];nameSource='header:direct_name';}
  }
  let company='',companySource='header:company_missing';
  const companyText=value=>normalizeText(value.split(/[·｜|]/u)[0]);
  for (const selector of COMPANY_FIELDS) {
    const values=unique(headerNodes(headers,selector,input,card).map(text).map(companyText).filter(value=>value && value!==name && value.length<=160));
    if (values.length>1) return {name,company:'',nameSource,companySource:'header:ambiguous_company'};
    if (values.length===1) {company=values[0];companySource=`header:${selector}`;break;}
  }
  if (!company) {
    const lines=headerNodes(headers,'span,p,div',input,card).map(ownText).filter(value=>/[·｜|]/u.test(value));
    const values=unique(lines.map(companyText).filter(value=>value && value!==name && !value.startsWith(`${name} `) && value.length<=160));
    if (values.length===1) {company=values[0];companySource='header:company_role_line';}
  }
  return {name,company,nameSource,companySource};
}

// 只读当前输入框所在会话，返回页面实际文字；不接收待发送任务，不可能以预期值补造 observed。
function readChatIdentity(input,trace=null) {
  const record=values=>{if(trace) Object.assign(trace,values);};
  record({inputFound:Boolean(input),conversationScope:input ? 'scope_missing' : 'input_missing',viewJobLinkCount:0,headerElementCount:0,
    headerSource:'not_found',titleSource:'not_found',recruiterSource:'not_found',recruiterCompanySource:'not_found',scopeDepth:0});
  if (!input?.ownerDocument || !shown(input)) return null;
  const document=input.ownerDocument;
  let best=null,bestTrace=null;
  for (let root=input.parentElement,depth=0;root && root!==document.body && depth<16;root=root.parentElement,depth++) {
    if (root.querySelector(CONTACT_SEARCH) || root.matches(CONTACT_AREAS) || root.querySelector(CONTACT_AREAS)) {
      if(!best) record({conversationScope:'contains_contact_list',scopeDepth:depth});
      break;
    }
    const candidates=query(root,'a,button,span,div').filter(element=>!unsafe(element) && VIEW_JOB.test(text(element)));
    const links=candidates.filter(element=>!candidates.some(child=>child!==element && element.contains(child)));
    record({viewJobLinkCount:links.length,scopeDepth:depth});
    if (links.length!==1) continue;
    const card=findCard(links[0],root,input);
    if (!card) continue;
    const headers=headerRoots(root,card.element,input);
    const recruiter=readRecruiter(headers.elements,input,card.element);
    const actual={title:card.title.value,recruiterName:recruiter.name,recruiterCompany:recruiter.company};
    const details={conversationScope:'scoped_header',viewJobLinkCount:1,scopeDepth:depth,headerElementCount:headers.elements.length,
      headerSource:headers.source,titleSource:card.title.source,recruiterSource:recruiter.nameSource,recruiterCompanySource:recruiter.companySource};
    if (!best || Boolean(actual.recruiterName)+Boolean(actual.recruiterCompany)>Boolean(best.recruiterName)+Boolean(best.recruiterCompany)) {best=actual;bestTrace=details;}
    if (actual.title && actual.recruiterName && actual.recruiterCompany) {record(details);return actual;}
  }
  if(bestTrace) record(bestTrace);
  return best;
}
