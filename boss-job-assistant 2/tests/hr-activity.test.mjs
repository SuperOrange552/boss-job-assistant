// 纯 Node 回归：实际规则、提取函数、后台存储；所有页面/Chrome对象均为进程内替身。
// 不加载浏览器驱动，不建立调试连接，不调用模型或发送真实消息。
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {checkHrActivity,parseHrActivity,parseHrSignals,hrActivityLabel,normalizeText,
  normalizeHrActivityFilter,HR_ACTIVITY_LABEL_PATTERN,HR_ACTIVITY_FILTERS} from '../shared/core.js';
import {diagnosticDetails,reasonCategory,sessionDiagnostics} from '../shared/diagnostics.js';

const noon=new Date('2026-09-06T12:00:00+08:00');
const modes=['online','today','within3days','any'];
const cases=[
  ['在线',[true,true,true,true]],['当前在线',[true,true,true,true]],['正在在线',[true,true,true,true]],
  ['刚刚活跃',[false,true,true,true]],['刚刚在线',[false,true,true,true]],
  ['今日活跃',[false,true,true,true]],['今天活跃',[false,true,true,true]],['当日在线',[false,true,true,true]],
  ['昨天活跃',[false,false,true,true]],['昨日在线',[false,false,true,true]],['前天活跃',[false,false,true,true]],
  ['1天内活跃',[false,false,true,true]],['2天前活跃',[false,false,true,true]],
  ['3日内活跃',[false,false,true,true]],['三天内活跃',[false,false,true,true]],['3天前活跃',[false,false,true,true]],
  ['7日内活跃',[false,false,false,true]],['本周活跃',[false,false,false,true]],['本月活跃',[false,false,false,true]],
  ['', [false,false,false,true]],['离线',[false,false,false,true]],['在线教育',[false,false,false,true]],
  ['王老师 在线 示例公司 · HR 去App与BOSS随时沟通',[false,false,false,true]]
];
for(const [label,expected] of cases) {
  test(`活跃包含关系：${label || '未显示'}`,()=>{
    const actual=modes.map(mode=>checkHrActivity(label,mode,noon).allowed);
    assert.deepEqual(actual,expected);
    // 任一严格条件通过，其右侧的宽松条件必须全部通过。
    for(let i=0;i<actual.length;i++) if(actual[i]) assert.ok(actual.slice(i).every(Boolean));
  });
}

test('相对时间按上海当天边界判断，不能把昨天当今天；3天仍包含今天',()=>{
  const midnight=new Date('2026-09-06T00:30:00+08:00');
  for(const label of ['1小时前活跃','60分钟前','24小时前在线']) {
    assert.equal(checkHrActivity(label,'today',midnight).allowed,false);
    assert.equal(checkHrActivity(label,'within3days',midnight).allowed,true);
  }
  for(const label of ['5分钟前活跃','半小时前','1小时前活跃']) assert.equal(checkHrActivity(label,'today',noon).allowed,true);
  assert.equal(checkHrActivity('72小时前','within3days',noon).allowed,true);
  assert.equal(checkHrActivity('73小时前','within3days',noon).allowed,false);
  for(const now of [noon,midnight]) for(let hours=0;hours<=100;hours++) {
    const hr=parseHrActivity(`${hours}小时前`,now);
    assert.ok(!hr.activeToday || hr.activeWithin3Days);
  }
});

test('仅HR标签提供活跃证据；今日回复、公司名和JD在线描述不能冒充HR在线',()=>{
  assert.equal(hrActivityLabel(' ● 在线 '),'在线');
  assert.equal(hrActivityLabel('负责在线业务测试'),'');
  assert.equal(parseHrSignals('','今日回复过 在线').activeWithin3Days,false);
  assert.equal(parseHrSignals('','今日回复过').repliedToday,true);
  assert.equal(parseHrSignals('今日活跃','').repliedToday,false);
  assert.equal(parseHrSignals('今日回复过','').activeToday,false);
  assert.equal(checkHrActivity('','today').code,'hr_activity_unknown');
  assert.equal(checkHrActivity('本周活跃','today').code,'hr_activity_filtered');
  assert.match(checkHrActivity('','today').reason,/不等于HR不活跃/);
  assert.equal(normalizeHrActivityFilter('invalid'),'within3days');
});

test('筛选日志保留选项、原标签、字段来源，未知标签计条件跳过而非读取故障',()=>{
  const check=checkHrActivity('','today');
  assert.equal(reasonCategory(check.reason,'skipped'),'filtered');
  const details=diagnosticDetails({code:check.code,hrActivityFilter:'today',hrActivityLabel:'刚刚活跃',hrActivitySource:'recruiter_badge',apiKey:'must-not-leak'});
  assert.equal(details.hrActivityLabel,'刚刚活跃');assert.equal(details.hrActivityFilter,'today');
  assert.equal(details.hrActivitySource,'recruiter_badge');assert.equal(details.apiKey,undefined);
  const diagnostic=sessionDiagnostics({id:'one',hrActivityFilter:'today',candidates:[{jobKey:'example',status:'skipped',reason:check.reason,job:{company:'示例'}}]});
  assert.equal(diagnostic.hrActivityFilter,'today');
});

const content=await readFile(new URL('../content.js',import.meta.url),'utf8');
test('实际开始函数把下拉选项传入本轮；确认提示展示该选项',async()=>{
  const code=content.slice(content.indexOf('  async function startRun('),content.indexOf('  async function copyGreeting('));
  for(const filter of modes) {
    const messages=[],prompts=[];let loops=0;
    const context={state:{engineBusy:false,departureSequence:0},runLimitInput:{value:'20'},hrActivitySelect:{value:filter},
      location:{pathname:'/web/geek/jobs',href:'https://www.zhipin.com/web/geek/jobs'},collectCards:()=>[{}],findDetailRoot:()=>({}),
      currentPlan:()=>({label:'测试工程师（上海）',key:'testing'}),normalizeHrActivityFilter,HR_ACTIVITY_FILTERS,
      window:{confirm:message=>{prompts.push(message);return true;}},sourceDocumentToken:'token',setNotice(){},render(){},
      async runLoop(){loops++;},async sendRuntimeMessage(message){messages.push(message);return {ok:true,publicSession:{status:'running',hrActivityFilter:filter}};}};
    vm.createContext(context);vm.runInContext(code,context);await context.startRun();
    assert.equal(messages.length,1);assert.equal(messages[0].type,'START_AUTOMATION');
    assert.equal(messages[0].hrActivityFilter,filter);assert.equal(messages[0].runLimit,20);
    assert.ok(prompts[0].includes(HR_ACTIVITY_FILTERS[filter]));assert.equal(loops,1);
  }
});
test('实际面板渲染：运行中锁定活跃选择，停止后可重新选择；重复渲染不累加文案',()=>{
  const code=content.slice(content.indexOf('  function renderAutomation('),content.indexOf('  function renderJob('));
  const nodes={};const context={state:{engineBusy:false,automation:{status:'running',hrActivityFilterLabel:'3 天内活跃'}},
    startButton:{},stopButton:{},runLimitInput:{},hrActivitySelect:{},$:key=>nodes[key] ||= {}};
  vm.createContext(context);vm.runInContext(code,context);context.renderAutomation();
  assert.equal(context.hrActivitySelect.disabled,true);assert.match(nodes['#progress'].textContent,/本轮 HR 活跃要求：3 天内活跃/);
  const progress=nodes['#progress'].textContent;context.renderAutomation();assert.equal(nodes['#progress'].textContent,progress);
  context.state.automation.status='completed';context.renderAutomation();assert.equal(context.hrActivitySelect.disabled,false);
});
test('实际加载函数：初次读取保存值，活动轮次显示锁定值，轮次外不覆盖刚手选的值',async()=>{
  const code=content.slice(content.indexOf('  async function loadState('),content.indexOf('  async function refreshJob('));
  let run={status:'idle'};
  const context={state:{},runLimitInput:{dataset:{}},hrActivitySelect:{dataset:{}},normalizeHrActivityFilter,applyContactMarkers(){},
    async sendRuntimeMessage(message){
      if(message.type==='GET_SETTINGS') return {ok:true,settings:{defaultHrActivityFilter:'today'}};
      if(message.type==='GET_AUTOMATION') return {ok:true,publicSession:run};
      return {ok:true};
    }};
  vm.createContext(context);vm.runInContext(code,context);await context.loadState();
  assert.equal(context.hrActivitySelect.value,'today');
  context.hrActivitySelect.value='any';await context.loadState();assert.equal(context.hrActivitySelect.value,'any');
  run={status:'running',hrActivityFilter:'online'};await context.loadState();assert.equal(context.hrActivitySelect.value,'online');
});
const extraction=content.slice(content.indexOf('  function extractRecruiter('),content.indexOf('  function communicationButton('));
function extract({name='杨浩',badges=['刚刚活跃'],hasContainer=true,fallback=[],hidden=[],companyLabels=[]}={}) {
  const elements=[...badges.map(text=>({text})),...hidden.map(text=>({text,hidden:true})),...companyLabels.map(text=>({text,company:true}))]
    .map(node=>({...node,closest:()=>node.company ? {} : null}));
  const root={contains:()=>true},container={tagName:'DIV',className:'job-boss-info',contains:()=>false};
  const trace={};
  const context={normalizeText,hrActivityLabel,HR_ACTIVITY_LABEL_PATTERN,document:{},root,trace,
    firstText:()=>name,renderedText:node=>node.text,
    visible(selector,scope){
      if(selector.startsWith('.boss-info')) return hasContainer ? [container] : [];
      if(scope===container) return elements.filter(n=>!n.hidden);
      return fallback.map(text=>({text}));
    }};
  vm.createContext(context);vm.runInContext(`${extraction}\nresult=extractRecruiter(root,trace);`,context);
  return {result:context.result,trace};
}
test('实际提取函数：截图杨浩/刚刚活跃被提取为独立标签',()=>{
  const {result,trace}=extract();assert.equal(result.name,'杨浩');assert.equal(result.activityText,'刚刚活跃');
  assert.equal(trace.hrActivitySource,'recruiter_badge');
});
test('实际提取函数：内联姓名+状态与无容器回退均保留标签',()=>{
  for(const fixture of [{name:'杨浩 刚刚活跃',badges:[]},{name:'',hasContainer:false,fallback:['职位描述在线教育','杨浩 刚刚活跃']}]) {
    const {result}=extract(fixture);assert.equal(result.name,'杨浩');assert.equal(result.activityText,'刚刚活跃');
  }
});
test('实际提取函数：公司在线、隐藏旧标签不冒充活跃；冲突标签不猜测',()=>{
  assert.equal(extract({badges:[],companyLabels:['在线','在线教育'],hidden:['在线']}).result.activityText,'');
  const valid=extract({badges:['刚刚活跃','刚刚活跃'],hidden:['在线']});assert.equal(valid.result.activityText,'刚刚活跃');
  const conflict=extract({badges:['在线','本周活跃']});assert.equal(conflict.result.activityText,'');
  assert.equal(conflict.trace.hrActivitySource,'conflicting_badges');
});

// 实际后台保存/启动/投递前二次验证。不会实例化或连接真实Chrome。
const store={};let listener;
globalThis.chrome={tabs:{},storage:{local:{async get(keys){return structuredClone(typeof keys==='string' ? {[keys]:store[keys]} : Array.isArray(keys) ? Object.fromEntries(keys.map(k=>[k,store[k]])) : store);},async set(data){Object.assign(store,structuredClone(data));}}},
  runtime:{getManifest:()=>({version:'0.4.15-test'}),getURL:p=>`chrome-extension://test/${p}`,onInstalled:{addListener(){}},onMessage:{addListener(fn){listener=fn;}}}};
await import('../background.js?hr-activity-regression');
const source={url:'https://www.zhipin.com/web/geek/jobs',frameId:0,documentId:'hr-source',tab:{id:11}};
const send=(message,sender=source)=>new Promise(resolve=>listener(message,sender,resolve));
function reset(){for(const key of Object.keys(store)) delete store[key];}
const begin=filter=>send({type:'START_AUTOMATION',runLimit:20,sourceUrl:source.url,sourcePlan:{label:'测试工程师（上海）',key:'testing'},...(filter===undefined ? {} : {hrActivityFilter:filter})});
const job={title:'软件测试工程师',company:'示例科技',recruiterName:'王女士',location:'上海',activityText:'在线',description:'负责Web软件功能、接口测试及上线回归。',url:'https://www.zhipin.com/job_detail/activity-test.html'};

test('默认3天内；保存与启动记住选择，活跃运行使用启动快照，下一轮才用新默认',async()=>{
  reset();const first=await begin();assert.equal(first.session.hrActivityFilter,'within3days');
  assert.equal(first.publicSession.hrActivityFilterLabel,HR_ACTIVITY_FILTERS.within3days);
  const saved=await send({type:'SAVE_HR_ACTIVITY_FILTER',value:'today'});assert.equal(saved.ok,true);
  assert.equal(store.settings.defaultHrActivityFilter,'today');assert.equal(store.automationSession.hrActivityFilter,'within3days');
  await send({type:'COMPLETE_AUTOMATION',sessionId:first.session.id,reason:'内存测试结束'});
  const next=await begin();assert.equal(next.session.hrActivityFilter,'today');
  assert.equal(store.automationArchive[0].hrActivityFilter,'within3days');
});
test('仅保存活跃选择，不清除API配置、个人摘要、图片、沟通历史和其他筛选',async()=>{
  reset();Object.assign(store,{settings:{apiKey:'fake-test-key',candidateSummary:'测试摘要',defaultRunLimit:33,defaultHrActivityFilter:'within3days'},
    resumeImage:{dataUrl:'fake-local-image'},jobHistories:{example:{attempts:[{status:'sent'}]}},dailyStats:{successfulContacts:2}});
  const before=structuredClone(store);assert.equal((await send({type:'SAVE_HR_ACTIVITY_FILTER',value:'online'})).ok,true);
  for(const key of ['resumeImage','jobHistories','dailyStats']) assert.deepEqual(store[key],before[key]);
  for(const key of Object.keys(before.settings).filter(k=>k!=='defaultHrActivityFilter')) assert.equal(store.settings[key],before.settings[key]);
  assert.equal(store.settings.defaultHrActivityFilter,'online');
});
test('无效枚举不能误变成不限；陌生页面和子框架不能保存筛选',async()=>{
  reset();await begin('today');const before=JSON.stringify(store);
  for(const value of ['not-a-filter','',null,'__proto__']) {
    assert.equal((await send({type:'SAVE_HR_ACTIVITY_FILTER',value})).ok,false);
    assert.equal((await begin(value)).ok,false);
  }
  for(const sender of [{url:'https://example.com',frameId:0},{...source,frameId:2}]) assert.equal((await send({type:'SAVE_HR_ACTIVITY_FILTER',value:'any'},sender)).ok,false);
  assert.equal(JSON.stringify(store),before);
  assert.equal((await send({type:'SAVE_HR_ACTIVITY_FILTER',value:'any'},{url:'chrome-extension://test/options.html',frameId:0})).ok,true);
});
for(const filter of modes) test(`后台投递前验证 ${filter} 与核心包含规则一致`,async()=>{
  for(const [activityText,expected] of cases) {
    reset();const run=await begin(filter);assert.equal(run.ok,true);
    const result=await send({type:'SET_PENDING_DELIVERY',delivery:{mode:'auto',automationRunId:run.session.id,job:{...job,activityText},message:'仅内存测试'}});
    assert.equal(result.ok,expected[modes.indexOf(filter)],`${filter}: ${activityText}: ${result.error}`);
    if(!result.ok) {assert.equal(store.pendingDelivery,null);assert.equal(store.automationSession.status,'running');assert.match(result.error,/hr_activity_(filtered|unknown)/);}
  }
});
test('批量HR筛选不暗中限制用户主动确认的单条手动发送',async()=>{
  reset();await send({type:'SAVE_HR_ACTIVITY_FILTER',value:'online'});
  const result=await send({type:'SET_PENDING_DELIVERY',delivery:{mode:'manual',job:{...job,activityText:''},message:'仅内存测试'}});
  assert.equal(result.ok,true);
});
