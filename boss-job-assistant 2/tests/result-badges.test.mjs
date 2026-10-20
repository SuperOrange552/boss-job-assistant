import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {jobOutcomeBadge,normalizeCompanyKey} from '../shared/core.js';
import {visibleText} from '../shared/page.js';

// 纯 Node + 最小 DOM 替身；不启动浏览器，不联网，不生成或投递消息。
const content=await readFile(new URL('../content.js',import.meta.url),'utf8');
function section(start,end) {
  const a=content.indexOf(start),b=content.indexOf(end,a+start.length);
  assert.ok(a>=0 && b>a);return content.slice(a,b);
}
const markerCode=section('  function applyContactMarkers()','  function extractDescription(');
const renderCode=section('  function render()','  async function loadState()');
const watcherCode=section('  let refreshTimer;','  // 隐藏/切换标签不等于离开文档');
const row=(status,reason,category='')=>({jobKey:'job-a',status,reason,category,at:'2026-09-07T08:00:00Z'});

for(const [fixture,label,tone] of [
  [row('skipped','左侧标题“车载测试工程师”明确包含暂缓领域：车载、adas；未打开详情','filtered'),'筛选跳过：暂缓领域：车载、adas','warning'],
  [row('skipped','HR 活跃筛选：选择当天活跃，但页面为3日内活跃','filtered'),'HR活跃不符','warning'],
  [row('skipped','自动批量暂缓猎头/外包：命中科锐国际；本条不调用模型','filtered'),'猎头/外包跳过','warning'],
  [row('skipped','自动批量暂缓大中型科技/互联网公司：命中腾讯；留给手动投递，本条不调用模型','filtered'),'大中厂留给手动','warning'],
  [row('skipped','岗位位置未识别为上海','filtered'),'筛选跳过','warning'],
  [row('skipped','距离首次沟通不足 4 小时，暂不重复发送','contact_hold'),'防重跳过','warning'],
  [row('skipped','旧版其他原因','other_skip'),'已跳过','warning'],
  [row('read_error','详情没有加载；尚未调用模型'),'读取失败','error'],
  [row('generation_error','模型接口请求超时'),'话术失败','error'],
  [row('delivery_error','[communication_entry_timeout] 点击沟通20秒未进入聊天'),'投递失败','error'],
  [row('send_state_unknown','点击发送后未取得成功证据，禁止自动重发'),'发送结果待核对','error'],
  [row('sent','第1次沟通已发送，简历图片已发送'),'已发送','success'],
  [row('sent','第1次沟通已发送，但简历图片未确认成功'),'文字已发，图片未确认成功','warning']
]) test(`卡片结果 ${fixture.status}/${label}：明确显示分类和真实原因`,()=>{
  const badge=jobOutcomeBadge(fixture);
  assert.ok(badge.text.includes(label),badge.text);assert.equal(badge.tone,tone);
  assert.ok(badge.title.includes(fixture.reason));assert.ok(badge.title.includes(fixture.at));
});
test('未处理、排队及正在发送不显示成失败；缺少原因明确写未知，不猜',()=>{
  for(const item of [undefined,{},row('queued','等待模型'),row('delivering','发送中')]) assert.equal(jobOutcomeBadge(item),null);
  assert.match(jobOutcomeBadge(row('read_error','')).text,/未保存具体原因/);
});
test('长原因保留卡片摘要和完整悬停文本，不能只剩一个“失败”标签',()=>{
  const reason='聊天页面未加载：'+'现场读取信息。'.repeat(70);
  const badge=jobOutcomeBadge(row('delivery_error',reason));
  assert.ok(badge.text.length<140);assert.ok(badge.text.endsWith('…'));assert.ok(badge.title.includes(reason));
});

let mutations=0;
class Element {
  constructor(tag='span') {this.nodeType=1;this.tagName=tag.toUpperCase();this.dataset={};this.style={};this.childNodes=[];this.attributes={};this.parentElement=null;this._text='';this.title='';}
  get textContent() {return this._text+this.childNodes.map(n=>n.textContent).join('');}
  set textContent(value) {this._text=String(value);this.childNodes=[];mutations++;}
  set innerHTML(_) {throw new Error('禁止把原因作为 HTML 注入');}
  appendChild(node) {node.parentElement=this;this.childNodes.push(node);mutations++;}
  remove() {if(this.parentElement) {this.parentElement.childNodes=this.parentElement.childNodes.filter(n=>n!==this);this.parentElement=null;mutations++;}}
  setAttribute(name,value) {this.attributes[name]=value;}
  querySelector(selector) {const key=selector.includes('contact-marker') ? 'bjaContactMarker' : 'bjaResultMarker';return this.childNodes.find(n=>n.dataset?.[key]==='1') || null;}
  closest() {return this.dataset.bjaContactMarker==='1' || this.dataset.bjaResultMarker==='1' ? this : this.parentElement?.closest() || null;}
}
function harness(rows=[],jobs={}) {
  mutations=0;
  const cards=['job-a','job-b'].map(jobKey=>({jobKey,company:'同一公司',agencyHint:false,root:new Element('div')}));
  const state={automation:{id:'run-1',results:rows},contactMarkers:{jobs,companies:{}}};
  const context={state,jobOutcomeBadge,normalizeCompanyKey,rawCards:()=>cards,document:{createElement:tag=>new Element(tag)},renderJob(){},renderAutomation(){}};
  vm.createContext(context);vm.runInContext(markerCode+renderCode,context);
  return {state,cards,apply:()=>context.applyContactMarkers(),render:()=>context.render(),marker:(index,kind='result')=>cards[index].root.querySelector(`[data-bja-${kind}-marker='1']`)};
}
test('实际卡片渲染：只按岗位ID展示原因，同公司另一条不继承失败',()=>{
  const h=harness([row('skipped','HR 活跃筛选：未识别到标签','filtered')]);h.apply();
  assert.match(h.marker(0).textContent,/HR活跃不符.*未识别到标签/);assert.equal(h.marker(1),null);
  assert.equal(h.marker(0).style.color,'#8a4b08');assert.equal(h.marker(0).attributes['aria-label'],h.marker(0).title);
});
test('失败和历史已沟通标记并存，不把历史成功说成本轮成功',()=>{
  const h=harness([row('delivery_error','本轮聊天入口超时')],{'job-a':{attempts:1}});h.apply();
  assert.match(h.marker(0,'contact').textContent,/已沟通 1 次/);assert.match(h.marker(0).textContent,/本轮投递失败.*入口超时/);
});
test('发送成功保留原已沟通标记；文字成功图片失败另加警告，不删成功防重',()=>{
  const h=harness([row('sent','第1次沟通已发送，简历图片已发送')],{'job-a':{attempts:1}});h.apply();
  assert.equal(h.marker(0),null);assert.ok(h.marker(0,'contact'));
  h.state.automation.results=[row('sent','第1次沟通已发送，但简历图片未确认成功')];h.apply();
  assert.match(h.marker(0).textContent,/文字已发，图片未确认成功/);assert.equal(h.marker(0).dataset.tone,'warning');assert.ok(h.marker(0,'contact'));
});
test('没有历史次数但已有本轮成功回执仍显示已发送',()=>{
  const h=harness([row('sent','文字已发送')]);h.apply();assert.match(h.marker(0).textContent,/本轮已发送/);
});
test('重复渲染不重复创建标记，不重复改DOM；更新原因复用同一标记',()=>{
  const h=harness([row('read_error','详情未加载')]);h.apply();const marker=h.marker(0),before=mutations;
  h.apply();assert.equal(mutations,before);assert.equal(h.marker(0),marker);
  h.state.automation.results=[row('delivery_error','聊天入口超时')];h.apply();assert.equal(h.marker(0),marker);assert.match(marker.textContent,/投递失败.*聊天入口超时/);
});
test('新轮次移除旧失败标记但不清历史已沟通；刷新同轮可从现有结果重建',()=>{
  const rows=[row('read_error','详情未加载')],h=harness(rows,{'job-a':{attempts:1}});h.apply();
  h.marker(0).remove();h.apply();assert.ok(h.marker(0));
  h.state.automation={id:'run-2',results:[]};h.apply();assert.equal(h.marker(0),null);assert.ok(h.marker(0,'contact'));
});
test('列表复用卡片DOM给其他岗位时清理旧失败标记，不能串公司',()=>{
  const h=harness([row('read_error','详情未加载')]);h.apply();h.cards[0].jobKey='job-c';h.apply();assert.equal(h.marker(0),null);
});
test('标记只通过textContent呈现不可信原因，不注入脚本',()=>{
  const h=harness([row('delivery_error','<img src=x onerror=alert(1)>')]);h.apply();assert.match(h.marker(0).textContent,/<img/);assert.equal(h.marker(0).childNodes.length,0);
});
test('实际render入口立即更新卡片，不必等下一次手动点击',()=>{
  const h=harness([row('read_error','详情未加载')]);h.render();assert.ok(h.marker(0));
});
test('来源文档已离开后不再修改旧页面标记',()=>{
  const h=harness([row('read_error','详情未加载')]);h.state.pageDeparted=true;h.apply();assert.equal(h.marker(0),null);
});
test('标记文字不进入岗位正文、HR地点或猎头判断',()=>{
  const text=value=>({nodeType:3,textContent:value});
  const root=new Element('div');root.childNodes=[text('软件测试工程师 北京')];
  const marker=new Element();marker.dataset.bjaResultMarker='1';marker.childNodes=[text('猎头外包上海汽车：上一轮跳过原因')];root.appendChild(marker);
  const contact=new Element();contact.dataset.bjaContactMarker='1';contact.childNodes=[text('历史公司 上海猎头')];root.appendChild(contact);
  assert.equal(visibleText(root,()=>({})),'软件测试工程师 北京');
  const context={host:{contains:()=>false},getComputedStyle:()=>{throw Error('标记应先被排除');}};
  vm.createContext(context);vm.runInContext(section('  function isVisible(','  function visible('),context);
  assert.equal(context.isVisible(marker),false);assert.equal(context.isVisible(contact),false);
  assert.ok(!section('  function rawCards()','  function findActiveJobLink()').includes('root.textContent'),'地点回退也必须用排除标记后的正文');
});
test('自己的标记新增、更新、移除不触发岗位重读；真实页面变化仍触发',()=>{
  let callback,timers=0;
  const context={state:{},document:{body:{}},MutationObserver:class {constructor(cb){callback=cb;}observe(){}},
    clearTimeout(){},setTimeout(){timers++;},refreshJob(){}};
  vm.createContext(context);vm.runInContext(watcherCode,context);
  const root=new Element('div'),marker=new Element();marker.dataset.bjaResultMarker='1';root.appendChild(marker);
  const child={nodeType:3,parentElement:marker};
  callback([{type:'childList',target:root,addedNodes:[marker],removedNodes:[]}]);
  callback([{type:'characterData',target:child}]);
  marker.remove();callback([{type:'childList',target:root,addedNodes:[],removedNodes:[marker]}]);
  assert.equal(timers,0);
  callback([{type:'childList',target:root,addedNodes:[new Element()],removedNodes:[]}]);assert.equal(timers,1);
});
