import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {readChatIdentity} from '../shared/chat.js';

const source=await readFile(new URL('../content.js',import.meta.url),'utf8');
const contextCode=source.slice(source.indexOf('  function extractCompanyContext(root)'),source.indexOf('  function extractCompany(root'));
const node=text=>({text,children:[],getBoundingClientRect:()=>({bottom:100}),contains:()=>false});

test('实际DOM提取函数：招聘者所属公司不被冒充成明确甲方',()=>{
  const recruiterLine=node('科锐国际 · 猎头顾问'),recruiterDirect=node('科锐国际');
  const recruiter={contains:element=>element===recruiterDirect};
  const root={querySelectorAll:()=>[]};
  const context={renderedText:element=>element.text,visible(selector,scope){
    if(selector.startsWith('.boss-info')) return [recruiter];
    if(scope===recruiter) return [recruiterLine];
    if(selector.startsWith('.job-detail-company')) return [recruiterDirect];
    return [];
  }};
  vm.createContext(context);vm.runInContext(contextCode,context);
  const result=context.extractCompanyContext(root);
  assert.equal(result.detailCompany,'科锐国际');
  assert.equal(result.detailCompanySource,'recruiter_profile');
  assert.equal(result.recruiterCompany,'科锐国际');
  assert.equal(result.employerCompany,'');
});

test('实际DOM提取函数：公司区与招聘者区分开，只有明确标签输出甲方',()=>{
  const recruiterLine=node('外包商 · 人事经理'),client=node('客户科技'),label=node('甲方公司：客户科技');
  const recruiter={contains:()=>false},root={querySelectorAll:()=>[]};
  const context={renderedText:element=>element.text,visible(selector,scope){
    if(selector.startsWith('.boss-info')) return [recruiter];
    if(scope===recruiter) return [recruiterLine];
    if(selector.startsWith('.job-detail-company')) return [client];
    return [label];
  }};
  vm.createContext(context);vm.runInContext(contextCode,context);
  const result=context.extractCompanyContext(root);
  assert.equal(result.detailCompanySource,'company_section');
  assert.equal(result.recruiterCompany,'外包商');
  assert.equal(result.employerCompany,'客户科技');
});

test('会话读取缺输入框时明确返回空，不从任务预期值或全页寻找身份',()=>{
  const trace={};
  assert.equal(readChatIdentity(null,trace),null);
  assert.equal(trace.conversationScope,'input_missing');
  assert.equal(trace.headerElementCount,0);
  assert.equal(trace.inputFound,false);
});

test('会话读取的输入框不可见时不会读取任何页面字段',()=>{
  let reads=0;
  const input={ownerDocument:{defaultView:{getComputedStyle:()=>({display:'none'})}},
    getBoundingClientRect:()=>({width:0,height:0}),get parentElement(){reads++;throw new Error('不应读取隐藏输入框的祖先');}};
  assert.equal(readChatIdentity(input),null);
  assert.equal(reads,0);
});

test('未知会话布局只给出scope_missing，不查找document.body或联系人内容',()=>{
  const document={body:{querySelectorAll(){throw new Error('不得扫描全页');}},defaultView:{getComputedStyle:()=>({})}};
  const root={parentElement:document.body,querySelector:()=>null,querySelectorAll:()=>[],matches:()=>false};
  const input={ownerDocument:document,parentElement:root,getBoundingClientRect:()=>({width:100,height:60})};
  const trace={};
  assert.equal(readChatIdentity(input,trace),null);
  assert.equal(trace.conversationScope,'scope_missing');
  assert.equal(trace.viewJobLinkCount,0);
});

test('逐层诊断保留最佳候选之后遇到的截断层，不被旧bestTrace覆盖',async()=>{
  const chatSource=await readFile(new URL('../shared/chat.js',import.meta.url),'utf8');
  const reader=chatSource.slice(chatSource.indexOf('export function readChatIdentity')).replace('export ','');
  const body={},blocked={tagName:'MAIN',className:'whole-layout',parentElement:body,matches:()=>false,querySelector:selector=>selector.startsWith('input') ? {} : null};
  const outer={tagName:'DIV',className:'outer-chat',parentElement:blocked,matches:()=>false,querySelector:()=>null};
  const inner={tagName:'DIV',className:'inner-chat',parentElement:outer,matches:()=>false,querySelector:()=>null};
  const input={ownerDocument:{body},parentElement:inner},link={contains:()=>false};
  const context={shown:()=>true,structure:element=>({tag:element.tagName||'',className:element.className||''}),CONTACT_SEARCH:'input',CONTACT_AREAS:'.contact-list',
    query:()=>[link],unsafe:()=>false,VIEW_JOB:/^查看职位$/u,text:()=> '查看职位',
    findCard:()=>({element:{tagName:'DIV',className:'position-card'},title:{value:'测试工程师',source:'job_card:.position-name'}}),
    headerRoots:()=>({elements:[{}],source:'preceding_local_header'}),
    readRecruiter(headers,field,card,trace){trace.fieldAttempts.push({field:'recruiter',source:'.name',matchedCount:0,acceptedCount:0});return {name:'',company:'',nameSource:'header:name_missing',companySource:'header:company_missing'};}};
  vm.createContext(context);vm.runInContext(reader,context);
  const trace={};context.readChatIdentity(input,trace);
  assert.equal(trace.selectedScopeDepth,0);
  assert.equal(trace.lastScopeDepth,2);
  assert.equal(trace.scopeStopReason,'contains_contact_list');
  assert.equal(trace.scopeAttempts.length,3);
  assert.equal(trace.scopeAttempts[0].rootClass,'inner-chat');
  assert.equal(trace.scopeAttempts[1].rootClass,'outer-chat');
  assert.equal(trace.scopeAttempts[2].rootClass,'whole-layout');
  assert.equal(trace.scopeAttempts[2].reason,'contains_contact_list');
  assert.equal(trace.scopeAttempts[1].fieldAttempts[0].matchedCount,0);
});

test('只读详情应答入口不含点击、消息发送或简历读取',()=>{
  const reader=source.slice(source.indexOf("if (message?.type!=='READ_ONLY_JOB_IDENTITY'"),source.indexOf('\n  await loadState();',source.indexOf("if (message?.type!=='READ_ONLY_JOB_IDENTITY'")));
  assert.match(reader,/sender.id!==chrome.runtime.id/u);
  assert.match(reader,/blockerText/u);
  assert.doesNotMatch(reader,/safeElementClick|\.click\(|openDelivery|SET_PENDING_DELIVERY|GET_RESUME/u);
});
