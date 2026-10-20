import {validateSettings} from './shared/config.js';
import {activationEligibility,activationText,safeActivationFacts,ACTIVATION_GROUPS} from './shared/activation.js';
import {parseModelResult,randomRestSeconds} from './shared/core.js';

export function createActivationHandler({getSettings,getState,getAutomationSession,callConfiguredModel,recordDiagnostic,publicSettings}) {
  let serial=Promise.resolve();
  const read=async key=>(await chrome.storage.local.get(key))[key];
  const safe=session=>session?{...session,runConfig:undefined}:null;
  async function handle(m,sender) {
    if(!Number.isInteger(sender?.tab?.id)||!/^https:\/\/www\.zhipin\.com\/web\/geek\/(chat|message|im)(?:[/?#]|$)/u.test(sender?.url||''))throw new Error('批量激活仅能在BOSS消息页操作');
    let session=await read('activationSession');
    const settings=await getSettings();
    const owner=()=>{if(!session||session.status!=='running'||session.id!==m.sessionId||session.ownerTabId!==sender.tab.id)throw new Error('当前页面没有对应的激活任务');};
    if(m.type==='ACTIVATION_SETUP')return {ok:true,settings:{...publicSettings(settings),activationTemplate:settings.activationTemplate,activationTemplates:settings.activationTemplates},session:safe(session),histories:await read('activationHistories')||{}};
    if(m.type==='ACTIVATION_GENERATE') {
      if(session?.status==='running')throw new Error('运行中不能重新生成激活话术');
      const groups=m.useCategories?Object.keys(ACTIVATION_GROUPS):['common'],texts={};
      for(const group of groups) {
        const body=await callConfiguredModel(settings,{purpose:'activation',activationRules:settings.activationRules,conversationGroup:ACTIVATION_GROUPS[group]||'通用跟进'});
        const text=parseModelResult(body.result).greeting;
        if(!text||text.length>2000)throw new Error('AI返回的激活话术为空或过长');
        texts[group]=text;
      }
      return {ok:true,texts};
    }
    if(m.type==='ACTIVATION_START') {
      if(session?.status==='running'||(await getAutomationSession())?.status==='running')throw new Error('已有投递或激活任务运行，请先停止');
      if(m.confirmed!==true)throw new Error('请先预览并确认本批文案与联系人');
      const allowed=['activationReadFilter','activationReplyFilter','activationSentFilter','activationMode','activationTemplate','activationTemplates','activationUseCategories','activationRunLimit'];
      const overrides=Object.fromEntries(allowed.filter(k=>k in (m.config||{})).map(k=>[k,m.config[k]]));
      const cfg=validateSettings({...settings,...overrides});
      const candidates=(m.candidates||[]).map(safeActivationFacts);
      if(!candidates.length||candidates.length>100||new Set(candidates.map(c=>c.key)).size!==candidates.length)throw new Error('联系人为空、重复或超出100条');
      for(const c of candidates)activationText(cfg,c);
      const {apiKey,...runConfig}=cfg;
      session={id:'activation-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),status:'running',ownerTabId:sender.tab.id,
        runConfig,candidates,successCount:0,processed:[],createdAt:new Date().toISOString(),reason:'用户确认开始'};
      await chrome.storage.local.set({activationSession:session});
      return {ok:true,session:safe(session)};
    }
    if(m.type==='ACTIVATION_STOP') {
      if(session){session.status='stopped';session.reason=String(m.reason||'用户停止').slice(0,300);await chrome.storage.local.set({activationSession:session});}
      return {ok:true,session:safe(session)};
    }
    owner();
    if(m.type==='ACTIVATION_RESERVE') {
      const facts=safeActivationFacts(m.facts),expected=session.candidates.find(c=>c.key===facts.key);
      if(!expected||expected.name!==facts.name||expected.company!==facts.company)throw new Error('会话与确认名单不一致');
      if(session.processed.includes(facts.key))throw new Error('本轮已经处理此会话');
      if(session.successCount>=session.runConfig.activationRunLimit)throw new Error('已达本轮激活上限');
      const state=await getState();
      if(state.cooldownUntil>Date.now())return {ok:true,waitingUntil:state.cooldownUntil};
      if(state.dailyStats.successfulContacts>=session.runConfig.dailyLimit)throw new Error('今日发送已达上限');
      const histories=await read('activationHistories')||{};
      if(Object.values(histories).some(entry=>entry.runId===session.id&&entry.status==='reserved'&&entry!==histories[facts.key]))throw new Error('上一条消息仍待确认，不能开始另一条发送');
      const check=activationEligibility(facts,session.runConfig,histories[facts.key]);
      if(!check.eligible)return {ok:true,blocked:true,reason:check.reason};
      histories[facts.key]={status:'reserved',at:new Date().toISOString(),runId:session.id,name:facts.name,company:facts.company};
      await chrome.storage.local.set({activationHistories:histories});
      return {ok:true,text:activationText(session.runConfig,facts)};
    }
    if(m.type==='ACTIVATION_RECORD') {
      const histories=await read('activationHistories')||{},entry=histories[m.key];
      if(!entry||entry.runId!==session.id||entry.status!=='reserved')throw new Error('没有对应发送意图，不能重复记账');
      entry.status=m.confirmedSent===true?'sent':'uncertain';
      entry.at=new Date().toISOString();
      session.processed.push(m.key);
      let cooldownUntil=0;
      if(m.confirmedSent===true){
        session.successCount++;
        const state=await getState();state.dailyStats.successfulContacts++;
        const s=session.runConfig;
        const seconds=randomRestSeconds({restMinSeconds:s.perSendRestMinSeconds,restMaxSeconds:s.perSendRestMaxSeconds})
          +(session.successCount%s.batchSize===0?randomRestSeconds(s):0);
        cooldownUntil=Date.now()+seconds*1000;
        await chrome.storage.local.set({dailyStats:state.dailyStats,cooldownUntil});
        if(session.successCount>=s.activationRunLimit){session.status='completed';session.reason='达到本轮激活上限';}
      } else {session.status='blocked';session.reason='发送结果不明确，请人工检查，不会自动重发';}
      await chrome.storage.local.set({activationSession:session,activationHistories:histories});
      await recordDiagnostic({runId:session.id,stage:'消息批量激活',result:entry.status,reason:session.reason||'文字已取得发送证据',job:{company:entry.company,title:entry.name}});
      return {ok:true,session:safe(session),cooldownUntil};
    }
    throw new Error('未知激活操作');
  }
  return (m,sender)=>{
    const result=serial.then(()=>handle(m,sender));
    serial=result.catch(()=>{});
    return result;
  };
}
