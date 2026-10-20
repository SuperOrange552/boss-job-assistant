// 独立离线浏览器回归；不加载用户 Chrome 配置，不访问 BOSS，不加入默认 node --test。
// NODE_PATH=<bundled node_modules> node tests/chat-dom.browser.mjs
import './browser-execution-lock.mjs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {conversationIdentityMatches} from '../shared/identity.js';
const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
const chatSource=await readFile(new URL('../shared/chat.js',import.meta.url),'utf8');
const moduleSource=chatSource.replace(/^import[^\n]+\n/u,'').replace('export function readChatIdentity','function readChatIdentity');
const contentSource=await readFile(new URL('../content.js',import.meta.url),'utf8');
const coreSource=(await readFile(new URL('../shared/core.js',import.meta.url),'utf8')).replace(/^export /gmu,'');
const identitySource=(await readFile(new URL('../shared/identity.js',import.meta.url),'utf8')).replace(/^import[^\n]+\n/u,'').replace(/^export /gmu,'');
const functionRange=(start,end)=>contentSource.slice(contentSource.indexOf(start),contentSource.indexOf(end));
const conversationFlow=functionRange('  function destinationMatches(pending)','  async function updateDeliveryStage');
const deliveryFlow=functionRange('  async function updateDeliveryStage','  async function waitForWorkerOutcome');
const inputFunctions=functionRange('  function setInput(input, text)','  function resumeFileInputFor');
const inputLocator=functionRange('  function messageInput()','  function pendingPageContext()');
const platformCheck=functionRange('  function blockerText()','  function messageInput()');
const clickFunction=functionRange('  function safeElementClick(element)','  function ownText(element)');
const normalize='const normalizeText=value=>String(value??" ").replace(/\\u00a0/g," ").replace(/\\s+/g," ").trim();';
const oldReader=String.raw`function oldRead(input,job,trace) {
  const text=element=>normalizeText(element.innerText);
  const visible=(selector,root)=>[...root.querySelectorAll(selector)].filter(element=>{const r=element.getBoundingClientRect();return r.width>0&&r.height>0;});
  for(let root=input.parentElement,depth=0;root&&root!==document.body&&depth<10;depth++,root=root.parentElement) {
    const candidates=visible('a,button,span,div',root).filter(element=>/^查看职位(?:\s*[>›〉»])?$/u.test(text(element)));
    const links=candidates.filter(element=>!candidates.some(child=>child!==element&&element.contains(child)));
    if(links.length!==1||root.querySelector('input[placeholder*="联系人"]'))continue;
    const boundary=links[0].getBoundingClientRect().bottom+4;
    const header=visible('h1,h2,h3,span,a,div,p',root).filter(element=>{let section=element;while(section.parentElement&&section.parentElement!==root)section=section.parentElement;return section!==root&&!section.contains(input)&&section.getBoundingClientRect().bottom<=boundary&&element.getBoundingClientRect().bottom<=boundary;});
    trace.headerElementCount=header.length;trace.boundary=boundary;
    return {title:header.some(e=>text(e)===job.title)?job.title:'',recruiterName:header.some(e=>text(e)===job.recruiterName)?job.recruiterName:''};
  }
  return null;
}`;

function fixture({name='张女士',company='大润发',title='测试工程师',nested=false,semantic=true,missingName=false,titleOnlyInMessages=false,duplicate=false,contactInside=false,oldView=false,directName=false,splitCompany=false,titleAnchor=false,nestedTitle=false}={}) {
  const hr=`<div class="${semantic?'chat-title':'anonymous-header'}">${missingName?'':directName?name:`<span class="name">${name}</span>`}${splitCompany?`<span class="company-name">${company}</span><i>|</i><span class="position">人事经理</span>`:`<span class="company">${company} | 人事经理</span>`}</div>`;
  const titleMarkup=titleOnlyInMessages?'':titleAnchor?`<a class="job-name">${nestedTitle?`<span class="job-title">${title}</span>`:title}<span class="salary">10-15K</span><span class="location">上海</span></a>`:`<span class="job-name">${title}</span>`;
  const card=`<div class="job-card">${titleMarkup}<span class="salary">10-15K</span><span>上海</span><a class="view-job">查看职位</a></div>`;
  const oldMessage=`<div class="message-list"><div class="message-item"><div class="chat-title"><span class="name">张女士</span><span class="company">大润发 | 人事经理</span><span class="job-name">测试工程师</span>${oldView?'<a>查看职位</a>':''}</div></div></div>`;
  const editor='<div class="editor"><div><div><textarea id="input" placeholder="输入消息"></textarea></div></div><button>发送</button></div>';
  const middle=nested ? `${hr}<div class="nested"><div class="another"><div class="card-wrap">${card}</div>${oldMessage}${editor}</div></div>`
    : `<div class="header-section">${hr}${card}</div>${oldMessage}${editor}`;
  return `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;font:16px sans-serif}main{display:flex}.contacts{width:230px}.conversation{width:750px}
    .chat-title,.anonymous-header{display:flex;gap:16px;height:60px;align-items:center;padding:0 22px}
    .job-card{display:flex;gap:16px;align-items:center;height:60px;padding:25px 22px;background:#edf9f8}
    .view-job{margin-left:auto}.header-section{padding-bottom:30px}.message-list{height:190px;overflow:auto}.message-item{padding:30px;background:#eee}
    textarea{width:620px;height:90px}.editor{padding:15px}.contacts .name{display:block}.salary{color:red}
  </style><main><aside class="contacts"><input placeholder="搜索30天内的联系人"><span class="name">张女士</span><span class="company">大润发</span><span class="job-name">测试工程师</span></aside><section class="conversation">${contactInside?'<input placeholder="搜索联系人">':''}${middle}${duplicate?card:''}</section></main>`;
}

const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-background-networking','--disable-component-update','--no-first-run']});
let requests=0,cases=0;
try {
  const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
  await context.route('**/*',route=>{requests++;return route.abort();});
  const page=await context.newPage();
  const pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  async function read(options={}) {
    await page.setContent(fixture(options));
    await page.addScriptTag({content:`(()=>{${normalize}\n${moduleSource}\n${oldReader}\nwindow.inspectChat=()=>{const input=document.querySelector('#input');const trace={},oldTrace={};return {actual:readChatIdentity(input,trace),trace,old:oldRead(input,{title:'测试工程师',recruiterName:'张女士'},oldTrace),oldTrace};};})();`});
    cases++;
    return page.evaluate(()=>window.inspectChat());
  }
  const padded=await read();
  assert.deepEqual(padded.actual,{title:'测试工程师',recruiterName:'张女士',recruiterCompany:'大润发'});
  assert.equal(padded.oldTrace.headerElementCount,0,'旧算法在同一真实DOM/CSS中复现抬头全空');
  assert.equal(padded.old.recruiterName,'');
  assert.equal(padded.trace.conversationScope,'scoped_header');
  assert.ok(padded.trace.headerElementCount>0);
  const nested=await read({nested:true});
  assert.deepEqual(nested.actual,padded.actual,'HR抬头在岗位卡片和输入区外层也要继续向上找到');
  const structural=await read({nested:true,semantic:false});
  assert.deepEqual(structural.actual,padded.actual);
  assert.equal(structural.trace.headerSource,'preceding_local_header');
  const direct=await read({directName:true,splitCompany:true});
  assert.deepEqual(direct.actual,padded.actual,'原生class抬头支持直接姓名文本及公司/招聘职责分开的三段结构');
  assert.equal(direct.trace.recruiterSource,'header:direct_name');
  const compound=await read({directName:true,name:'张女士 大润发 人事经理'});
  assert.equal(compound.actual.recruiterName,'','无法拆解的复合抬头不得冒充真实姓名');
  assert.equal(compound.trace.recruiterSource,'header:name_missing');
  for(const nestedTitle of [false,true]) {
    const composite=await read({titleAnchor:true,nestedTitle});
    assert.deepEqual(composite.actual,padded.actual,'职位a含薪资和城市span时不把附属字段拼到标题');
  }
  const wrong=await read({name:'李女士',company:'其他公司'});
  assert.equal(wrong.actual.recruiterName,'李女士','必须读出真实错误对象，而不是返回预期姓名');
  assert.equal(wrong.actual.recruiterCompany,'其他公司');
  assert.equal(conversationIdentityMatches(padded.actual,wrong.actual),false,'真实读取的其它对象必须被最终身份核对拒绝');
  const missing=await read({missingName:true});
  assert.equal(missing.actual.recruiterName,'','禁止把左侧联系人或旧消息中的张女士补到当前会话');
  assert.equal(conversationIdentityMatches(padded.actual,missing.actual),false);
  assert.deepEqual((await read({oldView:true})).actual,padded.actual,'旧消息中的查看职位不能污染当前入口计数');
  const messageTitle=await read({titleOnlyInMessages:true});
  assert.equal(messageTitle.actual,null,'职位只在旧消息里出现不能作为当前会话的职位');
  assert.equal((await read({duplicate:true})).actual,null,'多个职位入口不可靠');
  assert.equal((await read({contactInside:true})).actual,null,'无法与联系人区隔离时不能读取');

  // 组合回归：同一真实DOM同时运行实际提取、身份报告、等待、即时核对及文字发送函数。
  // 只替换 Chrome 消息通道和最后的本地UI效果；不 mock read/inspect/wait/require/perform。
  async function combined(wrong=false) {
    await page.setContent(fixture({name:wrong?'李女士':'张女士'}));
    await page.addScriptTag({content:`(()=>{
      ${coreSource}\n${identitySource}\n${moduleSource}
      const state={stopRequested:false,deliveryInFlight:null},events=[];
      const visible=(selector,root=document)=>[...root.querySelectorAll(selector)].filter(shown);
      const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      const render=()=>{},setNotice=()=>{};
      let sent=0,recorded=0;
      const pending={id:'offline-delivery',mode:'auto',automationRunId:'offline-run',workerTabId:777,
        jobKey:'offline-job',message:'张老师您好，我有三年软件测试经验，希望进一步沟通，谢谢。',round:1,
        job:{companyRoleVersion:1,title:'测试工程师',recruiterName:'张女士',recruiterCompany:'大润发'}};
      async function sendRuntimeMessage(message){
        switch(message.type){
          case 'GET_PENDING_DELIVERY':return {pending,isWorker:true};
          case 'GET_AUTOMATION':return {session:{id:'offline-run',status:'running'}};
          case 'GET_RESUME_IMAGE_FOR_DELIVERY':return {ok:true,enabled:false};
          case 'UPDATE_PENDING_DELIVERY':return {ok:true,pending:{...pending,stage:message.stage}};
          case 'RECORD_SEND':recorded++;return {ok:true,automationSession:{id:'offline-run',status:'completed'},perSendRestSeconds:0};
          case 'CLOSE_DELIVERY_WORKER':return {ok:true};
          default:throw new Error('未允许的本地消息类型：'+message.type);
        }
      }
      async function logEvent(stage,result,reason,job,extra){events.push({stage,result,reason,...extra});}
      ${platformCheck}\n${inputLocator}\n${inputFunctions}\n${clickFunction}\n${conversationFlow}\n${deliveryFlow}
      document.querySelector('.editor button').addEventListener('click',()=>{
        const field=document.querySelector('#input'),message=document.createElement('div');
        message.className='message-item item-myself';message.textContent=field.value;
        document.querySelector('.message-list').appendChild(message);field.value='';sent++;
      });
      window.runCombined=async(wrong)=>{
        const started=Date.now();let error='';
        if(!wrong){
          const header=document.querySelector('.header-section > .chat-title');
          header.replaceChildren();
          setTimeout(()=>{header.innerHTML='<span class="name">张女士</span><span class="company">大润发 | 人事经理</span>';},450);
        }
        try {if(wrong) await waitForConversationDestination(pending,1000);else await deliver(pending);}catch(e){error=e.message;}
        return {sent,recorded,events,error,elapsed:Date.now()-started,actual:readChatIdentity(document.querySelector('#input'))};
      };
    })();`});
    cases++;
    return page.evaluate(value=>window.runCombined(value),wrong);
  }
  const joined=await combined();
  assert.equal(joined.error,'');
  assert.equal(joined.sent,1,'真实抬头迟到后实际发送流程仅点击本地发送按钮一次');
  assert.equal(joined.recorded,1,'真实组合流程仅记一次防重成功');
  assert.ok(joined.elapsed>=900,'抬头迟到和稳定期不能被跳过');
  assert.ok(joined.events.some(event=>event.stage==='聊天会话就绪'&&event.result==='loading'));
  assert.ok(joined.events.some(event=>event.stage==='聊天会话就绪'&&event.result==='ready'));
  const wrongJoined=await combined(true);
  assert.match(wrongJoined.error,/conversation_identity_timeout/u);
  assert.equal(wrongJoined.actual.recruiterName,'李女士');
  assert.equal(wrongJoined.sent,0,'真实错误HR不得点击发送');
  assert.equal(wrongJoined.recorded,0,'超时不得伪记投递成功');
  assert.deepEqual(pageErrors,[],'离线页面不可有被忽略的脚本注入错误');
  assert.equal(requests,0,'离线fixture不应触发任何网络请求');
  console.log(`PASS ${cases} offline Chrome cases; old padding bug reproduced; synthetic DOM fixture + production delivery code passed; zero network requests, one local fixture send only, zero external sends.`);
  await context.close();
} finally {await browser.close();}
