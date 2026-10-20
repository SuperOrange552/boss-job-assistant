import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {normalizeText,stableJobKey} from '../shared/core.js';
import {destinationIdentityReport} from '../shared/identity.js';

const source=await readFile(new URL('../content.js',import.meta.url),'utf8');
function section(start,end) {
  const from=source.indexOf(start),to=source.indexOf(end,from+start.length);
  assert.ok(from>=0 && to>from,`未找到实际生产函数段：${start}`);
  return source.slice(from,to);
}
// 执行实际 worker、发送互斥、稳定等待、填写、发送点击、发送证据和防重记录代码。
// 只替换浏览器 DOM/网络边界：聊天身份解析的真实离线 DOM 测试另有专门测试覆盖。
const flow=[
  section('  function safeElementClick(element)','  function ownText(element)'),
  section('  function messageInput()','  function resumeFileInputFor(messageField)'),
  section('  function destinationMatches(pending)','  function readConversationIdentity(job,'),
  section('  async function updateDeliveryStage(pending,','  async function waitForWorkerOutcome('),
  section('  async function runDeliveryWorker(pending,','\n  $("#refresh")'),
  section('  async function continueAfterJobError(','  async function runLoop(')
].join('\n');
const workerRecovery=section('  if (pending?.pending && pending.isWorker) {',
  '  if (pending?.pending && pending.pending.mode === "manual" && isChatPage()) {');

const job={jobKey:'chat-target',title:'软件测试工程师',recruiterName:'钟女士',recruiterCompany:'小佩网络',companyRoleVersion:1};

function harness(options={}) {
  let clock=1000,input,runStatus='running',activeId='delivery-1';
  const events=[],writes=[],clicks=[],records=[],imageCalls=[],logs=[];
  const pending={id:'delivery-1',jobKey:job.jobKey,job:{...job},workerTabId:7,
    mode:'auto',automationRunId:'run-1',round:1,message:'钟老师您好，看贵公司在招软件测试工程师，我有3年测试经验，希望进一步沟通，感谢！'};
  const location=options.entry==='detail'
    ? {pathname:'/job_detail/chat-target.html',href:'https://www.zhipin.com/job_detail/chat-target.html'}
    : {pathname:'/web/geek/chat',href:'https://www.zhipin.com/web/geek/chat'};
  const state={stopRequested:false};
  const document={visibilityState:'visible',readyState:'complete',body:{innerText:''}};
  const elapsed=()=>clock-1000;
  class TextArea {
    constructor(label) {this.label=label;this._value='';this.isConnected=true;this.className='chat-input';this.parentElement={parentElement:null};}
    set value(text) {this._value=text;writes.push({at:elapsed(),text,input:this});events.push('fill_text');}
    get value() {return this._value;}
    matches(selector) {return selector==='textarea,input';}
    focus() {}
    getAttribute(name) {return name==='placeholder' ? '输入消息' : null;}
    dispatchEvent(event) {options.onInputEvent?.(event,api);}
  }
  input=new TextArea('initial');
  const send={textContent:'发送',disabled:false,getAttribute:()=>null,click() {
    clicks.push({at:elapsed(),input});events.push('click_text');
    if (options.sendEvidence!==false) {document.body.innerText+=input.value;input._value='';}
    options.onTextClick?.(api);
  }};
  const communication={textContent:'立即沟通',tagName:'A',disabled:Boolean(options.communicationDisabled),getAttribute:name=>name==='href' ? 'javascript:;' : null,addEventListener(){},click() {
    events.push('click_communication');if(options.communicationNoop) return;
    location.pathname='/web/geek/chat';location.href='https://www.zhipin.com/web/geek/chat';
  }};
  const api={state,pending,location,document,events,writes,clicks,records,imageCalls,logs,elapsed,
    replaceInput() {input.isConnected=false;input=new TextArea('replacement');return input;},
    stopRun() {runStatus='stopped';},replaceTask() {activeId='different-delivery';},get input() {return input;}};
  const context={state,location,document,normalizeText,stableJobKey,destinationIdentityReport,
    Date:{now:()=>clock},HTMLTextAreaElement:TextArea,HTMLInputElement:class {},
    InputEvent:class {constructor(type,settings) {this.type=type;Object.assign(this,settings);}},
    Event:class {constructor(type,settings) {this.type=type;Object.assign(this,settings);}},
    panel:{classList:{add(){}}},$:()=>({}),setNotice(){},render(){},analyzeJob:()=>({}),
    async sleep(ms) {clock+=ms;options.onSleep?.(api,ms);},
    visible(selector,root) {
      if(selector.startsWith("[role='dialog']")) return options.dialogPresent ? [{}] : [];
      if (location.pathname.startsWith('/job_detail/')) return [];
      if (selector.startsWith('textarea')) return options.inputAbsent ? [] : [input];
      return root ? [send] : [send];
    },
    blockerText:()=>options.blocker?.(api) || '',
    readConversationIdentity(expected,trace) {
      Object.assign(trace,{rootFound:true,recruiterSource:'.chat-header',titleSource:'.chat-job-card'});
      const observed=options.identity ? options.identity(api) : {...job};
      return observed;
    },
    findDetailRoot:()=>({}),communicationButton:()=>communication,
    extractCurrentJob(hint,trace) {Object.assign(trace,{rootFound:true,rootSource:'.job-detail-section'});
      return {...job,description:'这是已完整加载的软件测试岗位描述，负责接口和业务功能验证。'};},
    async waitForResumeFileInput() {return options.uploadMissing ? null : {kind:'image-upload'};},
    async sendResumeImage(image,field,fileInput) {
      imageCalls.push({at:elapsed(),field,fileInput});events.push('send_image');
      assert.equal(clicks.length,1,'只有文本已发送并有成功证据后才能发送图片');
      assert.equal(field._value,'');
      if (options.imageError) throw new Error(options.imageError);
      return options.imageSuccess!==false;
    },
    async waitCooldown() {},async loadState(){},
    async logEvent(stage,result,reason,expected,extra) {logs.push({stage,result,reason,expected,...extra});},
    async sendRuntimeMessage(message) {
      if (message.type==='GET_PENDING_DELIVERY') return {ok:true,pending:{...pending,id:activeId},isWorker:true,workerRole:location.pathname.startsWith('/job_detail/') ? 'detail' : 'chat'};
      if (message.type==='GET_AUTOMATION') return {ok:true,session:{id:'run-1',status:runStatus}};
      if (message.type==='GET_RESUME_IMAGE_FOR_DELIVERY') return {ok:true,enabled:options.imageEnabled!==false,configured:true,image:{name:'简历.png',type:'image/png'}};
      if (message.type==='UPDATE_PENDING_DELIVERY') {events.push(`stage:${message.stage}`);pending.stage=message.stage;return {ok:true,pending};}
      if (message.type==='RECORD_SEND') {
        records.push(message);events.push(`record:${message.resumeImageStatus}`);
        return {ok:true,automationSession:{id:'run-1',status:runStatus},perSendRestSeconds:1};
      }
      if (message.type==='STOP_AUTOMATION') {runStatus='stopped';events.push('stop_run');return {ok:true};}
      if (message.type==='FAIL_AUTOMATION_JOB') {events.push('fail_job');logs.push({failureReport:message});return {ok:true,publicSession:{id:'run-1',status:runStatus}};}
      if (message.type==='CLOSE_DELIVERY_WORKER') {events.push('close_worker');return {ok:true};}
      if (message.type==='CLEAR_PENDING_DELIVERY') {events.push('clear_pending');return {ok:true};}
      throw new Error(`测试未实现的外部消息：${message.type}`);
    }
  };
  vm.createContext(context);vm.runInContext(`${flow}\nasync function workerEntry(pending) {${workerRecovery}}`,context);
  api.run=()=>context.runDeliveryWorker(pending,options.entry==='detail' ? 'detail' : 'chat');
  api.runEntry=()=>context.workerEntry({pending,isWorker:true,workerRole:options.entry==='detail' ? 'detail' : 'chat'});
  api.deliver=()=>context.deliver(pending);
  return api;
}

function assertNoSend(h) {assert.equal(h.writes.length,0);assert.equal(h.clicks.length,0);assert.equal(h.imageCalls.length,0);assert.equal(h.records.length,0);}

test('日志复现：沟通点击没有打开聊天，只点一次；每5秒记录入口状态，超时不冒充成功',async()=>{
  const h=harness({entry:'detail',communicationNoop:true,dialogPresent:true});
  await assert.rejects(h.run(),/communication_entry_timeout/);assertNoSend(h);
  assert.equal(h.events.filter(e=>e==='click_communication').length,1);
  const entries=h.logs.filter(e=>e.stage==='沟通入口诊断');
  assert.deepEqual(entries.map(e=>e.result),['before_click','waiting','waiting','waiting','timeout']);
  assert.ok(entries.at(-1).details.elapsedMs>=20000);
  for(const e of entries) {
    assert.equal(e.details.buttonHrefKind,'javascript');assert.equal(e.details.dialogPresent,true);
    assert.equal(e.details.chatTabBound,false);assert.equal(e.details.inputFound,false);
  }
  assert.ok(!h.events.includes('stop_run'));
});
test('沟通按钮禁用：记录禁用证据，不点击，按单岗位失败继续',async()=>{
  const h=harness({entry:'detail',communicationDisabled:true});await h.runEntry();assertNoSend(h);
  assert.equal(h.events.filter(e=>e==='click_communication').length,0);
  assert.ok(h.events.includes('fail_job'));assert.ok(!h.events.includes('stop_run'));
  assert.equal(h.logs.find(e=>e.stage==='沟通入口诊断').details.buttonDisabled,true);
});

test('真实详情 worker 进入聊天：输入框先出现，抬头4秒后才出现，等待稳定后文字图片各发送一次',async()=>{
  const h=harness({entry:'detail',identity:h=>h.elapsed()<4000 ? {title:'',recruiterName:'',recruiterCompany:''} : {...job}});
  assert.equal(await h.run(),true);
  assert.equal(h.writes.length,1);assert.equal(h.clicks.length,1);assert.equal(h.imageCalls.length,1);assert.equal(h.records.length,1);
  assert.ok(h.writes[0].at>=4600);
  assert.deepEqual(h.events,['stage:opening_job','stage:opening_chat','click_communication','stage:sending_text','fill_text','click_text','stage:sending_resume','send_image','stage:recording','record:sent','close_worker']);
  assert.ok(h.logs.some(x=>x.stage==='聊天会话就绪' && x.result==='loading'));
  assert.ok(h.logs.some(x=>x.stage==='聊天会话就绪' && x.result==='ready'));
});

for (const [label,identity] of [['招聘者一直错误',()=>({...job,recruiterName:'另一位HR'})],['字段一直为空',()=>({title:'',recruiterName:'',recruiterCompany:''})],['会话区域一直未出现',()=>null]]) {
  test(`${label}：真实聊天 worker 等待超时，不填写、不发送、不记成功`,async()=>{
    const h=harness({identity});
    await assert.rejects(h.run(),/conversation_identity_timeout/);
    assertNoSend(h);assert.ok(h.elapsed()>=20000);
    assert.equal(h.logs.at(-1).details.code,'conversation_identity_timeout');
  });
}

test('聊天页暂时显示上一位HR，切换成正确HR后可以发送',async()=>{
  const h=harness({identity:h=>({...job,recruiterName:h.elapsed()<1800 ? '上一位HR' : job.recruiterName})});
  await h.run();assert.equal(h.clicks.length,1);assert.ok(h.writes[0].at>=2400);
});

for (const [label,settings,pattern] of [
  ['用户按停止',{onSleep:h=>{if(h.elapsed()>=900) h.state.stopRequested=true;}},/delivery_cancelled/],
  ['后台自动轮次已停止',{onSleep:h=>{if(h.elapsed()>=900) h.stopRun();}},/delivery_cancelled/],
  ['任务被另一份替换',{onSleep:h=>{if(h.elapsed()>=900) h.replaceTask();}},/delivery_cancelled/],
  ['出现平台安全验证',{blocker:h=>h.elapsed()>=900 ? '请完成安全验证' : ''},/platform_blocked/]
]) {
  test(`等待聊天抬头时${label}，立即中止且零发送`,async()=>{
    const h=harness({...settings,identity:()=>null});
    await assert.rejects(h.run(),pattern);assertNoSend(h);assert.ok(h.elapsed()<20000);
    assert.ok(!h.events.includes('clear_pending'));
  });
}

test('真实 worker 外层错误恢复：等待中任务被替换，旧任务不清除新任务或停止新轮次',async()=>{
  const h=harness({identity:()=>null,onSleep:h=>{if(h.elapsed()>=900) h.replaceTask();}});
  await h.runEntry();assertNoSend(h);
  assert.ok(!h.events.includes('clear_pending'));assert.ok(!h.events.includes('stop_run'));
});

for (const options of [{identity:()=>null},{uploadMissing:true},{sendEvidence:false}]) {
  test(`实际 worker 外层将${options.uploadMissing ? '无上传入口' : options.sendEvidence===false ? '文字结果未知' : '身份超时'}交给单岗位失败处理，不停止轮次`,async()=>{
    const h=harness(options);await h.runEntry();
    assert.ok(h.events.includes('fail_job'));assert.ok(!h.events.includes('stop_run'));
    assert.equal(h.records.length,0);assert.equal(h.imageCalls.length,0);
    const report=h.logs.find(log=>log.failureReport)?.failureReport;
    assert.equal(report.deliveryId,h.pending.id);assert.equal(report.sessionId,h.pending.automationRunId);
  });
}

test('实际 worker 外层遇平台验证码仍停止，不误报为普通岗位跳过',async()=>{
  const h=harness({identity:()=>null,blocker:h=>h.elapsed()>=900 ? '请完成安全验证' : ''});
  await h.runEntry();assertNoSend(h);assert.ok(h.events.includes('stop_run'));assert.ok(!h.events.includes('fail_job'));
});

test('稳定期内身份字段发生变化，即使仍匹配，也重新等待600毫秒',async()=>{
  const h=harness({identity:h=>({...job,recruiterRole:h.elapsed()<300 ? 'HR' : '人事经理'})});
  await h.run();assert.equal(h.clicks.length,1);assert.ok(h.writes[0].at>=900);
});

test('稳定期内输入框被替换，重新稳定后才向新输入框写入',async()=>{
  let replaced=false;
  const h=harness({onSleep:h=>{if(!replaced && h.elapsed()>=300) {replaced=true;h.replaceInput();}}});
  await h.run();assert.equal(h.writes.length,1);assert.equal(h.writes[0].input,h.input);assert.ok(h.writes[0].at>=900);
});

test('文字填入之后输入框被替换，发送前即时校验失败，不点击发送、不上传图片',async()=>{
  let replaced=false;
  const h=harness({onSleep:h=>{if(!replaced && h.writes.length) {replaced=true;h.replaceInput();}}});
  await assert.rejects(h.run(),/chat_input_changed/);
  assert.equal(h.writes.length,1);assert.equal(h.clicks.length,0);assert.equal(h.imageCalls.length,0);assert.equal(h.records.length,0);
});

test('没有明确文字发送成功证据时，不发图片、不记录成功',async()=>{
  const h=harness({sendEvidence:false});
  await assert.rejects(h.run(),/没有取得明确成功证据/);
  assert.equal(h.clicks.length,1);assert.equal(h.imageCalls.length,0);assert.equal(h.records.length,0);
});

for (const options of [{imageSuccess:false},{imageError:'模拟图片上传失败'}]) {
  test(`图片${options.imageError ? '异常' : '缺少成功证据'}：文字已成功则记录文字防重和图片失败，不停止轮次`,async()=>{
    const h=harness(options);
    assert.equal(await h.run(),true);
    assert.equal(h.clicks.length,1);assert.equal(h.imageCalls.length,1);assert.equal(h.records.length,1);
    assert.equal(h.records[0].resumeImageStatus,'failed');
    assert.ok(h.events.indexOf('record:failed')>h.events.indexOf('send_image'));
    assert.ok(!h.events.includes('stop_run'));assert.ok(!h.events.includes('stage:recording'));
    assert.ok(h.logs.some(log=>log.details?.code==='resume_image_failed' && log.details.continuation==='next_job'));
  });
}

test('文本已成功后目标会话改变，不再发图片，保留文字防重记录',async()=>{
  const h=harness({identity:h=>({...job,recruiterName:h.clicks.length ? '其他HR' : job.recruiterName})});
  assert.equal(await h.run(),true);
  assert.equal(h.clicks.length,1);assert.equal(h.imageCalls.length,0);assert.equal(h.records.length,1);
  assert.equal(h.records[0].resumeImageStatus,'failed');assert.ok(!h.events.includes('stop_run'));
});

test('同一文档导航回调重复并发调用真实 deliver，只发送一次',async()=>{
  const h=harness({identity:h=>h.elapsed()<1200 ? null : {...job}});
  const result=await Promise.all([h.deliver(),h.deliver()]);
  assert.deepEqual(result,[true,false]);assert.equal(h.writes.length,1);assert.equal(h.clicks.length,1);
  assert.equal(h.imageCalls.length,1);assert.equal(h.records.length,1);assert.equal(h.state.deliveryInFlight,null);
});

test('未开启图片时，只发送文字并记录 not_requested',async()=>{
  const h=harness({imageEnabled:false});
  assert.equal(await h.run(),true);assert.equal(h.clicks.length,1);assert.equal(h.imageCalls.length,0);
  assert.equal(h.records.length,1);assert.equal(h.records[0].resumeImageStatus,'not_requested');
});
