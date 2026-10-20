import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {destinationIdentityReport} from '../shared/identity.js';

const source=await readFile(new URL('../content.js',import.meta.url),'utf8');
const titleCode=source.slice(source.indexOf('  function detailTitle('),source.indexOf('  function cardRoot('));

function readTitle({titles=['软件测试工程师'],banner=true,path='/job_detail/target.html'}={}) {
  const document={},root={},headings=titles.map(text=>({text}));
  const queries=[];
  const context={document,location:{pathname:path},renderedText:e=>e.text,
    // 工商信息中的name存在，但独立详情的标题读取不能走这条宽泛回退。
    exactText(){throw new Error('不能扫描正文祖先的工商name字段');},
    firstText:()=>path.includes('/job_detail/') ? '' : '列表页软件测试工程师',
    visible(selector,scope){queries.push(selector);assert.equal(scope,document);
      if(selector==='.job-primary .name h1') return banner ? headings : [];
      if(selector==='h1') return headings;
      return [];}};
  vm.createContext(context);vm.runInContext(titleCode,context);
  const trace={};return {value:context.detailTitle(root,trace),trace,queries};
}

test('鹏安数通日志回归：独立页岗位h1在正文外，不能把工商公司名称取作标题',()=>{
  const result=readTitle();
  assert.equal(result.value,'软件测试工程师');
  assert.equal(result.trace.titleSource,'独立详情顶部岗位h1');
  assert.ok(!result.queries.some(query=>query.includes('[class*=')));
});

test('独立页无已知横幅时只使用唯一可见h1，不以name或公司名称猜标题',()=>{
  assert.equal(readTitle({banner:false}).value,'软件测试工程师');
  assert.equal(readTitle({banner:false,titles:['公司名称上海鹏安数通管理咨询有限公司']}).value,'');
  assert.equal(readTitle({banner:false,titles:[]}).value,'');
  assert.equal(readTitle({banner:false,titles:['软件测试工程师','另一个岗位']}).value,'');
});

test('列表页原有明确标题读取保持不变',()=>{
  assert.equal(readTitle({path:'/web/geek/jobs'}).value,'列表页软件测试工程师');
});

test('同岗位ID与正文可靠时显示差异仅提示，不对不同ID或聊天对象取消核对',()=>{
  const expected={jobKey:'target',title:'软件测试工程师',recruiterName:'翁之韵'};
  const actual={jobKey:'target',title:'公司名称上海鹏安数通管理咨询有限公司',recruiterName:''};
  const report=destinationIdentityReport(expected,actual,'detail',{detailsReady:true});
  assert.equal(report.matched,true);assert.equal(report.code,'job_id_confirmed_display_difference');
  assert.equal(report.checks[1].status,'mismatch');
  assert.equal(destinationIdentityReport(expected,{...actual,jobKey:'another'},'detail',{detailsReady:true}).matched,false);
  assert.equal(destinationIdentityReport(expected,actual,'chat',{detailsReady:true}).matched,false);
  assert.equal(destinationIdentityReport({...expected,jobKey:'fallback-a'},{...actual,jobKey:'fallback-a'},'detail',{detailsReady:true}).matched,false);
});

test('独立详情提取不借用推荐列表的岗位标题或URL',()=>{
  const code=source.slice(source.indexOf('  function extractCurrentJob('),source.indexOf('  function escapeHtml('));
  const url='https://www.zhipin.com/job_detail/target.html';
  const context={location:{pathname:'/job_detail/target.html'},window:{location:{href:url}},findDetailRoot:()=>({}),
    findActiveJobLink(){throw new Error('独立页不应该寻找推荐列表选中项');},extractRecruiter:()=>({name:'翁之韵'}),
    communicationButton:()=>null,visible:()=>[],renderedText:()=>'',extractCompanyContext:()=>({}),extractCompany:()=>'',
    resolveCompanyRoles:()=>({}),detailTitle:()=>'',normalizeText:v=>String(v||''),extractDetailCompany:()=>'',
    extractDescription:()=>'',extractLocation:()=>'',recruiterSalutation:()=>'',document:{}};
  vm.createContext(context);vm.runInContext(code,context);
  const result=context.extractCurrentJob({title:'错误推荐标题',href:'https://www.zhipin.com/job_detail/wrong.html',link:{}});
  assert.equal(result.title,'');assert.equal(result.url,url);
});
