import test from 'node:test';
import assert from 'node:assert/strict';

// 实际后台逻辑；Chrome 的存储、标签页和消息只放在本进程内存中。
const store={};let listener,nextTab=100;
globalThis.chrome={storage:{local:{
  async get(keys){return typeof keys==='string' ? {[keys]:store[keys]} : Array.isArray(keys) ? Object.fromEntries(keys.map(key=>[key,store[key]])) : {...store};},
  async set(values){Object.assign(store,values);}
}},tabs:{async create(options){return {id:nextTab++,windowId:1,...options};},async remove(){}},runtime:{
  getManifest(){return {version:'retry-test'};},getURL(path){return `chrome-extension://test/${path}`;},
  onInstalled:{addListener(){}},onMessage:{addListener(fn){listener=fn;}}
}};
await import('../background.js?retry-failure-regression');
const source={url:'https://www.zhipin.com/web/geek/jobs',tab:{id:11,windowId:1}};
const job={title:'软件测试工程师',company:'示例科技',location:'上海',recruiterName:'钟女士',activityText:'在线',
  recruiterCompany:'示例科技',description:'负责业务功能测试、接口验证和上线前版本回归。',url:'https://www.zhipin.com/job_detail/retry-job.html'};
const send=(message,sender=source)=>new Promise(resolve=>listener(message,sender,resolve));
function reset(){for(const key of Object.keys(store)) delete store[key];}
async function start(){const result=await send({type:'START_AUTOMATION',runLimit:20,sourceUrl:source.url,sourcePlan:{label:'测试开发（上海）',key:'测试开发(上海)'}});assert.equal(result.ok,true);return result.session;}
async function prepare(stage='opening_chat') {
  const run=await start();
  await send({type:'REGISTER_AUTOMATION_JOB',sessionId:run.id,job,status:'queued',analysis:{decision:'recommend'}});
  const saved=await send({type:'SET_PENDING_DELIVERY',delivery:{mode:'auto',automationRunId:run.id,job,
    message:'测试内存中的招呼语，不发送到真实平台',round:1,sourceUrl:source.url}});
  let pending=saved.pending,sender=source;
  if(stage!=='prepared') {
    const opened=await send({type:'OPEN_DELIVERY_WORKER'});pending=opened.pending;
    sender={url:job.url,tab:{id:opened.workerTabId,windowId:1}};
    if(stage!=='opening_job') await send({type:'UPDATE_PENDING_DELIVERY',deliveryId:pending.id,stage},sender);
  }
  return {run,pending,sender};
}
const stop=f=>send({type:'STOP_AUTOMATION',sessionId:f.run.id,deliveryId:f.pending.id,status:'blocked',reason:'模拟该阶段失败'},f.sender);

for(const stage of ['prepared','opening_job','opening_chat']) {
  test(`${stage} 失败只记录未发送状态；重启后“继续沟通”不能变成已发送和4小时冷却`,async()=>{
    reset();const f=await prepare(stage);const stopped=await stop(f);
    assert.equal(stopped.ignored,undefined);assert.equal(stopped.session.status,'blocked');
    const row=stopped.session.candidates[0];assert.equal(row.status,'read_error');assert.match(row.reason,/尚未填写或发送/);
    assert.equal(row.deliveryFailure.stage,stage);assert.equal(row.deliveryFailure.textState,'not_started');
    assert.equal(stopped.publicSession.successCount,0);assert.equal(stopped.publicSession.skippedCount,0);
    assert.equal(stopped.publicSession.readErrorCount,1);assert.equal(store.pendingDelivery,null);
    const restarted=await start();assert.deepEqual(restarted.seenJobKeys,[]);
    const contact=await send({type:'CHECK_CONTACT',job:{...job,buttonText:'继续沟通'}});
    assert.equal(contact.allowed,true);assert.equal(contact.eligibility.round,1);assert.equal(contact.skipExistingImport,true);
    const imported=await send({type:'MARK_EXISTING',job,automatic:true});
    assert.equal(imported.skipped,true);assert.deepEqual(imported.history.attempts,[]);
    assert.equal((await send({type:'CHECK_CONTACT',job})).allowed,true);
    assert.equal((await send({type:'GET_CONTACT_MARKERS'})).jobs['retry-job'],undefined);
    assert.doesNotMatch(JSON.stringify(imported.history.lastDeliveryFailure),/测试内存|message|data:|apiKey/);
  });
}

for(const stage of ['sending_text','sending_resume','recording']) {
  test(`${stage} 失败不能假设未发送，自动重试和按钮导入都停住，人工登记仍可确认`,async()=>{
    reset();const f=await prepare(stage);await stop(f);await start();
    const contact=await send({type:'CHECK_CONTACT',job});
    assert.equal(contact.allowed,false);assert.equal(contact.code,'delivery_send_unknown');assert.equal(contact.skipExistingImport,true);
    assert.equal(contact.deliveryFailure.textState,'unknown');
    const automated=await send({type:'MARK_EXISTING',job,automatic:true});assert.equal(automated.skipped,true);assert.equal(automated.history.attempts.length,0);
    const manual=await send({type:'MARK_EXISTING',job});assert.equal(manual.history.attempts.length,1);
    assert.equal(manual.history.attempts[0].imported,true);assert.equal(manual.history.lastDeliveryFailure,undefined);
    const next=await send({type:'CHECK_CONTACT',job});assert.equal(next.code,undefined);assert.equal(next.eligibility.round,2);assert.equal(next.allowed,false);
  });
}

test('失败岗位成功重试后清除失败元数据，只累计一次成功并保留正常防重',async()=>{
  reset();await stop(await prepare());const f=await prepare();
  const recorded=await send({type:'RECORD_SEND',deliveryId:f.pending.id,job,message:'内存消息',round:1,
    automationRunId:f.run.id,resumeImageStatus:'sent'},f.sender);
  assert.equal(recorded.ok,true);assert.equal(recorded.history.lastDeliveryFailure,undefined);
  assert.equal(recorded.history.attempts.length,1);assert.equal(recorded.dailyStats.successfulContacts,1);
  assert.equal(recorded.automationSession.successCount,1);assert.equal(recorded.automationSession.results[0].status,'sent');
  const next=await send({type:'CHECK_CONTACT',job});assert.equal(next.allowed,false);assert.equal(next.skipExistingImport,false);assert.equal(next.eligibility.round,2);
});

test('文字成功但图片失败：pending已被RECORD_SEND清掉，worker仍可按同一outcome停止轮次',async()=>{
  reset();const f=await prepare('sending_resume');
  await send({type:'RECORD_SEND',deliveryId:f.pending.id,job,message:'内存消息',round:1,
    automationRunId:f.run.id,resumeImageStatus:'failed'},f.sender);
  assert.equal(store.pendingDelivery,null);
  const result=await stop(f);assert.equal(result.ignored,undefined);assert.equal(result.session.status,'blocked');
  assert.equal(result.session.candidates[0].status,'sent');assert.equal(result.session.successCount,1);
  assert.equal(store.jobHistories['retry-job'].attempts.length,1);assert.equal(store.jobHistories['retry-job'].lastDeliveryFailure,undefined);
});

test('旧任务的停止请求（有旧ID或无ID旧worker）不能修改新任务、写失败历史或清新pending',async()=>{
  reset();const old=await prepare();const current=await prepare();
  const before=JSON.stringify(store.automationSession),pendingId=store.pendingDelivery.id;
  for(const [message,sender] of [
    [{type:'STOP_AUTOMATION',sessionId:old.run.id,deliveryId:old.pending.id,status:'blocked'},old.sender],
    [{type:'STOP_AUTOMATION',sessionId:old.run.id,status:'blocked'},source],
    [{type:'STOP_AUTOMATION',status:'blocked'},old.sender]
  ]) {
    const result=await send(message,sender);assert.equal(result.ignored,true);
    assert.equal(JSON.stringify(store.automationSession),before);assert.equal(store.pendingDelivery.id,pendingId);
    assert.equal(store.jobHistories,undefined);
  }
  assert.equal(store.automationSession.id,current.run.id);
});

test('成功记录早已存在，之后未发送失败也不能清空真实历史或把下一轮降成首次',async()=>{
  reset();const first=await prepare();
  await send({type:'RECORD_SEND',deliveryId:first.pending.id,job,message:'已确认成功',round:1,
    automationRunId:first.run.id,resumeImageStatus:'sent'},first.sender);
  const second=await prepare();await stop(second);
  const contact=await send({type:'CHECK_CONTACT',job});assert.equal(contact.eligibility.round,2);assert.equal(contact.allowed,false);
  assert.equal(store.jobHistories['retry-job'].attempts.length,1);assert.equal(contact.skipExistingImport,true);
});

const oldFailure={at:'2026-09-05T01:00:00.000Z',runId:'old-precise-run',stage:'临时投递异常',result:'error',
  expected:{jobKey:'retry-job'},details:{code:'delivery_exception',deliveryStage:'opening_chat'}};
test('0.4.11旧诊断精确证明opening_chat失败时，可恢复未发送标记但不捏造成功历史',async()=>{
  reset();store.diagnosticEvents=[structuredClone(oldFailure)];
  const contact=await send({type:'CHECK_CONTACT',job});assert.equal(contact.allowed,true);assert.equal(contact.skipExistingImport,true);
  assert.equal(contact.deliveryFailure.source,'diagnostic_recovery');assert.equal(contact.deliveryFailure.automationRunId,'old-precise-run');
  assert.equal(contact.deliveryFailure.failedAt,oldFailure.at);assert.deepEqual(store.jobHistories['retry-job'].attempts,[]);
  assert.equal((await send({type:'MARK_EXISTING',job,automatic:true})).skipped,true);
});

for(const [label,change] of [
  ['不同岗位',event=>{event.expected.jobKey='different-job';}],
  ['缺少run',event=>{event.runId='';}],
  ['没有精确错误码',event=>{event.details.code='其他错误';}],
  ['没有阶段',event=>{delete event.details.deliveryStage;}],
  ['未知发送状态',event=>{event.details.deliveryStage='sending_text';}],
  ['无效时间',event=>{event.at='unknown';}]
]) {
  test(`旧诊断${label}不推断未发送`,async()=>{
    reset();const event=structuredClone(oldFailure);change(event);store.diagnosticEvents=[event];
    const contact=await send({type:'CHECK_CONTACT',job});assert.equal(contact.skipExistingImport,false);assert.equal(store.jobHistories,undefined);
  });
}

for(const [label,after] of [
  ['随后发送文字',{stage:'发送文字',result:'processing'}],
  ['随后确认成功',{stage:'发送结果',result:'sent'}],
  ['随后人工登记',{stage:'手动标记',result:'imported'}],
  ['随后结果未知',{stage:'投递中断',details:{code:'delivery_send_unknown'}}]
]) {
  test(`${label}，旧opening_chat异常不能反向解封`,async()=>{
    reset();store.diagnosticEvents=[structuredClone(oldFailure),{...after,at:'2026-09-05T01:01:00.000Z',runId:'later-run',jobKey:'retry-job'}];
    const contact=await send({type:'CHECK_CONTACT',job});assert.equal(contact.skipExistingImport,false);assert.equal(store.jobHistories,undefined);
  });
}

test('旧异常的自动恢复不清理人工导入或插件真实发送记录',async()=>{
  reset();store.diagnosticEvents=[structuredClone(oldFailure)];
  store.jobHistories={'retry-job':{attempts:[{status:'sent',sentAt:new Date().toISOString(),imported:true}]}};
  const contact=await send({type:'CHECK_CONTACT',job});assert.equal(contact.allowed,false);assert.equal(contact.skipExistingImport,false);
  assert.equal(store.jobHistories['retry-job'].attempts.length,1);assert.equal(store.jobHistories['retry-job'].lastDeliveryFailure,undefined);
});
