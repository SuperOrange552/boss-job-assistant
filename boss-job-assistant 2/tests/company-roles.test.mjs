import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCompanyRoles,contactCompanyKey,recruiterContactKey,detailProofSnapshot,independentDetailMatches,conversationIdentityMatches,companyRoleFields} from '../shared/identity.js';
import {detailReadiness} from '../shared/page.js';
import {analyzeJob,formatPreferredGreeting} from '../shared/core.js';
import {identitySummary} from '../shared/diagnostics.js';

const observed={title:'测试工程师（电商方向）',description:'负责商城下单、退款、库存流转的接口与功能回归测试，验证跨端数据一致性。',recruiterName:'王明',detailCompany:'锐博'};
const target={jobKey:'hotel-job',company:'某大型酒店上市公司',title:observed.title};
const proof={source:'extension_detail_tab',jobKey:target.jobKey,...observed};

test('左右公司角色不固定，不猜甲方，不维护科锐等公司白名单',()=>{
  const a=resolveCompanyRoles({listingCompany:'某大型酒店上市公司',detailCompany:'锐博',recruiterCompany:'锐博',detailCompanySource:'recruiter_profile'});
  const b=resolveCompanyRoles({listingCompany:'科锐国际',detailCompany:'某智能终端公司',recruiterCompany:'科锐国际',detailCompanySource:'company_section'});
  for(const roles of [a,b]) {
    assert.equal(roles.recruitmentMode,'multi_entity');
    assert.equal(roles.employerCompany,'');
    assert.equal(roles.employerCompanyConfirmed,false);
    assert.equal(contactCompanyKey(roles),'');
  }
  assert.equal(a.recruiterCompany,'锐博');
  assert.equal(b.recruiterCompany,'科锐国际');
});

test('明确猎头标识但公司同名仍不是甲方证明，非外包不当外包',()=>{
  const agency=resolveCompanyRoles({listingCompany:'代理公司',recruiterCompany:'代理公司',agencyText:'代理公司 · 猎头顾问'});
  assert.equal(agency.recruitmentMode,'agency');
  assert.equal(contactCompanyKey(agency),'');
  assert.equal(resolveCompanyRoles({listingCompany:'自研公司',agencyText:'非外包岗位'}).recruitmentMode,'direct');
});

test('明确标注甲方才进行甲方维度防重，旧直招行为兼容',()=>{
  const role=resolveCompanyRoles({listingCompany:'外包服务商',recruiterCompany:'外包服务商',employerCompany:'甲方科技有限公司',agencyText:'猎头'});
  assert.equal(role.employerCompanyConfirmed,true);
  assert.equal(contactCompanyKey(role),'甲方科技');
  assert.equal(contactCompanyKey({company:'普通自研公司'}),'普通自研公司');
});

test('真实两公司差异只有独立岗位ID、全文、招聘者证明齐全才放行',()=>{
  assert.equal(detailReadiness(target,observed).code,'company_mismatch');
  assert.equal(detailReadiness(target,observed,null,proof).code,'ready_independent_detail');
  const ict={...target,jobKey:'ict-job',company:'深圳某大型ICT基础设施和智能终端公司',title:'测试工程师（五险一金）'};
  const ictDetail={...observed,title:ict.title,detailCompany:'科锐国际'};
  assert.equal(detailReadiness(ict,ictDetail,null,{source:'extension_detail_tab',jobKey:'ict-job',...ictDetail}).ready,true);
});

test('复制左侧ID、错误独立ID、正文或招聘者不同均不能冒充关联证据',()=>{
  for(const invalid of [{...proof,source:'left_card'},{...proof,jobKey:'other-job'},{...proof,description:'不同的正文'},{...proof,recruiterName:'李明'},{...proof,title:'软件开发'}]) {
    assert.equal(independentDetailMatches(target.jobKey,observed,invalid),false);
    assert.equal(detailReadiness(target,observed,null,invalid).ready,false);
  }
  assert.equal(independentDetailMatches('fallback-123',observed,{...proof,jobKey:'fallback-123'}),false);
  assert.equal(independentDetailMatches(target.jobKey,{...observed,recruiterName:''},{...proof,recruiterName:''}),false);
});

test('194与167字符的跨页面正文差异不阻断同岗位，证明绑定原列表快照',()=>{
  const listing={...observed,description:'列表公开岗位正文'.padEnd(194,'测')};
  const independent={...proof,description:'独立公开岗位正文'.padEnd(167,'试'),listSnapshot:detailProofSnapshot(listing)};
  assert.equal(listing.description.length,194);
  assert.equal(independent.description.length,167);
  assert.equal(independentDetailMatches(target.jobKey,listing,independent),true);
  assert.equal(detailReadiness(target,listing,null,independent).ready,true);
});

test('同页正文、标题、招聘者或公司变化不能复用已核对证明',()=>{
  const bound={...proof,description:'这是独立详情页面显示的其他附加格式，但身份仍指向同一个岗位。',listSnapshot:detailProofSnapshot(observed)};
  assert.equal(independentDetailMatches(target.jobKey,observed,bound),true);
  for (const change of [
    {description:'这是核对返回后列表里出现的另一个职位正文，不能继续发送给旧岗位。'},
    {title:'其他测试工程师'},
    {recruiterName:'李明'},
    {detailCompany:'其他公司'}
  ]) assert.equal(independentDetailMatches(target.jobKey,{...observed,...change},bound),false);
});

test('绑定快照只规范化空白，不携带列表公司、秘密或其他无关字段',()=>{
  const snapshot=detailProofSnapshot({...observed,title:'  测试工程师\n（电商方向） ',apiKey:'PRIVATE',company:'列表公司',message:'PRIVATE'});
  assert.deepEqual(Object.keys(snapshot).sort(),['description','detailCompany','recruiterName','title']);
  assert.equal(snapshot.title,'测试工程师 （电商方向）');
  const bound={...proof,listSnapshot:detailProofSnapshot(observed)};
  assert.equal(independentDetailMatches(target.jobKey,{...observed,description:` ${observed.description}\n `},bound),true);
});

test('放宽跨页正文比较不放宽独立ID、标题、招聘者和最低正文长度',()=>{
  const bound={...proof,listSnapshot:detailProofSnapshot(observed)};
  for (const invalid of [
    {...bound,source:'left_card'}, {...bound,jobKey:'other-job'},
    {...bound,title:'其他测试工程师'}, {...bound,recruiterName:'李明'},
    {...bound,description:''}, {...bound,description:'短正文'},
    {...bound,listSnapshot:{...bound.listSnapshot,description:''}}
  ]) assert.equal(independentDetailMatches(target.jobKey,observed,invalid),false);
  const short={...observed,description:'短正文'};
  assert.equal(independentDetailMatches(target.jobKey,short,{...bound,listSnapshot:detailProofSnapshot(short)}),false);
  assert.equal(independentDetailMatches('fallback-123',observed,{...bound,jobKey:'fallback-123'}),false);
});

test('没有绑定快照的旧证明保留原先完整正文相等兼容，不能静默取得新放宽权限',()=>{
  assert.equal(independentDetailMatches(target.jobKey,observed,proof),true);
  assert.equal(independentDetailMatches(target.jobKey,observed,{...proof,description:'旧证明中的另一段较长的独立页面正文，不能匹配到原来的列表快照。'}),false);
});

test('独立证明也不能放行尚未更新的旧详情或不同技术方向',()=>{
  assert.equal(detailReadiness(target,observed,{...observed,jobKey:'previous'},proof).code,'stale_detail');
  assert.equal(detailReadiness({...target,title:'测试工程师（汽车方向）'},observed,null,proof).code,'title_mismatch');
});

test('同名外包商不同HR的招聘者防重键不同，王女士不合并所有王姓HR',()=>{
  const a={recruiterName:'王明',recruiterCompany:'服务商'};
  assert.notEqual(recruiterContactKey(a),recruiterContactKey({...a,recruiterName:'李明'}));
  assert.equal(recruiterContactKey({...a,recruiterName:'王女士'}),'');
  assert.equal(recruiterContactKey({...a,recruiterName:'王女士',recruiterId:'public-123'}),'id:public-123');
});

test('会话校验要求职位和招聘者一起符合，公司名或职位名相同不足以发送',()=>{
  const job={...observed,recruiterCompany:'锐博'};
  assert.equal(conversationIdentityMatches(job,{...job}),true);
  assert.equal(conversationIdentityMatches(job,{...job,recruiterName:'李明'}),false);
  assert.equal(conversationIdentityMatches(job,{...job,title:'测试工程师'}),false);
  assert.equal(conversationIdentityMatches(job,{...job,recruiterCompany:'其他公司'}),false);
  assert.equal(conversationIdentityMatches(job,{title:job.title}),false);
});

test('外包不作为筛选排除理由，原硬件方向和列表标题仍参与筛选',()=>{
  const job={...observed,company:'任意外包商',location:'上海',recruitmentMode:'agency'};
  assert.equal(analyzeJob(job).decision,'recommend');
  assert.equal(analyzeJob({...job,listingTitle:'测试工程师-车载'}).decision,'postpone');
  const greeting=formatPreferredGreeting('老师您好，看任意外包商要做接口测试，我有3年测试经验。',job);
  assert.match(greeting,/看您这边要做接口测试/u);
  assert.doesNotMatch(greeting,/贵公司|任意外包商/u);
});

test('日志展示公司来源和角色，不保存JD全文、API Key或简历',()=>{
  const fields=companyRoleFields({...observed,...resolveCompanyRoles({listingCompany:target.company,detailCompany:'锐博',detailCompanySource:'recruiter_profile',recruiterCompany:'锐博'}),apiKey:'not-for-log',resume:'data:...'});
  const entry=identitySummary(fields);
  assert.equal(entry.detailCompanySource,'recruiter_profile');
  assert.equal(entry.recruiterCompany,'锐博');
  assert.equal('description' in entry,false);
  assert.equal('apiKey' in fields,false);
});
