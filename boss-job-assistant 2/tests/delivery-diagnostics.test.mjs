import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {normalizeText,stableJobKey} from '../shared/core.js';
import {destinationIdentityReport,conversationIdentityMatches} from '../shared/identity.js';
import {diagnosticDetails,diagnosticPageUrl,identitySummary} from '../shared/diagnostics.js';

const source=await readFile(new URL('../content.js',import.meta.url),'utf8');
const expected={jobKey:'target-job',title:'测试工程师',recruiterName:'邓年赞',recruiterCompany:'示例科技'};

test('分项校验区分岗位ID、标题、姓名的缺失与不一致，且保留全部失败项',()=>{
  for (const [key,field] of [['jobKey','job_id'],['title','title'],['recruiterName','recruiter']]) {
    for (const [value,status] of [['','missing_observed'],['另一个值','mismatch']]) {
      const report=destinationIdentityReport(expected,{...expected,[key]:value});
      assert.equal(report.matched,false);
      assert.equal(report.code,`${field}_${status}`);
      assert.equal(report.checks.find(item=>item.field===field).observed,value);
      assert.match(report.reason,/预期/u);
    }
  }
  const report=destinationIdentityReport(expected,{jobKey:'different',title:'',recruiterName:''});
  assert.equal(report.checks.filter(item=>item.status!=='match').length,3);
  assert.equal(destinationIdentityReport(expected,{...expected,company:'外包公司'}).matched,true);
});

test('未提供独立详情就绪证据时仍采用原有判定，聊天目标校验不变',()=>{
  for (const title of ['',expected.title,'其他标题']) for (const name of ['',expected.recruiterName,'其他人']) for (const key of ['','target-job','wrong']) {
    const actual={...expected,title,recruiterName:name,jobKey:key};
    const old=actual.jobKey===expected.jobKey && normalizeText(actual.title)===normalizeText(expected.title) && normalizeText(actual.recruiterName)===normalizeText(expected.recruiterName);
    assert.equal(destinationIdentityReport(expected,actual).matched,old);
    assert.equal(destinationIdentityReport(expected,actual,'chat').matched,Boolean(conversationIdentityMatches(expected,actual)));
  }
  const missing=destinationIdentityReport(expected,null,'chat');
  assert.equal(missing.code,'conversation_scope_missing');
  assert.equal(missing.matched,false);
  const company=destinationIdentityReport(expected,{...expected,recruiterCompany:'另一公司'},'chat');
  assert.equal(company.code,'recruiter_company_mismatch');
});

test('诊断白名单去掉消息图片和原始HTML，所有字段脱敏，URL删除查询和片段',()=>{
  const secret='TEST_SECRET_VALUE';
  const raw={code:'title_mismatch',pageUrl:`https://www.zhipin.com/job_detail/target.html?securityId=${secret}#private`,
    titleSource:secret,headerSource:secret,recruiterCompanySource:secret,identityCode:'conversation_identity_loading',scopeDepth:6,
    rootFound:false,attempts:50,elapsedMs:15000,
    checks:[{field:'title',label:'标题',status:'mismatch',expected:secret,observed:'其它标题',message:'PRIVATE'},
      {field:'message',status:'mismatch',observed:'PRIVATE'}],message:'PRIVATE',resumeImage:'data:PRIVATE',html:'<body>PRIVATE</body>'};
  const safe=diagnosticDetails(raw,secret);
  const text=JSON.stringify(safe);
  assert.doesNotMatch(text,/TEST_SECRET_VALUE|PRIVATE|securityId|#private/u);
  assert.equal(safe.checks.length,1);
  assert.equal(safe.rootFound,false);
  assert.equal(safe.headerSource,'[REDACTED]');
  assert.equal(safe.recruiterCompanySource,'[REDACTED]');
  assert.equal(safe.scopeDepth,6);
  assert.equal(safe.pageUrl,'https://www.zhipin.com/job_detail/target.html');
  assert.equal(identitySummary({recruiterName:secret,description:'PRIVATE'},secret).recruiterName,'[REDACTED]');
  assert.equal(diagnosticPageUrl('https://outside.example/private'), '');
});

const inspection=source.slice(source.indexOf('  function destinationMatches(pending)'),source.indexOf('  function readConversationIdentity(job,'));
const worker=source.slice(source.indexOf('  async function runDeliveryWorker(pending,'),source.indexOf('\n  $("#refresh")'));

async function runWorker({missingName=false,wrongTitle=false,missingRoot=false,missingButton=false,missingBody=false,wrongId=false}={}) {
  let elapsed=0,clicks=0;
  const events=[],stages=[];
  const pending={id:'delivery-test',jobKey:expected.jobKey,job:{...expected,companyRoleVersion:1},automationRunId:'run-test'};
  const context={state:{},panel:{classList:{add(){}}},$:()=>({}),setNotice(){},render(){},analyzeJob:()=>({}),
    Date:{now:()=>elapsed},location:{pathname:'/job_detail/target-job.html',href:`https://www.zhipin.com/job_detail/${wrongId ? 'wrong-job' : 'target-job'}.html?securityId=TEST`},
    document:{visibilityState:'hidden',readyState:'complete'},normalizeText,stableJobKey,destinationIdentityReport,
    DELIVERY_TIMEOUTS:{detail:30000,chat:60000},
    async sleep(ms){elapsed+=ms;},blockerText:()=>'',isChatPage:()=>false,findDetailRoot:()=>missingRoot ? null : {},
    communicationButton:()=>missingButton ? null : {},
    extractCurrentJob(hint,trace){Object.assign(trace,{rootFound:!missingRoot,rootSource:'.job-detail-section',rootTag:'DIV',rootClass:'job-detail-section',titleSource:'h1',recruiterSource:missingName ? 'not_found' : '.boss-name',recruiterContainerFound:!missingName});
      return {title:missingRoot ? '' : wrongTitle ? '邓年赞' : expected.title,recruiterName:missingName || missingRoot ? '' : expected.recruiterName,description:missingRoot || missingBody ? '' : '测试岗位正文，仅用于内存判断，不得保存在日志里。'};},
    async getPendingForCurrentPage(){return {pending,workerRole:'detail'};},
    async updateDeliveryStage(p,stage){stages.push(stage);if(stage==='opening_chat') throw new Error('TEST_STOP_BEFORE_CHAT');},
    async logEvent(stage,result,reason,job,extra){events.push({stage,result,reason,...extra});},
    safeElementClick(){clicks++;}
  };
  vm.createContext(context);vm.runInContext(inspection+worker,context);
  let error;
  try {await context.runDeliveryWorker(pending,'detail');} catch(e){error=e;}
  return {events,stages,clicks,error};
}

test('运行真实临时投递循环：正文与招聘者均读空，日志保留首次与最终分项证据且不点击',async()=>{
  const result=await runWorker({missingName:true,missingBody:true});
  assert.match(result.error.message,/recruiter_missing_observed/u);
  assert.equal(result.clicks,0);
  assert.equal(result.events.length,2);
  const event=result.events[1];
  assert.equal(event.result,'read_error');
  assert.equal(event.expected.recruiterName,'邓年赞');
  assert.equal(event.observed.recruiterName,'');
  assert.equal(event.details.attempts,100);
  assert.equal(event.details.elapsedMs,30000);
  assert.equal(event.details.visibility,'hidden');
  assert.equal(event.details.recruiterSource,'not_found');
  assert.equal(event.details.communicationButtonFound,true);
  assert.equal(event.details.checks[0].status,'match');
  assert.equal(event.details.checks[1].status,'match');
});

test('多投优先：ID正确且正文加载时标题误读只提示，容器与按钮缺失仍有诊断',async()=>{
  const wrong=await runWorker({wrongTitle:true});
  assert.equal(wrong.events[1].details.code,'job_id_confirmed_display_difference');
  assert.equal(wrong.events[1].result,'ready');
  assert.equal(wrong.error.message,'TEST_STOP_BEFORE_CHAT');
  assert.equal(wrong.events[1].observed.title,'邓年赞');
  const missing=await runWorker({missingRoot:true});
  assert.equal(missing.events[1].details.rootFound,false);
  assert.equal(missing.events[1].details.descriptionLength,0);
  const button=await runWorker({missingButton:true});
  assert.equal(button.events[1].details.code,'communication_button_missing');
  assert.equal(button.events[1].details.checks.every(c=>c.status==='match'),true);
  assert.equal(button.clicks,0);
});

test('多投优先：姓名未读到但岗位ID与正文可靠可继续，真正不同的岗位ID仍不能冒充',async()=>{
  const name=await runWorker({missingName:true});
  assert.equal(name.events[1].details.code,'job_id_confirmed_display_difference');
  assert.equal(name.error.message,'TEST_STOP_BEFORE_CHAT');
  const wrong=await runWorker({wrongId:true});
  assert.equal(wrong.events[1].details.code,'job_id_mismatch');
  assert.equal(wrong.events[1].result,'read_error');
  assert.equal(wrong.clicks,0);
});

test('真实循环通过时保留成功核对证据，不伪造等待失败',async()=>{
  const result=await runWorker();
  assert.equal(result.error.message,'TEST_STOP_BEFORE_CHAT');
  assert.equal(result.events[1].result,'ready');
  assert.equal(result.events[1].details.code,'identity_match');
  assert.equal(result.events[1].details.attempts,1);
});

test('日志面板实际格式函数展示逐字段结果和提取来源，支持没有新字段的旧日志',()=>{
  const code=source.slice(source.indexOf('  function formatDiagnosticEvent(event)'),source.indexOf('  async function waitSourceVisible'));
  const context={};vm.createContext(context);vm.runInContext(code,context);
  const text=context.formatDiagnosticEvent({at:'2026-09-04',stage:'临时详情身份核对',reason:'姓名未读到',extensionVersion:'0.4.8',expected,
    observed:{...expected,recruiterName:''},details:{code:'recruiter_missing_observed',pageType:'detail',recruiterSource:'not_found',checks:destinationIdentityReport(expected,{...expected,recruiterName:''}).checks}});
  assert.match(text,/岗位 ID：通过/u);assert.match(text,/招聘者姓名：页面字段未匹配/u);assert.match(text,/招聘者读取规则=not_found/u);
  assert.doesNotThrow(()=>context.formatDiagnosticEvent({reason:'旧日志',stage:'本轮停止'}));
});
