import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {visibleText, resolveCard, detailReady} from '../shared/page.js';
import {analyzeJob, cleanJobText, looksLikeCapabilityMenu, buildFocusedFallback, containsSelfDisadvantage} from '../shared/core.js';
import {diagnosticText, identitySummary, sessionDiagnostics,diagnosticDetails} from '../shared/diagnostics.js';
import {CANDIDATE_SUMMARY} from '../settings.js';

const text = value=>({nodeType:3,textContent:value});
const element = (tagName, children, style={})=>({nodeType:1,tagName,childNodes:children,style});
const styleOf = e=>({display:'block',visibility:'visible',opacity:'1',fontSize:'14px',...e.style});
const job = {title:'AI 应用测试工程师',company:'示例科技',location:'上海',description:'负责功能测试、接口测试及大模型评测，熟悉Postman和Python。'};

test('真实误判回归：iPCbcjtZGDta CSS不能变成PCB硬件关键词',()=>{
  const description = '.iPCbcjtZGDta{font-style:normal;font-weight:normal}'+job.description;
  assert.equal(analyzeJob({...job,description}).decision,'recommend');
  assert.doesNotMatch(cleanJobText(description),/iPCb/u);
  assert.equal(analyzeJob({...job,description:job.description+'需进行PCB电路板测试。'}).decision,'postpone');
});

test('可见文本不含style、隐藏水印、零字体和微小隐藏节点',()=>{
  const root=element('DIV',[
    text('岗位'),element('SPAN',[text('职责')]),
    element('STYLE',[text('.iPCbcjtZGDta{display:none}')]),
    element('SPAN',[text('BOSS隐藏汽车硬件')],{display:'none'}),
    element('SPAN',[text('嵌入式')],{visibility:'hidden'}),
    element('SPAN',[text('光学')],{fontSize:'0px'}),
    element('SPAN',[text('PCB')],{width:'0.1px',height:'0.1px',overflow:'hidden'}),
    element('P',[text('接口测试')])]);
  assert.equal(visibleText(root,styleOf),'岗位职责 接口测试');
});

test('同名岗位不回退到第一个；只接受明确选中或唯一公司对应',()=>{
  const cards=[{jobKey:'a',title:'测试工程师',company:'聚水潭'}, {jobKey:'b',title:'测试工程师',company:'国诚投顾上海分公司'}];
  assert.equal(resolveCard(cards,'测试工程师'),null);
  assert.equal(resolveCard(cards,'测试工程师','国诚投顾上海分公司').jobKey,'b');
  assert.equal(resolveCard([{...cards[0],selected:true},{...cards[1],selected:true}],'测试工程师'),null);
  assert.equal(resolveCard([cards[0],{...cards[1],selected:true}],'测试工程师').jobKey,'b');
});

test('左侧URL已换、右侧仍旧文本时不能认为加载成功',()=>{
  const before={jobKey:'a',title:'测试工程师',detailCompany:'聚水潭',description:'负责ERP业务测试和自动化测试，设计并执行测试用例。'};
  const expected={jobKey:'b',title:'测试工程师',company:'国诚投顾上海分公司'};
  assert.equal(detailReady(expected,{...before,url:'/job_detail/b.html'},before),false);
  assert.equal(detailReady(expected,{...before,detailCompany:expected.company},before),false);
  assert.equal(detailReady(expected,{...before,detailCompany:expected.company,description:'负责金融软件接口测试和功能测试，使用Python验证数据一致性。'},before),true);
});

test('短句跨多个能力组不误判为菜单，但三种工具仍要求精简',()=>{
  const greeting='陈老师您好，看贵公司在招聘测试工程师岗位，我有3年经验，能用Python编写接口自动化脚本，也参与过Web版本回归和用例设计。期待回复，感谢！';
  assert.equal(looksLikeCapabilityMenu(greeting),false);
  assert.equal(looksLikeCapabilityMenu('熟悉Postman、Python和MySQL。'),true);
});

test('备用话术只用JD和个人总结交集，不编造不会的技术',()=>{
  const greeting=buildFocusedFallback(job,CANDIDATE_SUMMARY);
  assert.match(greeting,/Python/u);
  assert.equal(containsSelfDisadvantage(greeting),false);
  assert.equal(looksLikeCapabilityMenu(greeting),false);
  assert.equal(buildFocusedFallback({...job,description:'必须使用Kotlin编写Android驱动' },'做过人工文档校对'), '');
});

test('旧版跳过日志按读取、话术、防重、筛选四类重新展示而不改原记录',()=>{
  const session={id:'old',updatedAt:'2026-09-04T04:33:32Z',candidates:[
    {status:'skipped',reason:'右侧没有完整加载“测试工程师”'},
    {status:'skipped',reason:'模型连续生成不符合要求的话术'},
    {status:'skipped',reason:'同公司其他岗位在24小时内已沟通'},
    {status:'skipped',reason:'当前暂缓方向：光学'}]};
  const result=sessionDiagnostics(session);
  assert.deepEqual(result.counts,{read_error:1,generation_error:1,contact_hold:1,filtered:1});
  assert.equal(session.candidates[0].status,'skipped');
});

test('日志身份摘要不含简历消息和URL参数，并可去除已知Key',()=>{
  assert.equal(diagnosticText('Key secret-value Bearer leaked https://example.com/jobs?token=abc','secret-value'),'Key [REDACTED] Bearer [REDACTED] https://example.com/jobs');
  const identity=identitySummary({...job,apiKey:'secret',message:'private',resumeImage:'data:...'});
  assert.equal('apiKey' in identity,false);
  assert.equal('message' in identity,false);
  assert.equal('description' in identity,false);
});

test('读取失败不累计筛选跳过，且保留日志和可见性等待入口',async()=>{
  const source=await readFile(new URL('../content.js',import.meta.url),'utf8');
  assert.ok(source.includes("type:'FAIL_AUTOMATION_JOB'"));
  assert.ok(source.includes("status = 'read_error'"));
  assert.ok(source.includes('await waitSourceVisible()'));
  assert.ok(source.includes('id="export-logs"'));
  assert.ok(source.includes('state.refreshSequence'));
  assert.ok(source.includes('detailFingerprint(current) !== detailFingerprint(job)'));
});

test('会话逐层诊断只保留结构和计数，不保存原始DOM或聊天文本',()=>{
  const secret='MOCK_API_SECRET';
  const raw={scopeStopReason:'contains_contact_list',lastScopeDepth:6,selectedScopeDepth:3,scopeAttempts:[{
    depth:3,rootTag:'DIV',rootClass:`chat-content ${secret}`,reason:'identity_incomplete',viewJobLinkCount:1,
    cardTag:'DIV',cardClass:'position-card',headerSource:'preceding_local_header',headerElementCount:1,
    headerRoots:[{tag:'DIV',className:'chat-profile',innerText:'PRIVATE_CHAT_BODY',outerHTML:'PRIVATE_HTML'}],
    headerAttempts:[{tag:'DIV',className:'chat-profile',source:'preceding_sibling',reason:'accepted',textContent:'PRIVATE_CHAT_BODY'}],
    cardAttempts:[{tag:'DIV',className:'position-card',depth:1,reason:'title_found',value:'PRIVATE_PASSWORD'}],
    fieldAttempts:[{field:'recruiter',source:'.name',matchedCount:0,acceptedCount:0,actualText:'PRIVATE_NAME'},
      {field:'recruiter_company',source:secret,matchedCount:1,acceptedCount:0,password:'PRIVATE_PASSWORD'},
      {field:'message',source:'PRIVATE_CHAT_BODY',matchedCount:1,acceptedCount:1}],
    text:'PRIVATE_CHAT_BODY',html:'PRIVATE_HTML',apiKey:secret,message:'PRIVATE_CHAT_BODY'},
    {depth:6,rootTag:'MAIN',rootClass:'chat-layout',reason:'contains_contact_list',contactSearchFound:true,contactAreaFound:false}]};
  const safe=diagnosticDetails(raw,secret),serialized=JSON.stringify(safe);
  assert.doesNotMatch(serialized,/MOCK_API_SECRET|PRIVATE_CHAT_BODY|PRIVATE_HTML|PRIVATE_PASSWORD|PRIVATE_NAME/u);
  assert.equal(safe.scopeAttempts.length,2);
  assert.equal(safe.scopeAttempts[0].fieldAttempts.length,2);
  assert.equal(safe.scopeAttempts[0].fieldAttempts[0].matchedCount,0);
  assert.equal(safe.scopeAttempts[1].reason,'contains_contact_list');
  assert.equal(safe.scopeAttempts[1].contactSearchFound,true);
  assert.equal(safe.lastScopeDepth,6);assert.equal(safe.selectedScopeDepth,3);
});

test('会话逐层诊断限制层数、节点数、字段数与值长度',()=>{
  const entry={depth:999,rootTag:'DIV',rootClass:'x'.repeat(1000),reason:'unknown',viewJobLinkCount:Infinity,
    headerRoots:Array.from({length:40},()=>({tag:'DIV',className:'node'})),
    headerAttempts:Array.from({length:40},()=>({tag:'DIV',className:'node',source:'semantic',reason:'accepted'})),
    cardAttempts:Array.from({length:40},()=>({tag:'DIV',className:'node',depth:100,reason:'title_missing'})),
    fieldAttempts:Array.from({length:40},()=>({field:'recruiter',source:'.name',matchedCount:100000000,acceptedCount:-10}))};
  const safe=diagnosticDetails({scopeAttempts:Array.from({length:40},()=>entry)});
  assert.equal(safe.scopeAttempts.length,16);
  const first=safe.scopeAttempts[0];
  assert.equal(first.depth,15);assert.equal(first.rootClass,'');assert.equal(first.viewJobLinkCount,0);
  assert.equal(first.headerRoots.length,8);assert.equal(first.headerAttempts.length,12);assert.equal(first.cardAttempts.length,7);
  assert.equal(first.fieldAttempts.length,24);assert.equal(first.fieldAttempts[0].matchedCount,100000);assert.equal(first.fieldAttempts[0].acceptedCount,0);
});
