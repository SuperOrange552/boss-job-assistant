import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeJobTitle, compareJobTitles, resolveCard, detailReady, detailReadiness} from '../shared/page.js';

const target = {jobKey:'5e4bde0dde2f476a03N42ty9EFBQ',company:'示例公司',title:'高级行政专员-五险一金'};
// 日志未保存职责全文；以下是用于校验标题和同步保护的模拟正文，不声称为该公司的真实JD。
const detail = {title:'高级行政专员',company:'示例公司',detailCompany:'示例公司',description:'负责会议安排、档案管理、办公用品采购和日常行政协调。'};

test('行政岗位福利后缀差异可通过，原始标题不被改写',()=>{
  assert.equal(detailReady(target,detail),true);
  assert.equal(detailReadiness(target,detail).code,'ready_benefit_suffix');
  assert.equal(target.title,'高级行政专员-五险一金');
  assert.equal(detail.title,'高级行政专员');
});

test('只去掉分隔符或括号之后的完整末尾福利词，支持组合',()=>{
  for(const suffix of ['-五险一金','—双休','｜周末双休',' 五险一金','（五险一金、双休）','(六险一金+年终奖)','【带薪年假】','[七险一金]','-五险一金-双休','-五险一金（双休）']) {
    assert.equal(normalizeJobTitle(`高级行政专员${suffix}`),'高级行政专员',suffix);
    assert.equal(compareJobTitles('高级行政专员',`高级行政专员${suffix}`).matches,true);
  }
  assert.equal(compareJobTitles('高级行政专员-双休',target.title).matches,true);
});

test('职位级别、兼职方向、城市、未知后缀及福利前缀不能被忽略',()=>{
  for(const title of ['行政专员','高级行政专员-前台兼岗','高级行政专员（驾驶员兼岗）','高级行政专员-杭州','高级行政专员（外包）','高级行政专员-双休系统','高级行政专员五险一金','双休-高级行政专员','高级行政专员-五险一金-前台兼岗']) {
    assert.equal(compareJobTitles(target.title,title).matches,false,title);
  }
  assert.equal(compareJobTitles('','').matches,false);
  assert.equal(compareJobTitles('五险一金','双休').matches,false);
});

test('福利后缀容差必须由独立详情公司佐证，不能借用左侧公司',()=>{
  assert.equal(detailReadiness(target,{...detail,detailCompany:''}).code,'missing_company');
  assert.equal(detailReadiness(target,{...detail,detailCompany:'另一家公司'}).code,'company_mismatch');
  assert.equal(detailReady(target,{...detail,detailCompany:''}),false);
  assert.equal(detailReady(target,{...detail,detailCompany:'另一家公司'}),false);
});

test('同公司同岗位主体也不能把上个岗位的未更新正文当成新详情',()=>{
  const before={...detail,jobKey:'different-job'};
  assert.equal(detailReadiness(target,detail,before).code,'stale_detail');
  assert.equal(detailReady(target,{...detail,description:'负责访客接待、会议室管理、合同归档及跨部门行政协调。'},before),true);
  assert.equal(detailReady(target,detail,{...detail,jobKey:target.jobKey}),true);
});

test('列表回退支持福利后缀但仍要求唯一公司对应，不取同名第一项',()=>{
  const cards=[target,{...target,jobKey:'other',company:'另一家公司'}];
  assert.equal(resolveCard(cards,detail.title),null);
  assert.equal(resolveCard(cards,detail.title,'示例公司').jobKey,target.jobKey);
  assert.equal(resolveCard([target,{...target,jobKey:'ambiguous',title:'高级行政专员-双休'}],detail.title,'示例公司'),null);
});

test('读取错误明确区分标题、公司、正文缺失，保留具体差异',()=>{
  const mismatch=detailReadiness(target,{...detail,title:'高级行政专员-前台兼岗'});
  assert.equal(mismatch.code,'title_mismatch');
  assert.match(mismatch.reason,/目标“高级行政专员-五险一金”/u);
  assert.match(mismatch.reason,/读到“高级行政专员-前台兼岗”/u);
  assert.equal(detailReadiness(target,{...detail,description:''}).code,'missing_description');
});
