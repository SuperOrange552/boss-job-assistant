// 官方 v5535 render-derived fixture；不是 captured live DOM，不启动用户 Chrome profile。
// NODE_PATH=<bundled node_modules> node tests/boss-template.browser.mjs
import './browser-execution-lock.mjs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {conversationIdentityMatches} from '../shared/identity.js';

const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
const html=await readFile(new URL('./fixtures/boss-chat-v5535.html',import.meta.url),'utf8');
const source=await readFile(new URL('../shared/chat.js',import.meta.url),'utf8');
const moduleSource=source.replace(/^import[^\n]+\n/u,'').replace('export function readChatIdentity','function readChatIdentity');
const normalize='const normalizeText=value=>String(value??" ").replace(/\\u00a0/g," ").replace(/\\s+/g," ").trim();';
const expected={title:'软件测试工程师',recruiterName:'俞女士',recruiterCompany:'术锐'};

// 固定的实际旧reader快照，覆盖已加载扩展文件夹后仍可复现旧回归。
const oldModuleSource=await readFile(new URL('./fixtures/chat-reader-0.4.11.js',import.meta.url),'utf8');

const browser=await chromium.launch({headless:true,
  executablePath:process.env.BOSS_TEST_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args:['--disable-background-networking','--disable-component-update','--no-first-run']});
let requests=0,cases=0;
try {
  const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
  await context.route('**/*',route=>{requests++;return route.abort();});
  const page=await context.newPage(),pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  async function inspect(change=null,baseline=false) {
    await page.setContent(html);
    if(change) await page.evaluate(change);
    await page.addScriptTag({content:`(()=>{${normalize}\n${baseline ? oldModuleSource : moduleSource}\nwindow.inspectFixture=()=>{const trace={};return {actual:readChatIdentity(document.querySelector('#chat-input'),trace),trace};};})();`});
    cases++;
    return page.evaluate(()=>window.inspectFixture());
  }

  const old=await inspect(null,true);
  assert.deepEqual(old.actual,{title:expected.title,recruiterName:'',recruiterCompany:''},'加载的旧0.4.11 parser 应在官方 render-derived 结构复现仅标题成功');
  console.log('REPRODUCED loaded 0.4.11 parser: title read; recruiter and company empty. Evidence = render-derived fixture, NOT live DOM.');
  const current=await inspect();
  assert.deepEqual(current.actual,expected,'新版 parser 必须读取 .name-text 与 .base-info 无class直属公司span');
  assert.equal(conversationIdentityMatches(expected,current.actual),true);
  assert.match(current.trace.recruiterSource,/name-text|base.info|boss/i);

  const wrongName=await inspect(()=>{document.querySelector('.top-info-content .name-text').textContent='李女士';});
  assert.equal(wrongName.actual.recruiterName,'李女士');
  assert.equal(conversationIdentityMatches(expected,wrongName.actual),false,'不能拿联系人列表或旧消息中的预期姓名覆盖实际其它HR');
  const wrongCompany=await inspect(()=>{document.querySelector('.top-info-content .base-info > span:not([class])').textContent='其他公司';});
  assert.equal(wrongCompany.actual.recruiterCompany,'其他公司');
  assert.equal(conversationIdentityMatches(expected,wrongCompany.actual),false);

  const missingName=await inspect(()=>{document.querySelector('.top-info-content .name-content').remove();});
  assert.equal(missingName.actual?.recruiterName || '','');
  assert.equal(conversationIdentityMatches(expected,missingName.actual),false,'公司span和HR职责不能填进姓名，也不能读取旧消息/联系人');
  const hiddenName=await inspect(()=>{document.querySelector('.top-info-content .name-text').style.visibility='hidden';});
  assert.equal(hiddenName.actual?.recruiterName || '','');
  assert.equal(conversationIdentityMatches(expected,hiddenName.actual),false);

  for(const hide of [false,true]) {
    const missingCompany=await inspect(hide
      ? ()=>{document.querySelector('.top-info-content .base-info > span:not([class])').style.display='none';}
      : ()=>{document.querySelector('.top-info-content .base-info > span:not([class])').remove();});
    assert.equal(missingCompany.actual?.recruiterCompany || '','',hide ? '隐藏公司不可读' : '缺失公司不能拿base-title或旧记录代替');
    assert.equal(Boolean(conversationIdentityMatches(expected,missingCompany.actual)),false);
  }
  const hiddenHeader=await inspect(()=>{document.querySelector('.top-info-content .user-info-wrap').style.display='none';});
  assert.equal(hiddenHeader.actual?.recruiterName || '','');assert.equal(hiddenHeader.actual?.recruiterCompany || '','');
  assert.equal(conversationIdentityMatches(expected,hiddenHeader.actual),false);

  const onlyOldTitle=await inspect(()=>{document.querySelector('.top-info-content .position-name').remove();});
  assert.equal(onlyOldTitle.actual,null,'职位只在旧消息/联系人出现，不能当当前会话职位');
  const titleOnly=await inspect(()=>{document.querySelector('.top-info-content .user-info-wrap').remove();});
  assert.equal(titleOnly.actual?.title,expected.title);
  assert.equal(titleOnly.actual.recruiterName,'');assert.equal(titleOnly.actual.recruiterCompany,'');
  assert.equal(conversationIdentityMatches(expected,titleOnly.actual),false,'只有职位标题时不能放行发送');

  const roleChanged=await inspect(()=>{document.querySelector('.top-info-content .base-title').textContent='招聘主管';});
  assert.deepEqual(roleChanged.actual,expected,'职责可以变化，不能混入公司名');
  const punctuatedCompany=await inspect(()=>{document.querySelector('.top-info-content .base-info > span:not([class])').textContent='某某·科技';document.querySelector('.top-info-content .base-title').textContent='招聘经理';});
  assert.deepEqual(punctuatedCompany.actual,{...expected,recruiterCompany:'某某·科技'},'独立公司字段必须保留企业名自身的分隔符，不能按职责合并行截断');
  const hiddenRole=await inspect(()=>{document.querySelector('.top-info-content .base-title').style.display='none';});
  assert.deepEqual(hiddenRole.actual,expected);
  const noSeparator=await inspect(()=>{document.querySelector('.top-info-content .vline').remove();});
  assert.deepEqual(noSeparator.actual,expected,'公司不能靠i分隔符innerText推断');
  const fullName=await inspect(()=>{document.querySelector('.top-info-content .name-text').textContent='俞晓敏';});
  assert.equal(fullName.actual.recruiterName,'俞晓敏');assert.equal(fullName.actual.recruiterCompany,'术锐');
  const multiline=await inspect(()=>{document.querySelector('.top-info-content .name-text').textContent='  俞女士\n';document.querySelector('.top-info-content .base-info > span:not([class])').textContent=' 术锐 ';});
  assert.deepEqual(multiline.actual,expected);
  const ambiguousCompany=await inspect(()=>{const extra=document.createElement('span');extra.textContent='第二个公司';document.querySelector('.top-info-content .base-info').appendChild(extra);});
  assert.equal(ambiguousCompany.actual.recruiterCompany,'');
  assert.equal(ambiguousCompany.trace.recruiterCompanySource,'header:ambiguous_company');
  assert.equal(Boolean(conversationIdentityMatches(expected,ambiguousCompany.actual)),false,'两个无class公司候选不得随意选一个');
  const english=await inspect(()=>{document.querySelector('.top-info-content .name-text').textContent='Alice Lee';document.querySelector('.top-info-content .base-info > span:not([class])').textContent='Shanghai QA Labs';});
  assert.deepEqual(english.actual,{title:expected.title,recruiterName:'Alice Lee',recruiterCompany:'Shanghai QA Labs'});
  assert.equal(conversationIdentityMatches({title:expected.title,recruiterName:'Alice Lee',recruiterCompany:'Shanghai QA Labs'},english.actual),true);
  const titledName=await inspect(()=>{document.querySelector('.top-info-content .name-text').textContent='陈经理';document.querySelector('.top-info-content .base-title').textContent='招聘经理';});
  assert.deepEqual(titledName.actual,{title:expected.title,recruiterName:'陈经理',recruiterCompany:'术锐'},'官方精确姓名字段可含职称，base-title职责不能混入姓名');
  assert.equal(conversationIdentityMatches({title:expected.title,recruiterName:'陈经理',recruiterCompany:'术锐'},titledName.actual),true);
  const ambiguousName=await inspect(()=>{const extra=document.createElement('span');extra.className='name-text';extra.textContent='另一位HR';document.querySelector('.top-info-content .name-content').appendChild(extra);});
  assert.equal(ambiguousName.actual.recruiterName,'');
  assert.equal(ambiguousName.trace.recruiterSource,'header:ambiguous_name');
  assert.equal(Boolean(conversationIdentityMatches(expected,ambiguousName.actual)),false,'两个不同name-text仍然不能随意选择或按预期姓名挑选');

  assert.deepEqual(pageErrors,[],'离线页面不得有被忽略的脚本错误');
  assert.equal(requests,0,'fixture 不应发起任何网络请求，所有网络路由也已设置 abort');
  console.log(`PASS ${cases} isolated offline Chrome cases; fixture derived from official v5535 render code, NOT captured live DOM; zero network requests; zero external sends.`);
  await context.close();
} finally {await browser.close();}
