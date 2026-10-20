import {normalizeText} from './core.js';
export const ACTIVATION_GROUPS = {read:'已发 · 对方已读',unread:'已发 · 对方未读',replied:'对方回复过',never_sent:'尚未发送过'};
export function activationCategory(facts) {
  if(facts.ourSent===false)return 'never_sent';
  if(facts.theirReplied===true)return 'replied';
  return facts.readState==='read'?'read':facts.readState==='unread'?'unread':'unknown';
}
export function activationEligibility(facts,settings,history={},now=Date.now()) {
  const reject=reason=>({eligible:false,reason,category:activationCategory(facts)});
  if(!facts.identityVerified || !facts.key || !facts.name || !facts.company)return reject('会话身份未可靠对应，不能判断目标');
  if(facts.refused)return reject('检测到拒绝/不再联系等信号，需人工处理');
  if(facts.ourSent===null || facts.theirReplied===null)return reject('我方发送或对方回复状态未知，不猜测');
  if(settings.activationSentFilter==='sent'&&!facts.ourSent)return reject('未发现我方已发送记录，不符合“已发送”筛选');
  if(settings.activationSentFilter==='unsent'&&facts.ourSent)return reject('我方已发过消息，不符合“未发送”筛选');
  if(settings.activationReadFilter!=='all'&&facts.readState!==settings.activationReadFilter)return reject(facts.readState==='unknown'?'对方已读状态未知':'对方已读状态不符合选择');
  if(settings.activationReplyFilter==='replied'&&!facts.theirReplied)return reject('对方没有回复记录');
  if(settings.activationReplyFilter==='unreplied'&&facts.theirReplied)return reject('对方回复过，不符合“未回复”筛选');
  if(history.status==='reserved'||history.status==='uncertain')return reject('上次发送结果待人工核实，禁止自动重发');
  if(history.at&&now-new Date(history.at).getTime()<settings.activationCooldownHours*3600000)return reject('处于批量激活防重间隔内');
  if(settings.activationUseCategories&&activationCategory(facts)==='unknown')return reject('无法确定分组，不能套用分组文案');
  return {eligible:true,reason:'通过消息状态筛选',category:activationCategory(facts)};
}
export function activationText(settings,facts) {
  const text=settings.activationUseCategories?settings.activationTemplates?.[activationCategory(facts)]:settings.activationTemplate;
  if(!String(text||'').trim())throw new Error('所选分组没有激活文案');
  if(String(text).length>2000)throw new Error('激活文案不能超过2000字');
  // 激活发送用户确认的统一原文，不插入姓名，不对每位HR重新请求AI。
  return String(text).trim();
}
export function safeActivationFacts(facts={}) {
  return {key:normalizeText(facts.key).slice(0,200),name:normalizeText(facts.name).slice(0,80),company:normalizeText(facts.company).slice(0,160),
    identityVerified:facts.identityVerified===true,ourSent:typeof facts.ourSent==='boolean'?facts.ourSent:null,
    theirReplied:typeof facts.theirReplied==='boolean'?facts.theirReplied:null,readState:['read','unread'].includes(facts.readState)?facts.readState:'unknown',
    refused:facts.refused===true,signature:String(facts.signature||'').slice(0,100)};
}
