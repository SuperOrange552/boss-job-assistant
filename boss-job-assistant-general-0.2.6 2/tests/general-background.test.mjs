import test,{beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SETTINGS} from '../settings.js';
const store={};let listener,fetches=0,platformOs='mac';const requests=[],removedTabs=[];
globalThis.chrome={
 storage:{local:{async get(keys){return typeof keys==='string'?{[keys]:store[keys]}:Object.fromEntries(keys.map(k=>[k,store[k]]));},async set(values){Object.assign(store,structuredClone(values));}}},
 runtime:{getURL:p=>'chrome-extension://general/'+p,async getPlatformInfo(){return {os:platformOs};},onInstalled:{addListener(){}},onMessage:{addListener(fn){listener=fn;}}},
 tabs:{async create(options){return {id:55,...options};},async remove(id){removedTabs.push(id);}}
};
globalThis.fetch=async(url,options)=>{fetches++;requests.push(JSON.parse(options.body));return {ok:true,async json(){return {choices:[{message:{content:JSON.stringify({decision:'recommend',greeting:'您好，希望有机会进一步沟通，感谢！'})}}]};}};};
await import('../background.js');
const options={url:'chrome-extension://general/options.html'};
const jobs={url:'https://www.zhipin.com/web/geek/jobs',tab:{id:10}};
const chat={url:'https://www.zhipin.com/web/geek/chat',tab:{id:20}};
const role={title:'品牌运营专员',company:'示例品牌',location:'杭州',description:'负责社群内容策划和活动执行，分析数据并优化社区日常运营效果。',tags:[],url:'https://www.zhipin.com/job_detail/demo-role.html'};
const facts={key:'chat-a',name:'李女士',company:'示例品牌',identityVerified:true,ourSent:true,theirReplied:true,readState:'read'};
const send=(m,s=jobs)=>new Promise(resolve=>listener(m,s,resolve));
beforeEach(()=>{for(const key of Object.keys(store))delete store[key];fetches=0;requests.length=0;removedTabs.length=0;platformOs='mac';});
const start=()=>send({type:'START_AUTOMATION',greetingMode:'template',runLimit:2,sourceUrl:jobs.url,sourcePlan:{label:'品牌运营(杭州)',key:'品牌运营(杭州)'}});
const activationStart=(config={})=>send({type:'ACTIVATION_START',confirmed:true,config,candidates:[facts]},chat);

test('模板模式无Key即可启动与生成，全流程不请求模型',async()=>{
 const begun=await start();assert.equal(begun.ok,true);
 const r=await send({type:'GENERATE_GREETING',job:role});assert.equal(r.ok,true);
 assert.equal(r.mode,'template');assert.match(r.modelResult.greeting,/品牌运营专员/u);assert.equal(fetches,0);
});
test('一轮开始后锁定模板、方式、筛选和间隔，保存只影响下一轮',async()=>{
 await start();
 const old=structuredClone(store.automationSession.runConfig);
 const saved=await send({type:'SAVE_SETTINGS',settings:{greetingMode:'ai',greetingTemplate:'下一轮文案',filters:{titleExclude:'运营'},perSendRestMinSeconds:9,perSendRestMaxSeconds:11}},options);
 assert.equal(saved.ok,true);
 const current=await send({type:'GET_STATE'});assert.equal(current.settings.greetingMode,'template');assert.equal(current.settings.perSendRestMinSeconds,1);
 const greeting=await send({type:'GENERATE_GREETING',job:role,greetingMode:'ai'});assert.equal(greeting.mode,'template');assert.equal(fetches,0);
 assert.deepEqual(store.automationSession.runConfig,old);
 await send({type:'STOP_AUTOMATION'});assert.equal((await send({type:'GET_SETTINGS'})).settings.perSendRestMinSeconds,9);
});
test('AI模式要求配置；合法AI调用只使用新用户简介',async()=>{
 const missing=await send({type:'GENERATE_GREETING',greetingMode:'ai',job:role});assert.equal(missing.ok,false);assert.equal(fetches,0);
 await send({type:'SAVE_SETTINGS',settings:{apiKey:'test-api-value',model:'demo-model',candidateSummary:'我参与过社群运营',greetingMode:'ai'}},options);
 const r=await send({type:'GENERATE_GREETING',job:role});assert.equal(r.ok,true);assert.equal(fetches,1);
 assert.match(JSON.stringify(requests[0]),/我参与过社群运营/u);
 assert.doesNotMatch(JSON.stringify(requests[0]),/掌门|特定用户私有经历/u);
});
test('配置接口校验反向时间范围，拒绝时不写入',async()=>{
 const r=await send({type:'SAVE_SETTINGS',settings:{perSendRestMinSeconds:20,perSendRestMaxSeconds:3}},options);
 assert.equal(r.ok,false);assert.equal(store.settings,undefined);
});
test('岗位和批量激活互斥，不能同时开启',async()=>{
 await start();assert.equal((await activationStart()).ok,false);
 await send({type:'STOP_AUTOMATION'});assert.equal((await activationStart()).ok,true);
 assert.equal((await start()).ok,false);
});
test('激活开启可包含对方回复过的联系人，发送前记录意图，成功只记一次',async()=>{
 const begun=await activationStart();assert.equal(begun.ok,true);
 const sessionId=begun.session.id;
 const reserve=await send({type:'ACTIVATION_RESERVE',sessionId,facts},chat);assert.equal(reserve.ok,true);assert.ok(reserve.text);assert.equal(store.activationHistories[facts.key].status,'reserved');
 assert.equal(fetches,0);
 const done=await send({type:'ACTIVATION_RECORD',sessionId,key:facts.key,confirmedSent:true},chat);assert.equal(done.ok,true);
 assert.equal(store.dailyStats.successfulContacts,1);assert.equal(store.activationSession.successCount,1);
 const repeat=await send({type:'ACTIVATION_RECORD',sessionId,key:facts.key,confirmedSent:true},chat);assert.equal(repeat.ok,false);assert.equal(store.dailyStats.successfulContacts,1);
});
test('发送结果不明必须阻断并跨新轮次防重',async()=>{
 const begun=await activationStart(),sessionId=begun.session.id;
 await send({type:'ACTIVATION_RESERVE',sessionId,facts},chat);
 await send({type:'ACTIVATION_RECORD',sessionId,key:facts.key,confirmedSent:false},chat);
 assert.equal(store.activationSession.status,'blocked');assert.equal(store.activationHistories[facts.key].status,'uncertain');
 const again=await activationStart();const r=await send({type:'ACTIVATION_RESERVE',sessionId:again.session.id,facts},chat);
 assert.equal(r.blocked,true);assert.match(r.reason,/人工核实/u);
});
test('单岗位临时投递结果未知会隔离该岗位，但整轮保持运行',async()=>{
 const begun=await start();
 const prepared=await send({type:'SET_PENDING_DELIVERY',delivery:{mode:'auto',automationRunId:begun.session.id,job:role,message:'您好，希望沟通',round:1,sourceUrl:jobs.url}},jobs);
 const opened=await send({type:'OPEN_DELIVERY_WORKER'},jobs);
 const worker={url:role.url,tab:{id:opened.workerTabId}};
 await send({type:'UPDATE_PENDING_DELIVERY',deliveryId:prepared.pending.id,stage:'sending_text'},worker);
 const abandoned=await send({type:'ABANDON_PENDING_DELIVERY',deliveryId:prepared.pending.id,reason:'没有取得明确发送证据'},jobs);
 assert.equal(abandoned.ok,true);assert.equal(abandoned.uncertain,true);
 assert.equal(store.automationSession.status,'running');
 assert.equal(store.jobHistories[prepared.pending.jobKey].attempts[0].status,'uncertain');
 const check=await send({type:'CHECK_CONTACT',job:role},jobs);
 assert.equal(check.allowed,false);assert.match(check.reason,/待核对/u);
});
test('新窗口聊天页只要能核对岗位目标也可以接管，不强制要求同窗口',async()=>{
 const begun=await start();
 await send({type:'REGISTER_AUTOMATION_JOB',sessionId:begun.session.id,job:role,analysis:{decision:'recommend'},status:'queued',reason:'准备投递'});
 const prepared=await send({type:'SET_PENDING_DELIVERY',delivery:{mode:'auto',automationRunId:begun.session.id,job:role,message:'您好，希望沟通',round:1,sourceUrl:jobs.url}},jobs);
 const opened=await send({type:'OPEN_DELIVERY_WORKER'},jobs);
 const worker={url:role.url,tab:{id:opened.workerTabId,windowId:1}};
 await send({type:'UPDATE_PENDING_DELIVERY',deliveryId:prepared.pending.id,stage:'opening_chat'},worker);
 const newWindowChat={url:'https://www.zhipin.com/web/geek/chat',tab:{id:77,windowId:9}};
 const adopted=await send({type:'GET_PENDING_DELIVERY',pageText:'李女士 · 示例品牌 · 品牌运营专员'},newWindowChat);
 assert.equal(adopted.ok,true);assert.equal(adopted.isWorker,true);assert.equal(adopted.workerRole,'chat');
 assert.equal(store.pendingDelivery.chatTabId,77);
});
test('Windows自动启用前台临时标签兼容模式，避免隐藏页跳转被拦截',async()=>{
 platformOs='win';
 const begun=await start();
 const prepared=await send({type:'SET_PENDING_DELIVERY',delivery:{mode:'auto',automationRunId:begun.session.id,job:role,message:'您好，希望沟通',round:1,sourceUrl:jobs.url}},jobs);
 const opened=await send({type:'OPEN_DELIVERY_WORKER'},jobs);
 assert.equal(opened.ok,true);assert.equal(opened.pending.platformOs,'win');
 assert.equal(opened.pending.workerForeground,true);assert.equal(opened.pending.workerTabId,55);
 assert.equal(store.pendingDelivery.id,prepared.pending.id);
});
test('同一任务的继续沟通动作只登记一次，刷新或多个页面不能重复点击',async()=>{
 const begun=await start();
 const prepared=await send({type:'SET_PENDING_DELIVERY',delivery:{mode:'auto',automationRunId:begun.session.id,job:role,message:'您好，希望沟通',sourceUrl:jobs.url}});
 const opened=await send({type:'OPEN_DELIVERY_WORKER'});
 const worker={url:role.url,tab:{id:opened.workerTabId}};
 await send({type:'UPDATE_PENDING_DELIVERY',deliveryId:prepared.pending.id,stage:'opening_chat'},worker);
 const initial=await send({type:'RESERVE_COMMUNICATION_ACTION',deliveryId:prepared.pending.id,kind:'initial',buttonText:'立即沟通',path:'/job_detail/demo-role.html'},worker);
 assert.equal(initial.claimed,true);
 const request={type:'RESERVE_COMMUNICATION_ACTION',deliveryId:prepared.pending.id,kind:'continue',buttonText:'继续沟通',path:'/job_detail/demo-role.html'};
 const results=await Promise.all([send(request,worker),send(request,worker)]);
 assert.equal(results.filter(r=>r.claimed).length,1);
 assert.equal(store.pendingDelivery.stage,'continuing_chat');
 assert.deepEqual(store.pendingDelivery.communicationActions.map(a=>a.kind),['initial','continue']);
});
test('来自任务页的同岗位详情中间页可以恢复任务，其他岗位详情页不能接管',async()=>{
 const begun=await start();
 const prepared=await send({type:'SET_PENDING_DELIVERY',delivery:{mode:'auto',automationRunId:begun.session.id,job:role,message:'您好，希望沟通',sourceUrl:jobs.url}});
 const opened=await send({type:'OPEN_DELIVERY_WORKER'});
 const worker={url:role.url,tab:{id:opened.workerTabId}};
 await send({type:'UPDATE_PENDING_DELIVERY',deliveryId:prepared.pending.id,stage:'opening_chat'},worker);
 const unrelated=await send({type:'GET_PENDING_DELIVERY'}, {url:'https://www.zhipin.com/job_detail/unrelated.html',tab:{id:76,openerTabId:55}});
 assert.equal(unrelated.isWorker,false);
 const intermediate={url:role.url,tab:{id:77,openerTabId:55}};
 const adopted=await send({type:'GET_PENDING_DELIVERY'},intermediate);
 assert.equal(adopted.isWorker,true);assert.equal(adopted.workerRole,'detail');
 assert.equal(adopted.pending.intermediateTabId,77);
 assert.equal((await send({type:'GET_PENDING_DELIVERY'},worker)).delegated,true);
 await send({type:'RESERVE_COMMUNICATION_ACTION',deliveryId:prepared.pending.id,kind:'continue',buttonText:'继续沟通'},intermediate);
 const chatPage={url:'https://www.zhipin.com/web/geek/chat',tab:{id:78,openerTabId:77}};
 const chatClaim=await send({type:'GET_PENDING_DELIVERY',pageText:'示例品牌'},chatPage);
 assert.equal(chatClaim.isWorker,true);assert.equal(chatClaim.workerRole,'chat');
 assert.equal(chatClaim.pending.stage,'continuing_chat');
 await send({type:'UPDATE_PENDING_DELIVERY',deliveryId:prepared.pending.id,stage:'preparing_text'},chatPage);
 await send({type:'RESERVE_TEXT_SEND',deliveryId:prepared.pending.id},chatPage);
 const recorded=await send({type:'RECORD_SEND',deliveryId:prepared.pending.id,job:role,message:'您好，希望沟通',automationRunId:begun.session.id},chatPage);
 assert.equal(recorded.ok,true);
 assert.equal(store.deliveryOutcome.intermediateTabId,77);
 await send({type:'CLOSE_DELIVERY_WORKER',deliveryId:prepared.pending.id},chatPage);
 await new Promise(resolve=>setTimeout(resolve,70));
 assert.deepEqual([...new Set(removedTabs)].sort(),[55,77,78]);
 assert.ok(!removedTabs.includes(10));
});
test('发送请求原子登记：两个任务页面同时请求时只有一个获准发送',async()=>{
 const begun=await start();
 const prepared=await send({type:'SET_PENDING_DELIVERY',delivery:{mode:'auto',automationRunId:begun.session.id,job:role,message:'您好，希望沟通',sourceUrl:jobs.url}});
 const opened=await send({type:'OPEN_DELIVERY_WORKER'});
 const worker={url:role.url,tab:{id:opened.workerTabId}};
 await send({type:'UPDATE_PENDING_DELIVERY',deliveryId:prepared.pending.id,stage:'opening_chat'},worker);
 const second={url:'https://www.zhipin.com/web/geek/chat',tab:{id:77,openerTabId:55}};
 await send({type:'GET_PENDING_DELIVERY',pageText:'示例品牌'},second);
 await send({type:'UPDATE_PENDING_DELIVERY',deliveryId:prepared.pending.id,stage:'preparing_text'},second);
 const request={type:'RESERVE_TEXT_SEND',deliveryId:prepared.pending.id};
 const results=await Promise.all([send(request,worker),send(request,second)]);
 assert.equal(results.filter(r=>r.claimed).length,1);
 assert.equal(store.pendingDelivery.stage,'sending_text');assert.ok(store.pendingDelivery.textSendRequestedAt);
 const rollback=await send({type:'UPDATE_PENDING_DELIVERY',deliveryId:prepared.pending.id,stage:'preparing_text'},second);
 assert.equal(rollback.ok,false);
});
test('只填入草稿但发送按钮未就绪时失败，不登记已沟通或结果不明',async()=>{
 const begun=await start();
 const prepared=await send({type:'SET_PENDING_DELIVERY',delivery:{mode:'auto',automationRunId:begun.session.id,job:role,message:'您好，希望沟通',sourceUrl:jobs.url}});
 const opened=await send({type:'OPEN_DELIVERY_WORKER'});
 const worker={url:role.url,tab:{id:opened.workerTabId}};
 await send({type:'UPDATE_PENDING_DELIVERY',deliveryId:prepared.pending.id,stage:'preparing_text'},worker);
 const failed=await send({type:'FAIL_PENDING_DELIVERY',deliveryId:prepared.pending.id,reason:'发送按钮未就绪'},worker);
 assert.equal(failed.outcome.status,'failed');assert.equal(store.jobHistories?.[prepared.pending.jobKey],undefined);
 assert.equal(store.automationSession.status,'running');
});
test('临时页单岗位失败返回结果并继续整轮；疑似已建立沟通时写入待核对防重',async()=>{
 const begun=await start();
 await send({type:'REGISTER_AUTOMATION_JOB',sessionId:begun.session.id,job:role,analysis:{decision:'recommend'},status:'queued',reason:'准备投递'});
 const prepared=await send({type:'SET_PENDING_DELIVERY',delivery:{mode:'auto',automationRunId:begun.session.id,job:role,message:'您好，希望沟通',round:1,sourceUrl:jobs.url}},jobs);
 const opened=await send({type:'OPEN_DELIVERY_WORKER'},jobs);
 const worker={url:role.url,tab:{id:opened.workerTabId,windowId:1}};
 await send({type:'UPDATE_PENDING_DELIVERY',deliveryId:prepared.pending.id,stage:'opening_chat'},worker);
 const failed=await send({type:'FAIL_PENDING_DELIVERY',deliveryId:prepared.pending.id,reason:'按钮变为继续沟通但没有输入框',uncertain:true},worker);
 assert.equal(failed.ok,true);assert.equal(failed.outcome.status,'uncertain');
 assert.equal(store.pendingDelivery,null);assert.equal(store.deliveryOutcome.status,'uncertain');
 assert.equal(store.automationSession.status,'running');
 assert.equal(store.automationSession.candidates[0].status,'read_error');
 assert.equal(store.jobHistories[prepared.pending.jobKey].attempts[0].status,'uncertain');
});
test('上一条发送未确认时不能同时发送下一位联系人',async()=>{
 const second={...facts,key:'chat-b',name:'张先生'};
 const begun=await send({type:'ACTIVATION_START',confirmed:true,config:{},candidates:[facts,second]},chat);
 const sessionId=begun.session.id;
 assert.equal((await send({type:'ACTIVATION_RESERVE',sessionId,facts},chat)).ok,true);
 const blocked=await send({type:'ACTIVATION_RESERVE',sessionId,facts:second},chat);
 assert.equal(blocked.ok,false);assert.match(blocked.error,/上一条消息仍待确认/u);
 assert.equal(store.activationHistories[second.key],undefined);
});
test('统一AI激活只生成一次，不上传聊天正文，不按联系人调用',async()=>{
 await send({type:'SAVE_SETTINGS',settings:{apiKey:'test-api-value',model:'demo-model'}},options);
 const r=await send({type:'ACTIVATION_GENERATE',useCategories:false},chat);
 assert.equal(r.ok,true);assert.equal(fetches,1);assert.ok(r.texts.common);
 assert.doesNotMatch(JSON.stringify(requests),/李女士|示例品牌/u);
 const grouped=await send({type:'ACTIVATION_GENERATE',useCategories:true},chat);assert.equal(grouped.ok,true);assert.equal(fetches,5);
});
test('非消息页不能开启激活，其他标签页不能确认发送',async()=>{
 assert.equal((await send({type:'ACTIVATION_SETUP'},jobs)).ok,false);
 const begun=await activationStart();assert.equal((await send({type:'ACTIVATION_RESERVE',sessionId:begun.session.id,facts},{...chat,tab:{id:99}})).ok,false);
});
test('公用状态和运行快照不会暴露API Key或个人总结',async()=>{
 await send({type:'SAVE_SETTINGS',settings:{apiKey:'test-api-value',candidateSummary:'private-profile'}},options);
 await start();
 for(const type of ['GET_SETTINGS','GET_STATE','GET_AUTOMATION']){
  const result=await send({type});assert.doesNotMatch(JSON.stringify(result),/test-api-value|private-profile/u);
 }
});
test('前台仅能保存方式与模板，不可改动后台参数或读取简介密钥',async()=>{
 await send({type:'SAVE_SETTINGS',settings:{apiKey:'private-key',candidateSummary:'private-candidate'}},options);
 const saved=await send({type:'SAVE_GREETING_PREFERENCES',greetingMode:'template',greetingTemplate:'{称呼}，期待沟通{岗位}。',apiKey:'overwritten',dailyLimit:1});
 assert.equal(saved.ok,true);assert.equal(store.settings.apiKey,'private-key');assert.equal(store.settings.dailyLimit,500);
 const prefs=await send({type:'GET_GREETING_PREFERENCES'});
 assert.equal(prefs.preferences.greetingTemplate,'{称呼}，期待沟通{岗位}。');
 assert.doesNotMatch(JSON.stringify(prefs),/private-key|private-candidate/u);
 assert.equal((await send({type:'SAVE_GREETING_PREFERENCES',greetingMode:'template',greetingTemplate:'文字'},{url:'https://example.com'})).ok,false);
});
test('保存后台配置不覆盖前台模板，启动快照使用前台内容并锁定',async()=>{
 await send({type:'SAVE_GREETING_PREFERENCES',greetingMode:'template',greetingTemplate:'前台模板：{岗位}'});
 await send({type:'SAVE_SETTINGS',settings:{greetingRules:'新的后台要求',greetingMaxChars:120,filters:{titleInclude:'运营'}}},options);
 assert.equal(store.settings.greetingTemplate,'前台模板：{岗位}');
 await start();
 assert.equal((await send({type:'GENERATE_GREETING',job:role,greetingTemplate:'运行中不应换用'})).modelResult.greeting,'前台模板：品牌运营专员');
 assert.equal((await send({type:'SAVE_GREETING_PREFERENCES',greetingMode:'template',greetingTemplate:'其他'})).ok,false);
});
test('后台字数上限作用于模板替换结果和AI，不直接截断消息',async()=>{
 await send({type:'SAVE_SETTINGS',settings:{greetingMaxChars:20}},options);
 const result=await send({type:'GENERATE_GREETING',job:role,greetingMode:'template',greetingTemplate:'这是一段明显超过二十个字符的模板问候文字，请问有机会沟通吗？'});
 assert.equal(result.ok,false);assert.match(result.error,/20字上限/u);assert.equal(fetches,0);
 await send({type:'SAVE_SETTINGS',settings:{apiKey:'test-api-value',model:'demo-model',candidateSummary:'社区运营',greetingMaxChars:120}},options);
 await send({type:'GENERATE_GREETING',job:role,greetingMode:'ai'});
 assert.match(JSON.stringify(requests[0]),/greetingMaxChars/u);
});
test('临时页失败由工作标签页记录并继续，不再从临时页停止整轮',async()=>{
 const source=await import('node:fs/promises').then(fs=>fs.readFile(new URL('../content.js',import.meta.url),'utf8'));
 assert.match(source,/FAIL_PENDING_DELIVERY/u);
 assert.match(source,/chatReadyTimeoutSeconds/u);
 assert.match(source,/communicationTargetUrl/u);
 assert.match(source,/location\.assign\(targetUrl\)/u);
 assert.doesNotMatch(source,/pending\.pending\.mode === "auto"\) await sendRuntimeMessage\(\{ type: "STOP_AUTOMATION"/u);
});
