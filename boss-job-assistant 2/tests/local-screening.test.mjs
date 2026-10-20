import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {AUTO_SKIP_COMPANIES,precheckAgency,analyzeJob,parseModelResult,stableJobKey} from '../shared/core.js';
import {diagnosticDetails,reasonCategory} from '../shared/diagnostics.js';

// 只执行真实本地规则和后台消息入口；Chrome、存储与 fetch 均为进程内替身。
// 不连接浏览器、不读取实际账户、不发送真实模型请求或求职消息。
const store={},requests=[];
let listener,fetchImpl;
globalThis.chrome={storage:{local:{
  async get(keys){return structuredClone(typeof keys==='string' ? {[keys]:store[keys]} : Array.isArray(keys) ? Object.fromEntries(keys.map(k=>[k,store[k]])) : store);},
  async set(data){Object.assign(store,structuredClone(data));}
}},tabs:{},runtime:{getManifest:()=>({version:'0.4.16-test'}),getURL:p=>`chrome-extension://test/${p}`,
  onInstalled:{addListener(){}},onMessage:{addListener(fn){listener=fn;}}}};
globalThis.fetch=async(url,options)=>{requests.push({url,options});return fetchImpl(url,options);};
await import('../background.js?local-first-regression');
const sender={url:'https://www.zhipin.com/web/geek/jobs',documentId:'local-source',frameId:0,tab:{id:9}};
const send=(message,from=sender)=>new Promise(resolve=>listener(message,from,resolve));
const base={title:'软件测试工程师',company:'普通产品公司',listingCompany:'普通产品公司',location:'上海',recruiterName:'陈女士',
  activityText:'刚刚活跃',description:'负责Web软件功能和接口测试，使用Postman验证订单业务。',url:'https://www.zhipin.com/job_detail/local-test.html'};
const greeting='陈老师您好，看贵公司在招聘软件测试工程师岗位，我有3年软件测试经验，熟悉使用Postman验证接口业务。岗位要求和我的经历比较匹配，期待您的回复，感谢！';
const response=value=>({ok:true,status:200,json:async()=>({choices:[{message:{content:JSON.stringify(value)}}],model:'mock-model'})});
async function setup({key=true,hrActivityFilter='within3days'}={}) {
  for(const k of Object.keys(store)) delete store[k];requests.length=0;
  store.settings={apiKey:key ? 'FAKE_TEST_KEY_NOT_A_CREDENTIAL' : '',model:'mock-model',apiBaseUrl:'https://open.bigmodel.cn/api/paas/v4'};
  fetchImpl=async()=>response({selectedProfileFacts:['接口业务测试'],greeting});
  const started=await send({type:'START_AUTOMATION',sourceUrl:sender.url,sourcePlan:{label:'测试工程师（上海）',key:'testing'},runLimit:20,hrActivityFilter});
  assert.equal(started.ok,true);return started.session.id;
}
const generate=(runId,job=base,extra={},from=sender)=>send({type:'GENERATE_GREETING',automatic:true,automationRunId:runId,job,...extra},from);

for(const rule of AUTO_SKIP_COMPANIES) {
  test(`公司暂缓规则：${rule.name} 的全部别名、分公司和招聘者公司在本地命中`,()=>{
    for(const alias of rule.aliases) {
      for(const job of [{listingCompany:`上海${alias}有限公司`,recruiterCompany:'真实甲方'},
        {listingCompany:'甲方产品公司',recruiterCompany:`${alias} 上海分公司`}]) {
        const match=precheckAgency(job);assert.equal(match?.code,'agency_manual_only',JSON.stringify(job));
        assert.match(match.reasons[0],/本条不调用模型/);
      }
    }
  });
}

for(const [name,job] of [
  ['页面猎头标记',{agencyHint:true}],['明确猎头身份',{recruitmentMode:'agency'}],
  ['岗位写明外包',{description:'本岗位属于技术外包，负责接口测试。'}],
  ['明确派遣客户',{description:'派遣至客户公司负责软件测试。'}],
  ['第三方合同',{description:'与第三方签订劳动合同。'}]
]) test(`${name}自动批量留给手动`,()=>assert.equal(precheckAgency(job)?.decision,'postpone'));

for(const [name,job] of [
  ['直营游戏测试',{title:'游戏测试工程师',company:'某游戏产品公司'}],
  ['左右多主体但没有外包证据',{company:'公司甲',recruiterCompany:'公司乙',recruitmentMode:'multi_entity'}],
  ['JD提及供应商并非招聘公司',{company:'普通公司',description:'接口测试，使用中软国际交付的系统，与科锐国际对接业务。'}],
  ['微创医疗不是微创软件',{company:'上海微创医疗器械有限公司'}],
  ['不按泛公司词误杀',{company:'上海创新信息科技咨询有限公司'}],
  ['非外包',{description:'本岗位为非外包直招，负责软件测试。'}],
  ['管理外包团队不是自身外包',{description:'负责外包团队质量管理和外包管理软件的接口测试。'}]
]) test(`${name}不因猎头规则排除`,()=>assert.equal(precheckAgency(job),null));

const production={...base,title:'生产测试工程师',company:'上海华岭',listingCompany:'上海华岭',
  description:'负责生产测试支持、新产品测试导入、测试工艺和文档。电子工程专业，半导体经验，熟悉IATF五大工具APQP CP FMEA SPC PPAP。'};
const retail={...base,title:'电子产品和奢侈品店铺负责人工程师/就近',company:'爱回收',listingCompany:'爱回收',
  description:'负责二手商品回收测试评估、分类整理、包装和门店回收服务。'};
for(const job of [production,retail]) test(`复现日志 ${job.company}/${job.title}：本地排除，无须模型判断`,()=>{
  const result=analyzeJob(job);assert.equal(result.decision,'postpone');assert.match(result.reasons[0],/本地筛选/);
});
test('半导体和零售公司中的普通软件测试仍可投；信息不多也不再交给模型分类',()=>{
  for(const job of [{...base,company:'上海华岭',description:'负责半导体企业Web业务系统的接口测试。'},
    {...base,company:'爱回收',description:'负责门店回收系统Web端软件测试。'},
    {...base,description:'参与产品版本测试并提交测试结果。'}]) assert.equal(analyzeJob(job).decision,'recommend');
});
test('只生成话术的接口兼容无 decision JSON，并忽略旧 decision；空话术仍不能发送',()=>{
  assert.equal(parseModelResult(JSON.stringify({greeting}),{greetingOnly:true}).decision,'recommend');
  assert.equal(parseModelResult(JSON.stringify({decision:'exclude',greeting}),{greetingOnly:true}).decision,'recommend');
  assert.throws(()=>parseModelResult('{}',{greetingOnly:true}));
  assert.throws(()=>parseModelResult(JSON.stringify({decision:'wrong',greeting})));
});

for(const [label,job,filter] of [
  ['硬件',{...base,title:'硬件测试工程师',description:'硬件测试、示波器调试。'}],
  ['光学',{...base,title:'光学测试工程师',description:'负责光学设备测试。'}],
  ['猎头游戏',{...base,title:'游戏测试工程师',agencyHint:true}],
  ['科瑞国际',{...base,listingCompany:'科瑞国际',recruiterCompany:'甲方'}],
  ['中软',{...base,listingCompany:'中软国际'}],['精北方',{...base,listingCompany:'精北方'}],
  ['大型互联网',{...base,listingCompany:'腾讯科技'}],['中型游戏',{...base,listingCompany:'鹰角网络'}],
  ['未具名中厂',{...base,listingCompany:'某科技中厂'}],['标题大厂',{...base,title:'软件测试工程师（互联网大厂）'}],
  ['生产测试',production],['回收门店',retail],
  ['上海之外',{...base,location:'北京'}],['HR不符合',{...base,activityText:'3日内活跃'},'today']
]) test(`真实后台入口 ${label}：没有 API Key 也先返回本地跳过，fetch 为零`,async()=>{
  const id=await setup({key:false,hrActivityFilter:filter});
  const result=await generate(id,job);
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.blocked,true);assert.equal(requests.length,0);
  const log=store.diagnosticEvents.find(e=>e.stage==='模型前本地筛选');
  assert.ok(log.company && log.title);assert.equal(log.details.modelCalled,false);
  assert.equal(store.automationSession.status,'running');assert.equal(store.automationSession.successCount,0);
});
test('防重条件也在实际模型请求前执行',async()=>{
  const id=await setup({key:false});await send({type:'MARK_EXISTING',job:base});
  const result=await generate(id);assert.equal(result.ok,true);assert.equal(result.blocked,true);
  assert.equal(result.code,'contact_hold');assert.equal(requests.length,0);
});
test('普通软件和直营游戏：只调用一次模型生成话术，不让旧分类字段否决',async()=>{
  for(const title of ['软件测试工程师','游戏测试工程师']) {
    const id=await setup();fetchImpl=async()=>response({decision:'exclude',reason:'不要投',greeting});
    const result=await generate(id,{...base,title});
    assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.modelResult.decision,'recommend');
    assert.equal(requests.length,1);assert.equal(store.automationSession.successCount,0,'生成不能计作成功');
    const body=JSON.parse(requests[0].options.body),payload=JSON.parse(body.messages[1].content);
    assert.equal(payload.task,'greeting_only');assert.equal(payload.localAnalysis.screeningPassed,true);
    assert.match(body.messages[0].content,/不要重新筛选或评价是否投递/);
    assert.equal(store.diagnosticEvents.filter(e=>e.stage==='模型接口请求').length,1);
    assert.equal(store.diagnosticEvents.filter(e=>e.stage==='模型接口返回').length,1);
    assert.doesNotMatch(JSON.stringify(store.diagnosticEvents),/FAKE_TEST_KEY|"greeting"|candidateSummary/);
  }
});
test('手动单条不套用批量猎头暂缓，仍可生成话术',async()=>{
  await setup();const result=await send({type:'GENERATE_GREETING',job:{...base,agencyHint:true,listingCompany:'科锐国际'}});
  assert.equal(result.ok,true);assert.ok(result.modelResult.greeting);assert.equal(requests.length,1);
});
test('大中厂只限制自动批量；手动单条模型和待发送任务不被该规则拒绝',async()=>{
  await setup();const job={...base,listingCompany:'小红书'};
  const result=await send({type:'GENERATE_GREETING',job});
  assert.equal(result.ok,true);assert.ok(result.modelResult.greeting);assert.equal(requests.length,1);
  const pending=await send({type:'SET_PENDING_DELIVERY',delivery:{mode:'manual',job,message:greeting,sourceUrl:sender.url}});
  assert.equal(pending.ok,true);assert.equal(pending.pending.mode,'manual');
});
test('后台大中厂规则不可被绕过：自动模型零请求、自动待发送任务不能建立',async()=>{
  const id=await setup({key:false}),job={...base,listingCompany:'普通产品公司',recruiterCompany:'腾讯科技'};
  const generated=await generate(id,job);
  assert.equal(generated.ok,true);assert.equal(generated.blocked,true);assert.equal(generated.code,'tech_company_manual_only');
  assert.equal(requests.length,0);
  const pending=await send({type:'SET_PENDING_DELIVERY',delivery:{mode:'auto',automationRunId:id,job,message:greeting,sourceUrl:sender.url}});
  assert.equal(pending.ok,false);assert.match(pending.error,/大中型科技\/互联网公司/);assert.equal(store.pendingDelivery,null);
});
test('错误轮次、已停止、另一来源文档或 iframe 不能请求模型',async()=>{
  const id=await setup();
  for(const [run,from] of [['wrong',sender],[id,{...sender,documentId:'other'}],[id,{...sender,frameId:1}],[id,{...sender,tab:{id:999}}]]) {
    const result=await generate(run,base,{},from);assert.equal(result.ok,false);assert.equal(requests.length,0);
  }
  await send({type:'STOP_AUTOMATION',sessionId:id});
  assert.equal((await generate(id)).ok,false);assert.equal(requests.length,0);
});
test('后台建立自动投递任务时再次防护，不能绕过本地猎头判断',async()=>{
  const id=await setup();const result=await send({type:'SET_PENDING_DELIVERY',delivery:{mode:'auto',automationRunId:id,
    job:{...base,agencyHint:true},message:greeting,sourceUrl:sender.url}});
  assert.equal(result.ok,false);assert.match(result.error,/local_screening_filtered/);assert.equal(store.pendingDelivery,null);
});
for(const ignoresAbort of [false,true]) test(`停止时取消请求；${ignoresAbort ? '即使远端忽略取消并返回' : 'fetch响应取消'}也不继续生成或计数`,async()=>{
  const id=await setup();let entered,finish,signal;
  const started=new Promise(resolve=>{entered=resolve;});
  fetchImpl=(_url,options)=>new Promise((resolve,reject)=>{
    signal=options.signal;finish=()=>resolve(response({greeting:'虽然没有相关经验，但是愿意学。'}));
    if(!ignoresAbort) signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})),{once:true});
    entered();
  });
  const pending=generate(id);await started;
  assert.equal((await send({type:'STOP_AUTOMATION',sessionId:id})).ok,true);
  assert.equal(signal.aborted,true);if(ignoresAbort) finish();
  const result=await pending;
  assert.equal(result.ok,false);assert.match(result.error,/model_cancelled/);assert.equal(requests.length,1);
  assert.equal(store.automationSession.status,'stopped');assert.equal(store.automationSession.successCount,0);
  assert.ok(!store.diagnosticEvents.some(e=>e.stage==='模型接口返回'));
});
test('日志区分等待、条件过滤和请求，并保留无敏感信息的聊天入口诊断',()=>{
  assert.equal(reasonCategory('本地已通过，等待模型生成','queued'),'queued');
  assert.equal(reasonCategory('自动批量暂缓猎头/外包：本条不调用模型','skipped'),'filtered');
  const d=diagnosticDetails({buttonTag:'A',buttonHrefKind:'javascript',buttonDisabled:false,dialogPresent:true,chatTabBound:false,
    modelCalled:false,modelAttempt:1,apiKey:'SECRET',message:'PRIVATE',resumeImage:'PRIVATE'});
  assert.equal(d.buttonHrefKind,'javascript');assert.equal(d.dialogPresent,true);assert.equal(d.modelCalled,false);
  assert.equal(d.modelAttempt,1);assert.doesNotMatch(JSON.stringify(d),/PRIVATE|SECRET/);
});

const content=await readFile(new URL('../content.js',import.meta.url),'utf8');
const greetingFunction=content.slice(content.indexOf('  async function generateGreeting('),content.indexOf('  function blockerText()'));
for(const condition of ['stopped','new_run','new_job']) test(`实际前端 ${condition} 后收到迟到结果：不写入当前话术，不记生成成功`,async()=>{
  let respond;
  const logs=[],state={job:{...base},automation:{id:'old'},stopRequested:false};
  const context={state,stableJobKey,sourceDocumentToken:'source-token',generateButton:{},render(){},setNotice(){},
    async logEvent(...args){logs.push(args);},sendRuntimeMessage:()=>new Promise(resolve=>{respond=resolve;})};
  vm.createContext(context);vm.runInContext(greetingFunction,context);
  const result=context.generateGreeting(true);
  if(condition==='stopped') state.stopRequested=true;
  if(condition==='new_run') state.automation.id='new';
  if(condition==='new_job') state.job={...base,url:'https://www.zhipin.com/job_detail/another.html'};
  respond({ok:true,modelResult:{greeting},round:1});
  await assert.rejects(result,/丢弃/);assert.equal(state.modelResult,undefined);assert.equal(state.busy,false);assert.equal(logs.length,0);
});

test('跳过关键词：自动与单条生成都在后台本地拦截，零模型请求；未命中时正常生成',async()=>{
  const runId=await setup();
  Object.assign(store.settings,{skipTitleKeywords:'外包，驻场',skipDescriptionKeywords:'出差，夜班',skipDescriptionMode:'count',skipDescriptionCount:2});
  const titled=await generate(runId,{...base,title:'软件测试工程师（驻场）'});
  assert.equal(titled.blocked,true);assert.equal(titled.code,'user_skip_keywords');assert.match(titled.reason,/岗位标题命中“驻场”/u);
  const manual=await send({type:'GENERATE_GREETING',job:{...base,description:`${base.description}需要长期出差，偶尔夜班。`}});
  assert.equal(manual.blocked,true);assert.match(manual.reason,/职位描述命中“出差、夜班”（至少命中2个不同词）/u);
  const one=await generate(runId,{...base,description:`${base.description}偶尔出差。`});
  assert.equal(one.blocked,undefined);assert.ok(one.modelResult.greeting);
  assert.equal(requests.length,1,'只有未命中的那条请求了模型');
  const log=store.diagnosticEvents.find(e=>e.details?.code==='user_skip_keywords');
  assert.equal(log.details.modelCalled,false);assert.equal(reasonCategory(titled.reason,'skipped'),'filtered');
});
