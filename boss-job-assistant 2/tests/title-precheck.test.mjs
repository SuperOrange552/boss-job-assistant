import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {precheckExplicitTitle,precheckAgency,precheckTechCompany,analyzeJob,stableJobKey,checkHrActivity} from '../shared/core.js';
import {detailFingerprint} from '../shared/page.js';
import {reasonCategory} from '../shared/diagnostics.js';

test('标题明确属于汽车、嵌入式、硬件、光学方向时提前暂缓',()=>{
  for (const title of ['ADAS测试工程师','整车测试工程师','车载软件测试','汽车测试工程师','嵌入式测试工程师',
    '伺服测试工程师','硬件测试工程师','芯片测试','光学测试工程师','EMC测试工程师']) {
    const result=precheckExplicitTitle(title);
    assert.equal(result?.decision,'postpone',title);
    assert.match(result.reasons[0],/左侧标题.*未打开详情/u);
    assert.ok(result.reasons[0].includes(title));
    assert.equal(reasonCategory(result.reasons[0],'skipped'),'filtered','早筛归入筛选不符，不混入读取失败');
    assert.equal(result.locationOk,undefined,'没有读取详情时不能宣称地点已经核对');
  }
});

test('游戏、普通软件、模糊词和否定描述不早筛，保留完整识别机会',()=>{
  for (const title of ['软件测试工程师','游戏测试棋牌类（大厂）','AI驱动测试工程师','驱动测试','软件故障注入测试',
    'Python接口自动化测试','汽车金融App软件测试','质量保障工程师','在线教育测试','shader测试工程师',
    '软件测试（非硬件）','软件测试（不涉及车载）','软件测试（不含嵌入式）']) {
    assert.equal(precheckExplicitTitle(title),null,title);
  }
});

const source=await readFile(new URL('../content.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('  async function registerJob('),source.indexOf('  async function startRun('));

async function runSimulation({blocker=''}={}) {
  const cards=[
    {jobKey:'adas-job',title:'ADAS测试工程师',company:'某大型汽车零部件公司',location:'上海',tags:['ADAS'],href:'https://www.zhipin.com/job_detail/adas-job.html'},
    {jobKey:'software-job',title:'软件测试工程师',company:'某汽车集团ICT公司',location:'上海',tags:['硬件行业'],href:'https://www.zhipin.com/job_detail/software-job.html'}
  ];
  const software={url:cards[1].href,title:cards[1].title,company:cards[1].company,location:'上海',recruiterName:'王明',
    description:'参与软件需求评审、用例设计、接口测试和回归，跟踪缺陷并验证修复结果。',tags:[],buttonText:'立即沟通',activityText:'在线'};
  const session={id:'run-test',status:'running',runLimit:1,successCount:0,scannedCount:0,skippedCount:0,seenJobKeys:[]};
  const events=[],requests=[],selected=[],registered=[],stops=[];
  let models=0,deliveries=0;
  const context={state:{engineBusy:false,stopRequested:false,job:{title:'上一条已显示软件岗位',description:'不能混入ADAS跳过记录'}},
    location:{pathname:'/web/geek/jobs'},precheckExplicitTitle,precheckAgency,precheckTechCompany,analyzeJob,stableJobKey,detailFingerprint,checkHrActivity,
    render(){},setNotice(){},async sleep(){},async waitSourceVisible(){},blockerText:()=>blocker,
    async nextCard(current){return cards.find(card=>!current.seenJobKeys.includes(card.jobKey));},
    async selectAndWait(card){selected.push(card.jobKey);assert.equal(card.jobKey,'software-job');return {...software};},
    async sendRuntimeMessage(message){
      requests.push(message.type);
      if (message.type==='GET_AUTOMATION') return {session,publicSession:session};
      if (message.type==='GET_STATE') return {cooldownUntil:0};
      if (message.type==='GET_PENDING_DELIVERY') return {};
      if (message.type==='REGISTER_AUTOMATION_JOB') {
        registered.push(message);
        const key=stableJobKey(message.job);
        assert.equal(session.seenJobKeys.includes(key),false,'同一条不应反复登记');
        session.seenJobKeys.push(key);session.scannedCount++;
        if (message.status==='skipped') session.skippedCount++;
        return {ok:true,publicSession:session};
      }
      if (message.type==='CHECK_CONTACT') return {allowed:true,eligibility:{round:1}};
      throw new Error(`非预期消息：${message.type}`);
    },
    async logEvent(...event){events.push(event);},
    async generateGreeting(){models++;return {decision:'recommend'};},
    extractCurrentJob:()=>({...software}),
    async openDelivery(){deliveries++;session.successCount++;},
    async stopRun(reason){stops.push(reason);session.status='blocked';}
  };
  vm.createContext(context);
  vm.runInContext(code,context);
  await context.runLoop();
  return {session,events,requests,selected,registered,stops,models,deliveries};
}

test('真实runLoop：ADAS记为跳过并继续软件岗位，不开ADAS详情/核对/模型，不占成功上限',async()=>{
  const result=await runSimulation();
  assert.deepEqual(result.stops,[]);
  assert.deepEqual(result.selected,['software-job']);
  assert.equal(result.models,1);assert.equal(result.deliveries,1);
  assert.equal(result.session.successCount,1);assert.equal(result.session.scannedCount,2);assert.equal(result.session.skippedCount,1);
  assert.deepEqual(result.session.seenJobKeys,['adas-job','software-job']);
  assert.deepEqual(result.registered.map(item=>item.status),['skipped','queued']);
  assert.equal(result.registered[0].job.description,'');
  assert.equal(result.registered[0].job.recruiterName,'');
  assert.equal(result.registered[0].job.company,'某大型汽车零部件公司');
  assert.equal(result.requests.includes('VERIFY_JOB_IDENTITY'),false);
  assert.equal(result.events[0][4].details.code,'explicit_title_postponed');
  assert.match(result.registered[1].job.company,/汽车/u,'公司含汽车也必须进入正常识别');
});

test('平台验证在早筛之前停止，不用跳过机制绕过平台限制',async()=>{
  const result=await runSimulation({blocker:'请完成安全验证'});
  assert.equal(result.stops.length,1);
  assert.match(result.stops[0],/安全验证/u);
  assert.equal(result.registered.length,0);assert.equal(result.selected.length,0);
  assert.equal(result.models,0);assert.equal(result.deliveries,0);
});
