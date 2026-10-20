import {normalizeText} from './core.js';
const visible=e=>Boolean(e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none');
const elements=(selector,root=document)=>[...root.querySelectorAll(selector)].filter(visible);
const text=(selector,root)=>normalizeText(elements(selector,root)[0]?.innerText||'');
export function chatCards(root=document) {
  const list=elements('.user-list,.chat-user-list,.conversation-list,[data-conversation-list]',root)[0];
  if(!list)return [];
  const rows=elements('.user-item,.chat-user,.conversation-item,[data-conversation-id],li',list).filter(e=>!e.parentElement.closest('.user-item,.chat-user,.conversation-item,[data-conversation-id],li')||e.parentElement.closest('.user-item,.chat-user,.conversation-item,[data-conversation-id],li')===list);
  return rows.map(element=>{
    const name=text('.name,.user-name,.boss-name,[data-recruiter-name]',element);
    const company=text('.company,.company-name,[data-company-name]',element);
    const id=element.getAttribute('data-conversation-id')||element.getAttribute('data-uid')||element.getAttribute('data-id')||'';
    const key=id?'id:'+id:name&&company?'name:'+name+'|'+company:'';
    return {element,list,key,name,company};
  }).filter(c=>c.key&&c.name&&c.company);
}
function hash(text) {let h=2166136261;for(const c of text){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(16);}
export function chatSnapshot(expected,root=document) {
  const header=elements('.chat-header,.chat-info,.chat-title,[data-chat-header]',root)[0];
  const name=header&&text('.name,.user-name,.boss-name,[data-recruiter-name]',header);
  const company=header&&text('.company,.company-name,[data-company-name]',header);
  const list=elements('.message-list,.chat-message-list,[data-message-list]',root)[0];
  const items=list?elements('.message-item,.chat-message,li[data-mid],[data-message-id],.item-myself,.item-friend',list):[];
  const unique=items.filter(item=>!items.some(other=>other!==item&&other.contains(item)));
  const outgoing=unique.filter(e=>e.matches('.item-myself,.item-self,.message-sent,.sent,[data-direction="outgoing"]'));
  const incoming=unique.filter(e=>e.matches('.item-friend,.item-other,.message-received,.received,[data-direction="incoming"]'));
  const unknown=unique.filter(e=>!outgoing.includes(e)&&!incoming.includes(e)&&!e.matches('.system,.system-message,[data-direction="system"]'));
  const empty=list&&/暂无消息|暂无聊天记录|还没有消息/u.test(list.innerText);
  const last=outgoing.at(-1);
  const receipt=last?text('.read-status,.message-status,.status,[data-read-status]',last):'';
  const readState=/未读/u.test(receipt)?'unread':/已读/u.test(receipt)?'read':'unknown';
  const identityVerified=Boolean(name&&company&&name===expected.name&&company===expected.company);
  const incomingText=incoming.map(e=>e.innerText).join(' ');
  return {key:expected.key,name:name||'',company:company||'',identityVerified,
    ourSent:outgoing.length?true:empty||(!unknown.length&&incoming.length)?false:null,
    theirReplied:incoming.length?true:list&&!unknown.length&&(outgoing.length||empty)?false:null,
    readState,refused:/不合适|不匹配|暂不考虑|请勿联系|不要再联系|停止联系|无需联系|已招满/u.test(incomingText),
    signature:hash((name||'')+'|'+(company||'')+'|'+unique.map(e=>e.innerText).join('|')),
    outgoingCount:outgoing.length,incomingCount:incoming.length};
}
export function chatEditor(root=document) {
  const inputs=elements('.chat-input textarea,.message-input textarea,[contenteditable="true"],textarea[placeholder*="消息"]',root);
  if(inputs.length!==1)return null;
  const input=inputs[0];let scope=input.parentElement,send=null;
  for(let i=0;i<6&&scope;i++,scope=scope.parentElement){
    const buttons=elements('button,a,[role="button"]',scope).filter(e=>normalizeText(e.innerText)==='发送');
    if(buttons.length===1){send=buttons[0];break;}
  }
  return send?{input,send}:null;
}
export function writeChatInput(input,value){
  if(input.matches('textarea,input')){
    const prototype=input.matches('textarea')?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype,'value').set.call(input,value);
  } else input.textContent=value;
  input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));
  input.dispatchEvent(new Event('change',{bubbles:true}));
}
export function chatInputText(input){return normalizeText(input.matches('textarea,input')?input.value:input.textContent);}
export function sentTextVisible(value,root=document){
  return elements('.message-list .item-myself,.message-list .item-self,.message-list .message-sent,[data-direction="outgoing"]',root)
    .some(e=>normalizeText(e.innerText).includes(normalizeText(value)));
}
export function chatBlocker(root=document){
  return elements('[role="dialog"],.toast,[class*="captcha"],[class*="verify"],.warning',root).map(e=>normalizeText(e.innerText))
    .find(t=>/操作频繁|安全验证|请完成验证|存在风险|账号异常|上限|请重新登录/u.test(t))||'';
}
