import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {checkSkipKeywords,analyzeJob,precheckExplicitTitle,precheckAgency,precheckTechCompany,stableJobKey,checkHrActivity} from '../shared/core.js';
import {detailFingerprint} from '../shared/page.js';

// 实际 runLoop + 实际后台队列/历史/回执；只在进程内模拟 DOM、模型和 Chrome 边界。
// 不启动浏览器，不调用任何真实模型/招聘者。
const store = {}, removed = [];
let listener, nextTab = 101, failCreate = false;
globalThis.chrome = {
  storage:{local:{async get(keys){const data=typeof keys==='string' ? {[keys]:store[keys]} : Array.isArray(keys) ? Object.fromEntries(keys.map(k=>[k,store[k]])) : store;return structuredClone(data);},async set(data){Object.assign(store,structuredClone(data));}}},
  tabs:{async create(options){if(failCreate) throw new Error('创建临时页失败');return {id:nextTab++,windowId:1,...options};},async remove(id){removed.push(id);}},
  runtime:{getManifest:()=>({version:'0.4.14-test'}),getURL:p=>`chrome-extension://test/${p}`,onInstalled:{addListener(){}},onMessage:{addListener(fn){listener=fn;}}}
};
await import('../background.js?job-continuation-regression');
const source = {url:'https://www.zhipin.com/web/geek/jobs',documentId:'source-document',frameId:0,tab:{id:11,windowId:1}};
const send = (message,sender=source)=>new Promise(resolve=>listener(message,sender,resolve));
const content = await readFile(new URL('../content.js',import.meta.url),'utf8');
const logCode = content.slice(content.indexOf('  async function logEvent('),content.indexOf('  async function readDiagnostics('));
const loopCode = content.slice(content.indexOf('  async function registerJob('),content.indexOf('  async function startRun('));
const waitCode = content.slice(content.indexOf('  async function waitForWorkerOutcome('),content.indexOf('  async function openDelivery('));
const openCode = content.slice(content.indexOf('  async function openDelivery('),content.indexOf('  async function selectAndWait('));
function makeJob(id) {return {title:'软件测试工程师',company:`公司-${id}`,listingCompany:`公司-${id}`,location:'上海',recruiterName:'王女士',
  description:'负责Web和App软件业务功能测试、接口测试、缺陷跟踪以及上线回归。',activityText:'在线',buttonText:'立即沟通',url:`https://www.zhipin.com/job_detail/${id}.html`};}
async function begin(limit=2,hrActivityFilter='within3days') {
  const result=await send({type:'START_AUTOMATION',sourceUrl:source.url,sourcePlan:{label:'测试工程师（上海）',key:'testing'},runLimit:limit,hrActivityFilter});
  assert.equal(result.ok,true);return result.session;
}
function reset(){for(const key of Object.keys(store)) delete store[key];removed.length=0;failCreate=false;}
async function prepare(job=makeJob('one'),stage='opening_chat') {
  const run=await begin();
  await send({type:'REGISTER_AUTOMATION_JOB',sessionId:run.id,job,status:'queued',analysis:{decision:'recommend'}});
  const saved=await send({type:'SET_PENDING_DELIVERY',delivery:{mode:'auto',automationRunId:run.id,job,message:'仅内存测试',sourceUrl:source.url}});
  assert.equal(saved.ok,true);
  const opened=await send({type:'OPEN_DELIVERY_WORKER'});assert.equal(opened.ok,true);
  const sender={url:job.url,frameId:0,tab:{id:opened.workerTabId,windowId:1}};
  await send({type:'UPDATE_PENDING_DELIVERY',deliveryId:saved.pending.id,stage},sender);
  return {run,job,pending:store.pendingDelivery,sender};
}
const report=(f,sender=f.sender)=>send({type:'FAIL_AUTOMATION_JOB',sessionId:f.run.id,job:f.job,deliveryId:f.pending.id,
  reason:'[conversation_identity_timeout] 聊天抬头没有完整加载',code:'conversation_identity_timeout'},sender);

async function simulate(ids,limit=2,{recordFailure=false,realOpen=false,hrActivityFilter='within3days',activities={},jobOverrides={},cardOverrides={}}={}) {
  reset();await begin(limit,hrActivityFilter);
  const cards=ids.map(id=>({jobKey:id,title:id==='car' ? '车载测试工程师' : '软件测试工程师',company:`公司-${id}`,href:makeJob(id).url,location:'上海',tags:[],...cardOverrides[id]}));
  const selected=[],modelJobs=[],deliveries=[],stops=[],requests=[],notices=[];
  let currentJob=null, clock=1000;
  const context={state:{engineBusy:false,stopRequested:false},location:{pathname:'/web/geek/jobs'},Date:{now:()=>clock},
    checkSkipKeywords,precheckExplicitTitle,precheckAgency,precheckTechCompany,analyzeJob,stableJobKey,detailFingerprint,checkHrActivity,label:value=>value,
    sourceDocumentToken:'source-token',$:()=>({value:'仅内存测试'}),
    DELIVERY_TIMEOUTS:{detail:30000,chat:60000,sendReady:15000,sendEvidence:15000,workerOutcome:240000},
    render(){},setNotice(message){notices.push(message);},async sleep(ms){clock+=ms;},async waitSourceVisible(){},async waitCooldown(){store.cooldownUntil=0;},async loadState(){},applyContactMarkers(){},
    blockerText:()=>'',messageInput:()=>null,
    async nextCard(run){const card=cards.find(c=>!run.seenJobKeys.includes(c.jobKey));if(selected.length>ids.length+2) throw new Error('反复处理同一岗位');return card;},
    async selectAndWait(card){selected.push(card.jobKey);currentJob=makeJob(card.jobKey);
      Object.assign(currentJob,jobOverrides[card.jobKey]);
      if(Object.hasOwn(activities,card.jobKey)) currentJob.activityText=activities[card.jobKey];
      if(card.jobKey==='read') throw new Error('[detail_timeout] 详情字段没有完整加载');
      if(card.jobKey==='platform') throw new Error('[platform_blocked] 页面出现安全验证');
      if(card.jobKey==='hardware') currentJob.description='负责伺服驱动器硬件测试、电气电路调试及示波器测试。';
      return currentJob;},
    extractCurrentJob(){return stableJobKey(currentJob)==='changed' ? makeJob('unexpected') : currentJob;},
    async generateGreeting(){const id=stableJobKey(currentJob);modelJobs.push(id);
      if(id==='model') throw new Error('模型接口请求超时');
      return id==='model_skip' ? {blocked:true,reason:'本地筛选：模型请求前资格已变化'} : {decision:id==='legacy_exclude' ? 'exclude' : 'recommend',reason:'测试话术'};},
    async sendRuntimeMessage(message){requests.push(message);
      if(recordFailure && message.type==='FAIL_AUTOMATION_JOB') return {ok:false,error:'存储写入失败'};
      if(message.type==='GET_STATE') return {ok:true,cooldownUntil:0};
      if(message.type==='CHECK_CONTACT' && stableJobKey(message.job)==='hold') return {ok:true,allowed:false,reason:'同公司短时沟通防重'};
      if(realOpen && message.type==='OPEN_DELIVERY_WORKER') {
        const job=currentJob,id=stableJobKey(job);deliveries.push(id);failCreate=id==='create';
        const opened=await send(message);failCreate=false;
        if(!opened.ok) return opened;
        const sender={url:job.url,frameId:0,tab:{id:opened.workerTabId,windowId:1}};
        if(['worker','unknown','timeout'].includes(id)) {
          await send({type:'UPDATE_PENDING_DELIVERY',deliveryId:opened.pending.id,stage:id==='worker' ? 'opening_chat' : 'sending_text'},sender);
          if(id!=='timeout') await send({type:'FAIL_AUTOMATION_JOB',sessionId:opened.pending.automationRunId,job,deliveryId:opened.pending.id,reason:`${id} 测试失败`},sender);
        } else await send({type:'RECORD_SEND',automationRunId:opened.pending.automationRunId,deliveryId:opened.pending.id,job,message:'仅内存测试',resumeImageStatus:id==='image' ? 'failed' : 'sent'},sender);
        return opened;
      }
      return send(message);},
    async openDelivery(mode,runId){
      const job=currentJob,id=stableJobKey(job);deliveries.push(id);
      const saved=await send({type:'SET_PENDING_DELIVERY',delivery:{mode,automationRunId:runId,job,message:'仅内存测试',sourceUrl:source.url}});assert.equal(saved.ok,true);
      failCreate=id==='create';
      const opened=await send({type:'OPEN_DELIVERY_WORKER'});failCreate=false;
      if(!opened.ok) throw new Error(opened.error);
      const sender={url:job.url,frameId:0,tab:{id:opened.workerTabId,windowId:1}};
      if(['worker','unknown','timeout'].includes(id)) {
        await send({type:'UPDATE_PENDING_DELIVERY',deliveryId:saved.pending.id,stage:id==='worker' ? 'opening_chat' : 'sending_text'},sender);
        if(id!=='timeout') await send({type:'FAIL_AUTOMATION_JOB',sessionId:runId,job,deliveryId:saved.pending.id,reason:`${id} 测试失败`},sender);
        return context.waitForWorkerOutcome(opened.pending,id==='timeout' ? 2000 : 120000);
      }
      await send({type:'RECORD_SEND',automationRunId:runId,deliveryId:saved.pending.id,job,message:'仅内存测试',resumeImageStatus:id==='image' ? 'failed' : 'sent'},sender);
      return context.waitForWorkerOutcome(opened.pending);
    },
    async stopRun(reason){stops.push(reason);await send({type:'STOP_AUTOMATION',sessionId:store.automationSession.id,status:'blocked',reason});}
  };
  vm.createContext(context);vm.runInContext(`${logCode}\n${loopCode}\n${waitCode}\n${realOpen ? openCode : ''}`,context);
  await context.runLoop();
  return {run:store.automationSession,publicRun:(await send({type:'GET_AUTOMATION'})).publicSession,selected,modelJobs,deliveries,stops,requests,notices};
}

test('大中厂名单/匿名标注/详情主体连续跳过后仍完成普通岗位，跳过不计成功或沟通历史',async()=>{
  const cardOverrides={named:{company:'上海米哈游网络科技股份有限公司'},anonymous:{company:'某互联网中厂'},
    titled:{title:'游戏测试工程师（大厂）'}};
  const jobOverrides={detail:{recruiterCompany:'腾讯科技（上海）有限公司'}};
  const r=await simulate(['named','anonymous','titled','detail','good','after'],1,{realOpen:true,cardOverrides,jobOverrides});
  assert.deepEqual(r.stops,[]);assert.equal(r.run.status,'completed');assert.equal(r.run.successCount,1);
  assert.equal(r.run.scannedCount,5);assert.equal(r.publicRun.skippedCount,4);
  assert.deepEqual(r.selected,['detail','good']);assert.deepEqual(r.modelJobs,['good']);assert.deepEqual(r.deliveries,['good']);
  assert.equal(store.dailyStats.successfulContacts,1);
  for(const id of ['named','anonymous','titled','detail']) {
    const row=r.publicRun.results.find(row=>row.jobKey===id);
    assert.equal(row.category,'filtered');assert.match(row.reason,/留给手动投递/);
    assert.equal(store.jobHistories[id],undefined);
    const log=store.diagnosticEvents.find(e=>e.jobKey===id && e.details?.code==='tech_company_manual_only');
    assert.equal(log.details.modelCalled,false);assert.equal(log.details.continuation,'next_job');
    assert.ok(log.company && log.title);
  }
});

test('本轮5条日志场景加普通软件：本地筛选后只对普通软件生成和投递，异常不会停整轮',async()=>{
  const jobOverrides={
    production:{title:'生产测试工程师',company:'上海华岭',listingCompany:'上海华岭',description:'生产测试支持和测试工艺导入，电子工程专业，半导体经验，APQP PPAP。'},
    retail:{title:'电子产品和奢侈品店铺负责人工程师',company:'爱回收',listingCompany:'爱回收',description:'二手商品回收测试评估，分类整理包装和门店回收服务。'}
  };
  const cardOverrides={embedded:{title:'嵌入式测试工程师（智驾底软/ADAS方向）'},game_headhunter:{title:'游戏测试工程师',agencyHint:true},
    hardware_vendor:{title:'硬件测试开发工程师',company:'微创软件'}};
  const r=await simulate(['production','embedded','game_headhunter','hardware_vendor','retail','legacy_exclude','after'],1,{realOpen:true,jobOverrides,cardOverrides});
  assert.deepEqual(r.stops,[]);assert.equal(r.run.status,'completed');assert.equal(r.run.successCount,1);assert.equal(r.run.scannedCount,6);
  assert.deepEqual(r.modelJobs,['legacy_exclude']);assert.deepEqual(r.deliveries,['legacy_exclude']);
  assert.deepEqual(r.selected,['production','retail','legacy_exclude']);assert.equal(r.publicRun.skippedCount,5);
  const early=store.diagnosticEvents.filter(e=>e.details?.modelCalled===false);
  assert.ok(early.some(e=>e.jobKey==='game_headhunter'));assert.ok(early.some(e=>e.jobKey==='production'));
});

for(const [filter,eligible] of [
  ['online',['online']],['today',['today','just','online']],
  ['within3days',['three','yesterday','today','just','online']],
  ['any',['hr_unknown','week','three','yesterday','today','just','online']]
]) {
  test(`实际批量队列 ${filter}：包含更严格条件；HR不符合只记日志跳过，不调用模型也不停轮`,async()=>{
    const activities={hr_unknown:'',week:'本周活跃',three:'3日内活跃',yesterday:'昨日活跃',today:'今日活跃',just:'刚刚活跃',online:'在线'};
    const ids=Object.keys(activities);
    const r=await simulate(ids,20,{hrActivityFilter:filter,activities,realOpen:true});
    assert.deepEqual(r.stops,[]);assert.equal(r.run.status,'completed');
    assert.equal(r.run.successCount,eligible.length);assert.equal(r.run.scannedCount,ids.length);
    assert.deepEqual(r.modelJobs,eligible);assert.deepEqual(r.deliveries,eligible);
    assert.equal(r.publicRun.skippedCount,ids.length-eligible.length);
    assert.equal(r.publicRun.readErrorCount,0);
    assert.equal(r.publicRun.hrActivityFilter,filter);
    const logs=store.diagnosticEvents.filter(e=>e.stage==='HR活跃筛选');
    assert.equal(logs.length,ids.length);
    for(const id of ids.filter(id=>!eligible.includes(id))) {
      assert.ok(!r.requests.some(m=>m.type==='CHECK_CONTACT' && stableJobKey(m.job)===id));
      const row=r.publicRun.results.find(c=>c.jobKey===id);
      assert.equal(row.category,'filtered');assert.match(row.reason,/HR 活跃筛选/);
      const log=logs.find(e=>e.jobKey===id);
      assert.equal(log.details.hrActivityFilter,filter);
      assert.equal(log.details.hrActivityLabel,activities[id]);
      assert.equal(log.details.continuation,'next_job');
      assert.ok(log.company && log.title);
    }
  });
}

test('整段实际队列：连续读取/话术/身份/创建/聊天/未知/超时失败和筛选跳过后，仍达到2条成功上限',async()=>{
  const ids=['read','car','hardware','hold','model','model_skip','changed','create','worker','unknown','timeout','image','good','after_limit'];
  const r=await simulate(ids,2,{realOpen:true});
  assert.deepEqual(r.stops,[]);assert.equal(r.run.status,'completed');assert.equal(r.run.successCount,2);
  assert.equal(r.run.scannedCount,13);assert.equal(r.run.seenJobKeys.length,13);assert.equal(new Set(r.run.seenJobKeys).size,13);
  assert.equal(r.publicRun.skippedCount,4,JSON.stringify(r.publicRun.results.map(row=>({id:row.jobKey,status:row.status,category:row.category,reason:row.reason}))));assert.equal(r.publicRun.readErrorCount,2);assert.equal(r.publicRun.generationErrorCount,1);
  assert.equal(r.publicRun.deliveryErrorCount,2);assert.equal(r.publicRun.unknownSendCount,2);
  assert.ok(!r.selected.includes('car'));assert.ok(!r.selected.includes('after_limit'));assert.ok(!r.modelJobs.includes('read'));
  assert.ok(!r.deliveries.includes('changed'));assert.ok(r.deliveries.includes('good'));
  const failedRead=r.run.candidates.find(c=>c.jobKey==='read');assert.equal(failedRead.job.company,'公司-read');assert.equal(failedRead.job.description,'');
  assert.equal(store.pendingDelivery,null);assert.equal(store.dailyStats.successfulContacts,2);
  assert.equal(store.jobHistories.unknown.lastDeliveryFailure.textState,'unknown');assert.equal(store.jobHistories.timeout.lastDeliveryFailure.textState,'unknown');
  assert.equal(store.jobHistories.worker.lastDeliveryFailure.textState,'not_started');
  assert.equal(store.jobHistories.image.attempts.length,1);assert.equal(store.jobHistories.image.attempts[0].resumeImageStatus,'failed');
  const logged=store.diagnosticEvents.filter(e=>e.stage==='单岗位失败，继续下一条');
  assert.equal(logged.length,7);assert.ok(logged.every(e=>e.details.continuation==='next_job' && e.company && e.jobKey));
  assert.ok(!JSON.stringify(logged).includes('仅内存测试'));
});

test('没有一条成功也不按连续错误数停轮：处理完所有公司后以列表到底结束',async()=>{
  const r=await simulate(['read','model','changed','worker','unknown','timeout'],20);
  assert.deepEqual(r.stops,[]);assert.equal(r.run.status,'completed');assert.equal(r.run.scannedCount,6);assert.equal(r.run.successCount,0);
  assert.match(r.run.reason,/处理到底/);
});

test('用户设置20条成功：首条识别失败后连续完成20条，不把失败占入上限',async()=>{
  const ids=['read',...Array.from({length:21},(_,i)=>`good-${i}`)];
  const r=await simulate(ids,20,{realOpen:true});assert.equal(r.run.status,'completed');assert.deepEqual(r.stops,[]);
  assert.equal(r.run.successCount,20);assert.equal(r.run.scannedCount,21);assert.equal(store.dailyStats.successfulContacts,20);
  assert.ok(!r.selected.includes('good-20'));
});

test('实际队列遇平台验证：全局暂停，不通过换公司继续访问',async()=>{
  const r=await simulate(['platform','good']);assert.equal(r.run.status,'blocked');assert.equal(r.run.scannedCount,0);
  assert.deepEqual(r.deliveries,[]);assert.ok(!r.selected.includes('good'));
});

test('失败日志不能保存：保留失败而非无记录快速重复处理',async()=>{
  const r=await simulate(['read','good'],2,{recordFailure:true});assert.equal(r.run.status,'blocked');assert.deepEqual(r.deliveries,[]);
  assert.equal(r.stops.length,1);assert.match(r.stops[0],/存储写入失败/);
});

for(const stage of ['opening_job','opening_chat','sending_text','sending_resume','recording']) {
  test(`后台 ${stage} 单条失败释放pending、保持running；下一岗位可正常成功`,async()=>{
    reset();const f=await prepare(makeJob('bad'),stage);const result=await report(f);
    assert.equal(result.continued,true);assert.equal(result.publicSession.status,'running');assert.equal(result.publicSession.successCount,0);
    assert.equal(store.pendingDelivery,null);assert.equal(store.deliveryOutcome.status,'failed');
    const contact=await send({type:'CHECK_CONTACT',job:f.job});
    const unknown=!['opening_job','opening_chat'].includes(stage);
    assert.equal(contact.allowed,!unknown);assert.equal(contact.skipExistingImport,true);
    const job=makeJob('next');await send({type:'REGISTER_AUTOMATION_JOB',sessionId:f.run.id,job,status:'queued'});
    const next=await send({type:'SET_PENDING_DELIVERY',delivery:{mode:'auto',automationRunId:f.run.id,job,message:'内存下一条'}});assert.equal(next.ok,true);
    const sent=await send({type:'RECORD_SEND',automationRunId:f.run.id,deliveryId:next.pending.id,job,message:'内存下一条'});
    assert.equal(sent.ok,true);assert.equal(sent.automationSession.successCount,1);assert.equal(sent.automationSession.status,'running');
  });
}

test('旧worker、错误岗位、错误轮次、其他文档/iframe不能把当前任务标为失败或清pending',async()=>{
  reset();const f=await prepare();const original=JSON.stringify(store);
  for(const [fixture,sender] of [[{...f,job:makeJob('wrong')},f.sender],[{...f,run:{id:'old'}},source],
    [f,{...f.sender,tab:{id:999}}],[f,{...source,documentId:'other'}],[f,{...source,frameId:1}]]) {
    const result=await report(fixture,sender);assert.equal(result.ignored,true);assert.equal(JSON.stringify(store),original);
  }
});

test('同一失败重复报告不重复计数；迟到成功回执不能把未知发送误计成功',async()=>{
  reset();const f=await prepare(makeJob('one'),'sending_text');await report(f);
  const count=store.diagnosticEvents.length;
  const again=await report(f,source);assert.equal(again.alreadyCompleted,true);assert.equal(store.diagnosticEvents.length,count);
  const late=await send({type:'RECORD_SEND',automationRunId:f.run.id,deliveryId:f.pending.id,job:f.job,message:'迟到成功'},f.sender);
  assert.equal(late.ok,false);assert.equal(store.automationSession.successCount,0);assert.equal(store.jobHistories.one.attempts.length,0);
});

test('成功回执先到，来源页迟到超时不得覆盖已发送记录或重复计数',async()=>{
  reset();const f=await prepare();await send({type:'RECORD_SEND',automationRunId:f.run.id,deliveryId:f.pending.id,job:f.job,message:'已确认'},f.sender);
  const result=await report(f,source);assert.equal(result.alreadyCompleted,true);assert.equal(result.outcome.status,'sent');
  assert.equal(store.automationSession.successCount,1);assert.equal(store.automationSession.candidates[0].status,'sent');
});
