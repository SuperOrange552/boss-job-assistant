import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {detailReady,detailReadiness,detailFingerprint} from '../shared/page.js';
import {stableJobKey,normalizeText} from '../shared/core.js';
import {detailProofSnapshot} from '../shared/identity.js';

const source=await readFile(new URL('../content.js',import.meta.url),'utf8');
const selectionCode=source.slice(source.indexOf('  async function selectAndWait(card)'),source.indexOf('  async function nextCard(session)'));

async function simulate({refreshes=true,hideOnce=false,targetTitle='测试工程师',observedTitle=targetTitle,company='国诚投顾上海分公司',observedCompany=company,alreadySelected=false,changeAfterProbe=false,independentDescription}={}) {
  let elapsed=0,clicks=0,hidden=false,probes=0;
  const oldLink={};
  const card={jobKey:'new',company,title:targetTitle,href:'https://www.zhipin.com/job_detail/new.html',link:{},root:{scrollIntoView(){}}};
  const previous={url:'https://www.zhipin.com/job_detail/old.html',title:card.title,company:'聚水潭',detailCompany:'聚水潭',description:'负责ERP软件功能测试和自动化测试，制定测试计划并执行版本回归。'};
  const current={url:card.href,title:observedTitle,company:card.company,detailCompany:observedCompany,recruiterName:'王明',description:'负责金融软件功能测试和接口测试，使用SQL核验交易数据并完成缺陷闭环。'};
  const events=[];
  const document={visibilityState:'visible'};
  const context={state:{stopRequested:false,automation:{id:'run-test'}},document,detailReady,detailReadiness,detailFingerprint,stableJobKey,normalizeText,
    location:{href:'https://www.zhipin.com/web/geek/jobs'},
    Date:{now:()=>elapsed},
    async sleep(ms){elapsed+=ms;if(hideOnce && !hidden && elapsed>=500){hidden=true;document.visibilityState='hidden';}},
    async waitSourceVisible(){if(document.visibilityState==='hidden'){elapsed+=60000;document.visibilityState='visible';}},
    async logEvent(...event){events.push(event);},
    setNotice(){},
    async sendRuntimeMessage(message){assert.equal(message.type,'VERIFY_JOB_IDENTITY');probes++;return {ok:true,proof:{source:'extension_detail_tab',jobKey:card.jobKey,...current,description:independentDescription ?? current.description,listSnapshot:detailProofSnapshot(message.observed)}};},
    extractCurrentJob(hint){if(changeAfterProbe && probes) return {...current,description:'核对期间又出现了另一个职位的正文，与已验证岗位不一致。'};return alreadySelected ? {...current} : hint ? (refreshes && elapsed>=1200 ? {...current} : {...previous,url:card.href}) : {...previous};},
    findActiveJobLink:()=>alreadySelected ? card.link : oldLink,rawCards:()=>[card],blockerText:()=>'',safeElementClick(){clicks++;}};
  vm.createContext(context);
  vm.runInContext(selectionCode,context);
  try {return {job:await context.selectAndWait(card),clicks,probes,elapsed,events};}
  catch(error){return {error,clicks,probes,elapsed,events};}
}

test('运行真实selectAndWait函数：同名卡片已切换但旧详情仍显示时等待新详情',async()=>{
  const result=await simulate();
  assert.equal(result.error,undefined);
  assert.equal(result.job.company,'国诚投顾上海分公司');
  assert.ok(result.elapsed>=1800);
  assert.equal(result.clicks,1);
});

test('详情不更新时只点击一次并记录目标/实际公司，不能返回错误岗位',async()=>{
  const result=await simulate({refreshes:false});
  assert.match(result.error.message,/读取失败/u);
  assert.equal(result.clicks,1);
  const event=result.events.find(item=>item[1]==='read_error');
  assert.equal(event[4].expected.company,'国诚投顾上海分公司');
  assert.equal(event[4].observed.company,'聚水潭');
  assert.equal(event[4].observed.jobKey,'');
});

test('主列表隐藏60秒不吃掉可见状态的详情等待预算',async()=>{
  const result=await simulate({hideOnce:true});
  assert.equal(result.error,undefined);
  assert.ok(result.elapsed>60000);
  assert.equal(result.clicks,1);
});

test('真实读取循环：盛微蓝左右福利后缀不同，更新稳定后通过并记录两侧标题',async()=>{
  const result=await simulate({company:'盛微蓝',targetTitle:'高级测试工程师-五险一金',observedTitle:'高级测试工程师'});
  assert.equal(result.error,undefined);
  assert.equal(result.clicks,1);
  assert.ok(result.elapsed>=1800 && result.elapsed<15000);
  const ready=result.events.find(event=>event[1]==='ready');
  assert.match(ready[2],/福利后缀/u);
  assert.equal(ready[4].expected.title,'高级测试工程师-五险一金');
  assert.equal(ready[4].observed.title,'高级测试工程师');
});

test('已停在盛微蓝岗位时可以通过，不额外点击当前卡片',async()=>{
  const result=await simulate({company:'盛微蓝',targetTitle:'高级测试工程师-五险一金',observedTitle:'高级测试工程师',alreadySelected:true});
  assert.equal(result.error,undefined);
  assert.equal(result.clicks,0);
  assert.ok(result.elapsed>=600 && result.elapsed<15000);
});

test('真实读取循环：技术领域不同仍停止，日志直接指出标题不一致',async()=>{
  const result=await simulate({company:'盛微蓝',targetTitle:'高级测试工程师-五险一金',observedTitle:'高级测试工程师-车载'});
  assert.match(result.error.message,/岗位标题不一致/u);
  assert.equal(result.clicks,1);
  assert.match(result.events.find(event=>event[1]==='read_error')[2],/读到“高级测试工程师-车载”/u);
});

test('真实读取循环：甲方与招聘者公司不同，只核对一次独立详情后继续',async()=>{
  const result=await simulate({company:'某大型酒店上市公司',observedCompany:'锐博'});
  assert.equal(result.error,undefined);
  assert.equal(result.clicks,1);
  assert.equal(result.probes,1);
  assert.match(result.events.find(event=>event[1]==='ready')[2],/独立岗位链接/u);
});

test('核对返回后列表正文改变，旧证明作废且不重复开核对页',async()=>{
  const result=await simulate({company:'科锐国际',observedCompany:'客户企业',changeAfterProbe:true});
  assert.ok(result.error);
  assert.equal(result.probes,1);
  assert.equal(result.clicks,1);
});

test('真实读取循环：公司不同且跨页正文不同，绑定原列表后继续而非阻断',async()=>{
  const result=await simulate({company:'科锐国际',observedCompany:'客户企业',independentDescription:'独立详情含有不同排版及附加内容，但这是相同岗位的公开职责和要求。'});
  assert.equal(result.error,undefined);
  assert.equal(result.probes,1);
  assert.equal(result.clicks,1);
  assert.match(result.events.find(event=>event[1]==='ready')[2],/独立岗位链接/u);
});

test('跨页正文可不同并不允许核对期间同页正文变化套用证明',async()=>{
  const result=await simulate({company:'科锐国际',observedCompany:'客户企业',changeAfterProbe:true,independentDescription:'独立详情含有不同排版及附加内容，但这是相同岗位的公开职责和要求。'});
  assert.ok(result.error);
  assert.equal(result.probes,1);
  assert.equal(result.clicks,1);
});
