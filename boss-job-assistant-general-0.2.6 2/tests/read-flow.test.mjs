import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {detailReady,detailReadiness,detailFingerprint} from '../shared/page.js';
import {stableJobKey} from '../shared/core.js';

const source=await readFile(new URL('../content.js',import.meta.url),'utf8');
const selectionCode=source.slice(source.indexOf('  async function selectAndWait(card)'),source.indexOf('  async function nextCard(session)'));

async function simulate({refreshes=true,hideOnce=false,targetTitle='行政专员',observedTitle=targetTitle,company='示例行政服务公司',alreadySelected=false}={}) {
  let elapsed=0,clicks=0,hidden=false;
  const oldLink={};
  const card={jobKey:'new',company,title:targetTitle,href:'https://www.zhipin.com/job_detail/new.html',link:{},root:{scrollIntoView(){}}};
  const previous={url:'https://www.zhipin.com/job_detail/old.html',title:card.title,company:'上一家公司',detailCompany:'上一家公司',description:'负责前台接待、快递收发和办公环境维护。'};
  const current={url:card.href,title:observedTitle,company:card.company,detailCompany:card.company,description:'负责会议安排、档案管理、办公用品采购及跨部门行政协调。'};
  const events=[];
  const document={visibilityState:'visible'};
  const context={state:{stopRequested:false,settings:{detailLoadTimeoutSeconds:30}},document,detailReady,detailReadiness,detailFingerprint,stableJobKey,
    Date:{now:()=>elapsed},
    deliveryTimeoutMs(_pending,key,fallback){return key==='detailLoadTimeoutSeconds' ? 30000 : fallback;},
    async sleep(ms){elapsed+=ms;if(hideOnce && !hidden && elapsed>=500){hidden=true;document.visibilityState='hidden';}},
    async waitSourceVisible(){if(document.visibilityState==='hidden'){elapsed+=60000;document.visibilityState='visible';}},
    async logEvent(...event){events.push(event);},
    extractCurrentJob(hint){return alreadySelected ? {...current} : hint ? (refreshes && elapsed>=1200 ? {...current} : {...previous,url:card.href}) : {...previous};},
    findActiveJobLink:()=>alreadySelected ? card.link : oldLink,rawCards:()=>[card],blockerText:()=>'',safeElementClick(){clicks++;}};
  vm.createContext(context);
  vm.runInContext(selectionCode,context);
  try {return {job:await context.selectAndWait(card),clicks,elapsed,events};}
  catch(error){return {error,clicks,elapsed,events};}
}

test('运行真实selectAndWait函数：同名卡片已切换但旧详情仍显示时等待新详情',async()=>{
  const result=await simulate();
  assert.equal(result.error,undefined);
  assert.equal(result.job.company,'示例行政服务公司');
  assert.ok(result.elapsed>=1800);
  assert.equal(result.clicks,1);
});

test('详情不更新时只点击一次并记录目标/实际公司，不能返回错误岗位',async()=>{
  const result=await simulate({refreshes:false});
  assert.match(result.error.message,/读取失败/u);
  assert.equal(result.clicks,1);
  const event=result.events.find(item=>item[1]==='read_error');
  assert.equal(event[4].expected.company,'示例行政服务公司');
  assert.equal(event[4].observed.company,'上一家公司');
  assert.equal(event[4].observed.jobKey,'');
});

test('主列表隐藏60秒不吃掉可见状态的详情等待预算',async()=>{
  const result=await simulate({hideOnce:true});
  assert.equal(result.error,undefined);
  assert.ok(result.elapsed>60000);
  assert.equal(result.clicks,1);
});

test('真实读取循环：行政岗位左右福利后缀不同，更新稳定后通过并记录两侧标题',async()=>{
  const result=await simulate({company:'示例公司',targetTitle:'高级行政专员-五险一金',observedTitle:'高级行政专员'});
  assert.equal(result.error,undefined);
  assert.equal(result.clicks,1);
  assert.ok(result.elapsed>=1800 && result.elapsed<15000);
  const ready=result.events.find(event=>event[1]==='ready');
  assert.match(ready[2],/福利后缀/u);
  assert.equal(ready[4].expected.title,'高级行政专员-五险一金');
  assert.equal(ready[4].observed.title,'高级行政专员');
});

test('已停在行政岗位时可以通过，不额外点击当前卡片',async()=>{
  const result=await simulate({company:'示例公司',targetTitle:'高级行政专员-五险一金',observedTitle:'高级行政专员',alreadySelected:true});
  assert.equal(result.error,undefined);
  assert.equal(result.clicks,0);
  assert.ok(result.elapsed>=600 && result.elapsed<15000);
});

test('真实读取循环：兼职方向不同仍停止，日志直接指出标题不一致',async()=>{
  const result=await simulate({company:'示例公司',targetTitle:'高级行政专员-五险一金',observedTitle:'高级行政专员-前台兼岗'});
  assert.match(result.error.message,/岗位标题不一致/u);
  assert.equal(result.clicks,1);
  assert.match(result.events.find(event=>event[1]==='read_error')[2],/读到“高级行政专员-前台兼岗”/u);
});
