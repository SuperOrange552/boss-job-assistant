import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source = await readFile(new URL('../content.js', import.meta.url), 'utf8');
const normalizeText = value => String(value || '').replace(/\s+/gu, ' ').trim();
function code(name) {
  const match = new RegExp(`^  (?:async )?function ${name}\\(`, 'mu').exec(source);
  assert.ok(match, name);
  const start = match.index;
  const next = /^  (?:async )?function \w+\(/gmu;
  next.lastIndex = start + match[0].length;
  const end = next.exec(source)?.index ?? source.indexOf('\n  $("#refresh")', start);
  return source.slice(start, end);
}
function load(names, context) {
  vm.createContext(context);
  vm.runInContext(names.map(code).join('\n'), context);
  return context;
}

async function transition({initial = '立即沟通', stuck = false, restored = false, popup = false, delegated = false} = {}) {
  let elapsed = 2000, entered = false, clickCount = 0, popupClosed = 0, deliveries = 0;
  const events = [];
  const button = {textContent: initial, getAttribute: () => ''};
  const pending = {id:'delivery-demo',mode:'auto',stage:restored ? 'opening_chat' : 'opening_job',
    communicationActions:restored ? [{kind:'initial',buttonText:'立即沟通',at:new Date(0).toISOString()}] : [],
    job:{title:'行政专员',company:'示例公司'},round:1};
  if (restored) button.textContent = '继续沟通';
  const context = {Date:{now:() => elapsed,parse:Date.parse},state:{},panel:{classList:{add(){}}},
    $:() => ({}),setNotice(){},render(){},analyzeJob(){return {};},normalizeText,
    location:{pathname:'/job_detail/demo.html',search:''},
    deliveryTimeoutMs:(_p, key) => key === 'detailLoadTimeoutSeconds' ? 2000 : 4000,
    sleep:async ms => {elapsed += ms;},blockerText:() => '',findDetailRoot:() => ({}),
    communicationButton:() => button,communicationTargetUrl:() => '',controlEnabled:() => true,
    destinationMatches:() => true,messageInput:() => entered ? {} : null,
    updateDeliveryStage:async (p, stage) => {p.stage = stage;},
    getPendingForCurrentPage:async () => ({pending:structuredClone(pending),workerRole:'detail',delegated:delegated && clickCount > 0}),
    dismissSubscriptionReplyDialog:async () => {if (popup && clickCount > 0 && !popupClosed) {popupClosed++;return true;}return false;},
    logEvent:async (...event) => {events.push(event);},chatSurfaceDiagnostics:() => '没有输入框',
    sendRuntimeMessage:async message => {
      assert.equal(message.type,'RESERVE_COMMUNICATION_ACTION');
      if (pending.communicationActions.some(a => a.kind === message.kind)) return {ok:true,claimed:false,pending:structuredClone(pending)};
      pending.communicationActions.push({kind:message.kind,buttonText:message.buttonText,at:new Date(elapsed).toISOString()});
      pending.stage = message.kind === 'continue' ? 'continuing_chat' : 'opening_chat';
      return {ok:true,claimed:true,pending:structuredClone(pending)};
    },
    safeElementClick:() => {clickCount++;if (button.textContent === '继续沟通') entered = !stuck;else button.textContent = '继续沟通';},
    deliver:async () => {deliveries++;return true;}};
  load(['clickCommunication','continueCommunication','runDeliveryWorker'],context);
  let error;
  try {await context.runDeliveryWorker(pending,'detail');} catch (caught) {error = caught;}
  return {clickCount,popupClosed,deliveries,events,error,pending};
}

test('立即沟通只建立联系、留在详情页时，会再点击一次继续沟通并完成接续',async () => {
  const result = await transition();
  assert.equal(result.error,undefined);
  assert.equal(result.clickCount,2);
  assert.equal(result.deliveries,1);
  assert.deepEqual(result.pending.communicationActions.map(a => a.kind),['initial','continue']);
});
test('最初已经显示继续沟通时，只点击一次进入聊天',async () => {
  const result = await transition({initial:'继续沟通'});
  assert.equal(result.error,undefined);
  assert.equal(result.clickCount,1);
  assert.equal(result.deliveries,1);
});
test('详情中间页重新加载时，保留动作记录，不重做立即沟通',async () => {
  const result = await transition({restored:true});
  assert.equal(result.error,undefined);
  assert.equal(result.clickCount,1);
  assert.equal(result.deliveries,1);
  assert.ok(result.events.some(e => e[1] === 'resumed'));
});
test('订阅弹窗关闭后继续处理同一岗位的继续沟通',async () => {
  const result = await transition({popup:true});
  assert.equal(result.error,undefined);
  assert.equal(result.popupClosed,1);
  assert.equal(result.clickCount,2);
  assert.equal(result.deliveries,1);
});
test('继续沟通点击仍无效时不会反复点击或把建立沟通当作发送成功',async () => {
  const result = await transition({stuck:true});
  assert.ok(result.error);
  assert.equal(result.clickCount,2);
  assert.equal(result.deliveries,0);
});
test('聊天已交给另一个任务标签时，原详情页不重复操作',async () => {
  const result = await transition({delegated:true});
  assert.equal(result.error,undefined);
  assert.equal(result.clickCount,1);
  assert.equal(result.deliveries,0);
});

function node(tagName, {text = '',classes = '',disabled = false,children = []} = {}) {
  const element = {tagName,id:'',textContent:text,className:classes,disabled,parentElement:null,children,
    getAttribute(name){return name === 'aria-disabled' ? (this.ariaDisabled ? 'true' : null) : null;},
    contains(other){return this === other || this.children.some(child => child.contains(other));},
    closest(){let p=this;while(p){if(p.disabled || p.ariaDisabled || /(?:^|\s)(?:disabled|is-disabled)(?:\s|$)/u.test(p.className))return p;p=p.parentElement;}return null;}};
  children.forEach(child => {child.parentElement = element;});
  return element;
}
function descendants(root) {return root.children.flatMap(child => [child,...descendants(child)]);}
function selectorFixture(selectors,root) {
  return descendants(root).filter(element => {
    if (element.tagName === 'BUTTON') return selectors.split(',').includes('button');
    if (element.tagName === 'DIV' && /btn-send|send-btn|send-button/u.test(element.className)) return /\.btn-send|\.send-btn|\.send-button/u.test(selectors);
    return element.tagName === 'DIV' && selectors.split(',').includes('div');
  });
}
test('发送文字的普通外层div不会抢在真实按钮之前被点击',() => {
  const button = node('BUTTON',{text:'发送'});
  const wrapper = node('DIV',{text:'发送',children:[button]});
  const input = node('DIV');
  const editor = node('DIV',{children:[input,wrapper]});
  const body = node('BODY',{children:[editor]});
  const context = load(['sendButtonFor'],{normalizeText,document:{body,documentElement:{}},visible:selectorFixture});
  assert.equal(context.sendButtonFor(input),button);
});
test('BOSS使用明确的btn-send div作为控件时仍可识别，多个发送控件不选第一个',() => {
  const button = node('DIV',{text:'发送',classes:'btn-send'}),input=node('DIV');
  const editor=node('DIV',{children:[input,button]}),body=node('BODY',{children:[editor]});
  const context=load(['sendButtonFor'],{normalizeText,document:{body,documentElement:{}},visible:selectorFixture});
  assert.equal(context.sendButtonFor(input),button);
  const second=node('BUTTON',{text:'发送'});second.parentElement=editor;editor.children.push(second);
  assert.equal(context.sendButtonFor(input),null);
});
test('草稿、联系人列表预览、弹窗文字不能作为新增聊天消息证据',() => {
  const text='您好，希望进一步沟通',draft=node('SPAN',{text}),input=node('DIV',{text,children:[draft]});
  const editor=node('DIV',{text,children:[input]});
  const contact=node('SPAN',{text}),modal=node('SPAN',{text}),message=node('SPAN',{text});
  contact.closest=()=>({});modal.closest=()=>({});message.closest=()=>null;
  const context=load(['sentMessageNodes'],{normalizeText,visible:()=>[draft,editor,contact,modal,message]});
  const result=context.sentMessageNodes(text,input);
  assert.equal(result.size,1);assert.ok(result.has(message));
});

async function delivery({draft = '您好，希望进一步沟通',neverReady = false,missingEvidence = false,alreadyRequested = false} = {}) {
  let elapsed=0,clicks=0,writes=0,records=0,imageSends=0,imageInputs=0,field;
  const text='您好，希望进一步沟通',events=[],messages=new Set([{old:true}]);
  const pending={id:'task',mode:'auto',automationRunId:'run',stage:'opening_chat',job:{title:'行政专员',company:'示例公司'},message:text,workerTabId:55,
    ...(alreadyRequested ? {textSendRequestedAt:'2026-10-08T00:00:00Z',stage:'sending_text'} : {})};
  field=node('DIV',{text:draft});field.isConnected=true;
  const button=node('BUTTON',{text:'发送'});
  const context={normalizeText,Date:{now:() => elapsed},state:{stopRequested:false},
    sleep:async ms => {elapsed+=ms;},deliveryTimeoutMs:() => 2000,blockerText:() => '',
    waitForInput:async () => field,messageInput:() => field,inputText:input => normalizeText(input?.textContent),
    setInput:(input,value) => {writes++;input.textContent=value;},destinationMatches:() => true,
    sendButtonFor:() => {button.disabled=neverReady || elapsed<500;return button;},getComputedStyle:() => ({pointerEvents:'auto'}),
    sentMessageNodes:() => new Set(messages),waitForResumeFileInput:async () => ({sequence:++imageInputs}),
    sendResumeImage:async (_image,imageField,imageInput) => {assert.equal(imageField,field);assert.equal(imageInput.sequence,2);imageSends++;return true;},updateDeliveryStage:async (p,stage) => {p.stage=stage;},
    logEvent:async (...event) => {events.push(event);},render(){},setNotice(){},chatSurfaceDiagnostics:() => '可见草稿',
    recordDeliveredText:async () => {records++;return {ok:true,perSendRestSeconds:1};},
    sendRuntimeMessage:async message => {
      if(message.type==='GET_AUTOMATION')return {session:{id:'run',status:'running'}};
      if(message.type==='GET_RESUME_IMAGE_FOR_DELIVERY')return {ok:true,enabled:true,configured:true,image:{name:'简历.png'}};
      if(message.type==='RESERVE_TEXT_SEND')return {ok:true,claimed:true,pending:{...pending,textSendRequestedAt:'2026-10-08T00:00:00Z',stage:'sending_text'}};
      if(message.type==='CLOSE_DELIVERY_WORKER')return {ok:true};
      throw new Error(message.type);
    },
    safeElementClick:target => {
      assert.equal(target,button);clicks++;
      // 发送后的框架重绘：旧输入框保留旧文字但已脱离页面，新的输入框为空。
      field.isConnected=false;field=node('DIV',{text:''});field.isConnected=true;
      if(!missingEvidence)messages.add({new:true});
    }};
  load(['controlEnabled','controlDescription','waitForSendControl','waitForSendEvidence','deliver'],context);
  let error;try{await context.deliver(pending);}catch(caught){error=caught;}
  return {error,clicks,writes,records,imageSends,imageInputs,elapsed,pending,events};
}
test('当前任务草稿已经填入时直接沿用，等待发送按钮启用后发送文字与图片',async () => {
  const result=await delivery();
  assert.equal(result.error,undefined);
  assert.equal(result.writes,0);
  assert.equal(result.clicks,1);
  assert.equal(result.records,1);
  assert.equal(result.imageSends,1);
  assert.equal(result.imageInputs,2);
  assert.ok(result.elapsed>=1000);
  assert.ok(result.events.some(e => e[1]==='reused'));
  assert.ok(result.events.some(e => e[1]==='confirmed'));
});
test('空输入框填写一次后发送，其他内容的草稿不覆盖不发送',async () => {
  const empty=await delivery({draft:''});
  assert.equal(empty.error,undefined);assert.equal(empty.writes,1);assert.equal(empty.clicks,1);
  const other=await delivery({draft:'用户正在编辑的另一条消息'});
  assert.match(other.error.message,/其他草稿/u);assert.equal(other.writes,0);assert.equal(other.clicks,0);
});
test('按钮始终未就绪时停在准备阶段，不能把已填草稿登记为发送过',async () => {
  const result=await delivery({neverReady:true});
  assert.match(result.error.message,/未就绪/u);
  assert.equal(result.pending.stage,'preparing_text');assert.equal(result.clicks,0);assert.equal(result.records,0);
});
test('已点击发送但没有新增聊天消息时不算成功、不上传图片、不自动再点发送',async () => {
  const result=await delivery({missingEvidence:true});
  assert.match(result.error.message,/没有同时确认/u);
  assert.equal(result.clicks,1);assert.equal(result.records,0);assert.equal(result.imageSends,0);
});
test('发送请求登记后页面重新加载，不能再次发送同一任务',async () => {
  const result=await delivery({alreadyRequested:true});
  assert.equal(result.error.deliveryUncertain,true);assert.equal(result.clicks,0);assert.equal(result.records,0);
});
test('开启图片后总任务等待包含两次图片入口就绪和发送确认，不在工作页仍执行时提前放弃',async () => {
  let elapsed=0;
  const pending={id:'task',resumeRequested:true,timings:{detailLoadTimeoutSeconds:30,chatReadyTimeoutSeconds:60,sendEvidenceTimeoutSeconds:15,resumeSendTimeoutSeconds:45}};
  const context={Date:{now:()=>elapsed},state:{stopRequested:false,automation:{status:'running'}},
    deliveryTimeoutMs:(p,key)=>p.timings[key]*1000,sleep:async ms=>{elapsed+=ms;},
    render(){},setNotice(){},loadState:async()=>{},applyContactMarkers(){},waitCooldown:async()=>{},
    sendRuntimeMessage:async message=>{
      if(message.type==='GET_DELIVERY_OUTCOME')return {outcome:elapsed>=240000 ? {status:'sent',resumeImageStatus:'sent'} : null};
      if(message.type==='GET_PENDING_DELIVERY')return {pending:{stage:'sending_resume'}};
      return {session:{status:'running'},publicSession:{status:'running'}};
    }};
  load(['waitForWorkerOutcome'],context);
  const result=await context.waitForWorkerOutcome(pending);
  assert.equal(result.status,'sent');assert.ok(elapsed>=240000);
});
