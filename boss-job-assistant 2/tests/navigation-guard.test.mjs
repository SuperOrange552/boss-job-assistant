// 纯 Node + 内存 Chrome 替身；不导入浏览器驱动，不连接真实 Chrome 或模型接口。
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {sourceDocumentKey,sourcePageAction} from '../shared/navigation.js';
import {diagnosticDetails} from '../shared/diagnostics.js';

const source={url:'https://www.zhipin.com/web/geek/jobs',tab:{id:11},frameId:0,documentId:'doc-original'};
const store={},created=[],removed=[];
let listener,updated;
globalThis.chrome={storage:{local:{
  async get(keys){return structuredClone(typeof keys==='string' ? {[keys]:store[keys]}
    : Array.isArray(keys) ? Object.fromEntries(keys.map(key=>[key,store[key]])) : store);},
  async set(values){Object.assign(store,structuredClone(values));}
}},tabs:{
  onUpdated:{addListener(fn){updated=fn;}},
  async create(options){const tab={id:100+created.length,...options};created.push(tab);return tab;},
  async remove(id){removed.push(id);}
},runtime:{getManifest(){return {version:'0.4.13'};},getURL(path){return `chrome-extension://test/${path}`;},
  onInstalled:{addListener(){}},onMessage:{addListener(fn){listener=fn;}}
}};
await import('../background.js?navigation-guard');
const send=(message,sender=source)=>new Promise(resolve=>listener(message,sender,resolve));
function reset(){for(const key of Object.keys(store))delete store[key];created.length=0;removed.length=0;}
async function start(sender=source){return send({type:'START_AUTOMATION',runLimit:20,sourceUrl:source.url,
  sourceDocumentToken:'fallback-token',sourcePlan:{label:'测试开发（上海）',key:'测试开发(上海)'}},sender);}
const lifecycle=(event,sender=source,extra={})=>send({type:'SOURCE_PAGE_LIFECYCLE',event,sourceDocumentToken:'fallback-token',...extra},sender);
const job={title:'软件测试工程师',company:'示例科技',recruiterName:'王老师',location:'上海',activityText:'在线',
  description:'负责Web软件业务功能和接口测试，完成版本回归。',url:'https://www.zhipin.com/job_detail/nav-test.html'};

test('用实际文档ID绑定来源页，旧Chrome可回退到随机文档令牌',()=>{
  assert.equal(sourceDocumentKey(source,'untrusted-token'),'chrome:doc-original');
  assert.equal(sourceDocumentKey({},'token'),'content:token');
  const run={id:'run',status:'running',sourceTabId:11,sourceDocumentKey:'content:token'};
  assert.equal(sourcePageAction(run,{tab:{id:11}},'ready','token'),'stay');
  assert.equal(sourcePageAction(run,{tab:{id:11}},'ready','other'),'pause');
  assert.equal(sourcePageAction(run,source,'visibilitychange'),'ignore');
});

test('同一原列表文档不被误停；其他标签、临时页、子框架不会接管或停止它',async()=>{
  reset();await start();
  assert.equal((await lifecycle('ready')).action,'stay');
  for(const sender of [{...source,tab:{id:22}},{...source,tab:{id:100},url:job.url},{...source,frameId:2}]){
    assert.equal((await lifecycle('ready',sender)).action,'ignore');
    assert.equal((await lifecycle('left',sender)).action,'ignore');
  }
  assert.equal(store.automationSession.status,'running');
  assert.equal(created.length,0);
});

test('来源页新文档：停止旧运行，保留成功历史/计数/已浏览列表，不创建或关闭标签',async()=>{
  reset();await start();
  store.automationSession.successCount=3;
  store.automationSession.candidates=[{jobKey:'sent-before',job,status:'sent'}];
  store.automationSession.seenJobKeys=['sent-before'];
  store.jobHistories={'sent-before':{attempts:[{status:'sent',sentAt:'2026-09-05T00:00:00Z'}]}};
  const histories=structuredClone(store.jobHistories);
  const response=await lifecycle('ready',{...source,documentId:'doc-new'});
  assert.equal(response.action,'pause');assert.equal(store.automationSession.status,'blocked');
  assert.equal(store.automationSession.successCount,3);
  assert.deepEqual(store.automationSession.seenJobKeys,['sent-before']);
  assert.deepEqual(store.jobHistories,histories);
  assert.equal(created.length,0);assert.equal(removed.length,0);
  assert.match(store.automationSession.reason,/不自动返回、恢复分类或续投/u);
  const logged=store.diagnosticEvents.find(e=>e.details?.code==='source_navigation_paused');
  assert.equal(logged.details.automaticRecovery,false);
  assert.match(logged.details.observedMeaning,/不据此认定/u);
});

test('BFCache恢复同一文档也暂停，不能因文档ID相同就自动续投',async()=>{
  reset();await start();
  assert.equal((await lifecycle('restored')).action,'pause');
  assert.equal(store.automationSession.status,'blocked');
  assert.equal((await lifecycle('restored')).action,'ignore');
});

test('普通标签loading作为卸载消息丢失的补充；临时页loading不停止主列表',async()=>{
  reset();await start();
  updated(100,{status:'loading'});await lifecycle('ready');
  assert.equal(store.automationSession.status,'running');
  updated(11,{status:'complete'});await lifecycle('ready');
  assert.equal(store.automationSession.status,'running');
  updated(11,{status:'loading'});await lifecycle('ready');
  assert.equal(store.automationSession.status,'blocked');
  assert.equal(store.diagnosticEvents.filter(e=>e.details?.code==='source_navigation_paused').length,1);
});

test('旧文档迟到的离开/停止事件不影响新文档手动开始的新轮次',async()=>{
  reset();const old=await start();await lifecycle('left');
  const fresh={...source,documentId:'doc-new'};const next=await start(fresh);
  assert.equal((await lifecycle('left',source)).action,'ignore');
  assert.equal((await lifecycle('left',fresh,{sessionId:old.session.id})).action,'ignore');
  assert.equal(store.automationSession.id,next.session.id);assert.equal(store.automationSession.status,'running');
});

test('导航暂停后迟到的模型/扫描结果不能重新建待发任务、开页或覆盖暂停状态',async()=>{
  reset();const run=await start();
  await send({type:'REGISTER_AUTOMATION_JOB',sessionId:run.session.id,job,status:'queued',analysis:{decision:'recommend'}});
  await lifecycle('left');
  const reason=store.automationSession.reason;
  const late=await send({type:'SET_PENDING_DELIVERY',delivery:{mode:'auto',automationRunId:run.session.id,
    job,message:'迟到的生成结果',sourceUrl:source.url}});
  assert.equal(late.ok,false);assert.match(late.error,/原轮次已停止/u);
  assert.equal((await send({type:'OPEN_DELIVERY_WORKER'})).ok,false);
  await send({type:'MARK_AUTOMATION_CANDIDATE',sessionId:run.session.id,jobKey:'nav-test',status:'skipped',reason:'迟到的模型结果'});
  await send({type:'COMPLETE_AUTOMATION',sessionId:run.session.id,reason:'迟到的列表到底'});
  await send({type:'UPDATE_AUTOMATION_STAGE',sessionId:run.session.id,stage:'scanning',reason:'迟到的扫描'});
  assert.equal(store.automationSession.status,'blocked');assert.equal(store.automationSession.reason,reason);
  assert.equal(store.pendingDelivery,null);assert.equal(created.length,0);assert.equal(removed.length,0);
});

test('新文档未显式开始时不能用旧运行ID创建自动投递任务',async()=>{
  reset();const run=await start();
  const response=await send({type:'SET_PENDING_DELIVERY',delivery:{mode:'auto',automationRunId:run.session.id,
    job,message:'新文档中的旧任务',sourceUrl:source.url}}, {...source,documentId:'doc-new'});
  assert.equal(response.ok,false);assert.match(response.error,/文档已变化/u);
  assert.equal(store.pendingDelivery,null);assert.equal(created.length,0);
});

test('旧投递页迟到的清理不能删除用户后来手动开始的新任务',async()=>{
  reset();const run=await start();
  const prepared=await send({type:'SET_PENDING_DELIVERY',delivery:{mode:'auto',automationRunId:run.session.id,
    job,message:'新的待发任务',sourceUrl:source.url}});
  const result=await send({type:'CLEAR_PENDING_DELIVERY',deliveryId:'old-delivery-id'});
  assert.equal(result.ignored,true);assert.equal(store.pendingDelivery.id,prepared.pending.id);
});

for(const stage of ['opening_job','opening_chat','sending_text','sending_resume']){
  test(`来源页离开时 ${stage} 保留现场与准确未发送/结果未知状态`,async()=>{
    reset();const started=await start();
    await send({type:'REGISTER_AUTOMATION_JOB',sessionId:started.session.id,job,status:'queued',analysis:{decision:'recommend'}});
    const prepared=await send({type:'SET_PENDING_DELIVERY',delivery:{mode:'auto',automationRunId:started.session.id,
      job,message:'只在内存替身中使用，不发送到真实平台',round:1,sourceUrl:source.url}});
    const opened=await send({type:'OPEN_DELIVERY_WORKER'});
    await send({type:'UPDATE_PENDING_DELIVERY',deliveryId:prepared.pending.id,stage},
      {url:job.url,tab:{id:opened.workerTabId},documentId:'worker'});
    const before=created.length;
    await lifecycle('left');
    assert.equal(store.pendingDelivery,null);assert.equal(store.automationSession.status,'blocked');
    assert.equal(store.automationSession.successCount,0);
    const expected=stage.startsWith('opening')?'not_started':'unknown';
    assert.equal(store.jobHistories['nav-test'].lastDeliveryFailure.textState,expected);
    assert.equal(store.jobHistories['nav-test'].attempts.length,0);
    assert.equal(created.length,before);assert.equal(removed.length,0,'保留临时聊天页供核对，不自动关页');
  });
}

test('状态采集脱敏并保留页面事件/方向/加载类型，不导出正文、简历或Key',()=>{
  const detail=diagnosticDetails({pageEvent:'pagehide',sourcePlan:'测试开发（上海）',navigationType:'back_forward',
    cardCount:12,automaticRecovery:false,pageUrl:'https://www.zhipin.com/web/geek/jobs?token=PRIVATE#secret',
    html:'PRIVATE',apiKey:'PRIVATE',message:'PRIVATE',resumeImage:'PRIVATE'});
  assert.equal(detail.pageEvent,'pagehide');assert.equal(detail.cardCount,12);
  assert.equal(detail.automaticRecovery,false);
  assert.equal(detail.pageUrl,'https://www.zhipin.com/web/geek/jobs');
  assert.doesNotMatch(JSON.stringify(detail),/PRIVATE|apiKey|resumeImage|html/u);
});

const content=await readFile(new URL('../content.js',import.meta.url),'utf8');
test('实际页面状态采集函数只有读取和日志消息，不调用模型/点击/发送',async()=>{
  const code=content.slice(content.indexOf('  async function capturePageDiagnostics()'),content.indexOf('  function formatDiagnosticEvent'));
  const events=[];
  const context={location:{pathname:'/web/geek/jobs',href:source.url+'?secret=PRIVATE'},
    document:{readyState:'complete',visibilityState:'visible'},performance:{getEntriesByType:()=>[{type:'back_forward'}]},
    state:{job},currentPlan:()=>({label:'测试开发（上海）'}),collectCards:()=>[{},{}],normalizeText:s=>String(s||'').trim(),
    extractCurrentJob:()=>({...job,description:'岗位描述正文'}),async logEvent(...args){events.push(args);},async readDiagnostics(){}};
  vm.createContext(context);vm.runInContext(code,context);await context.capturePageDiagnostics();
  assert.equal(events.length,1);assert.equal(events[0][4].details.navigationType,'back_forward');
  assert.equal(events[0][4].details.cardCount,2);
  context.location.pathname='/web/geek/chat';context.extractCurrentJob=()=>{throw new Error('聊天页不得读取职位/聊天正文');};
  await context.capturePageDiagnostics();assert.equal(events[1][4].details.pageType,'other');
});

test('实际页面生命周期：隐藏不会触发退出；pagehide本地停机；BFCache只读状态',async()=>{
  const code=content.slice(content.indexOf('  // 隐藏/切换标签不等于离开文档'),content.indexOf('  // 后台创建的核对页'));
  const handlers={},messages=[];const state={automation:{id:'run'},stopRequested:false,departureSequence:0};
  const context={state,sourceDocumentToken:'doc-token',refreshTimer:1,clearTimeout(){},window:{addEventListener(name,fn){handlers[name]=fn;}},
    async sendRuntimeMessage(message){messages.push(message);return {ok:true};},async loadState(){},render(){},setNotice(){}};
  vm.createContext(context);vm.runInContext(code,context);
  assert.equal(handlers.visibilitychange,undefined);
  handlers.pagehide();assert.equal(state.stopRequested,true);assert.equal(state.pageDeparted,true);
  assert.equal(state.departureSequence,1);
  handlers.pageshow({persisted:true});await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(messages.map(m=>m.event),['left','restored']);
});

test('实际点击函数在页面离开后拒绝迟到点击，不能通过BFCache恢复继续执行',()=>{
  const code=content.slice(content.indexOf('  function safeElementClick(element)'),content.indexOf('  function ownText(element)'));
  const context={state:{pageDeparted:true}};vm.createContext(context);vm.runInContext(code,context);
  let clicks=0;
  assert.throws(()=>context.safeElementClick({click(){clicks++;}}),/原页面已离开/u);
  assert.equal(clicks,0);
  context.state.pageDeparted=false;context.safeElementClick({click(){clicks++;}});assert.equal(clicks,1);
});

test('扩展不新增调试/注入权限，无源码自动恢复入口；初始化没有调用主列表runLoop',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../manifest.json',import.meta.url),'utf8'));
  assert.deepEqual(manifest.permissions,['storage','unlimitedStorage']);
  assert.equal(manifest.devtools_page,undefined);
  const background=await readFile(new URL('../background.js',import.meta.url),'utf8');
  assert.equal(/chrome\.debugger\s*\.|Page\.navigate|Runtime\.evaluate|history\.(?:back|go)\s*\(/u.test(content+background),false);
  assert.equal(content.includes('restoreSourcePlan'),false);
  const boot=content.slice(content.indexOf('  // 本页属于原列表且文档已更换'));
  assert.equal(boot.includes('runLoop('),false);
});
