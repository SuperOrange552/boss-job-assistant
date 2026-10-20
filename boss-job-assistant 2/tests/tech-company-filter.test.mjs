import test from 'node:test';
import assert from 'node:assert/strict';
import {MANUAL_ONLY_TECH_COMPANIES,precheckTechCompany,jobOutcomeBadge} from '../shared/core.js';
import {reasonCategory} from '../shared/diagnostics.js';

// 纯规则；公司规模名单是用户手动保留策略，不做网络查询/模型分类/真实浏览器投递。
for(const rule of MANUAL_ONLY_TECH_COMPANIES) test(`${rule.name} 的显示名/英文别名/公司角色本地识别`,()=>{
  for(const alias of rule.exactAliases || []) {
    assert.equal(precheckTechCompany({company:alias})?.code,'tech_company_manual_only',alias);
  }
  for(const alias of rule.aliases) {
    for(const job of [{listingCompany:`上海${alias}有限公司`},{company:alias},
      {listingCompany:'普通公司',recruiterCompany:alias},
      {listingCompany:'普通公司',employerCompany:alias,employerCompanyConfirmed:true}]) {
      const result=precheckTechCompany(job);
      assert.equal(result?.code,'tech_company_manual_only',JSON.stringify(job));
      assert.equal(result.decision,'postpone');assert.equal(result.category,'tech_company_manual_only');
      assert.ok(result.reasons[0].includes(rule.name));assert.match(result.reasons[0],/留给手动投递/);
      assert.equal(reasonCategory(result.reasons[0],'skipped'),'filtered');
      assert.match(jobOutcomeBadge({status:'skipped',reason:result.reasons[0]}).text,/大中厂留给手动/);
    }
  }
});

for(const job of [
  {company:'某互联网大厂'},{company:'某科技中厂'},{company:'某大型游戏公司'},
  {company:'上海某中型软件企业'},{company:'某中大型互联网公司'},
  {title:'软件测试工程师（互联网中厂）'},{title:'游戏测试（大厂，五险一金）'},
  {listingTitle:'软件测试（科技大厂）',title:'软件测试工程师'},
  {title:'QA（IT中厂）'}
]) test(`雇主明确标注 ${JSON.stringify(job)}：未具名也跳过`,()=>{
  const result=precheckTechCompany(job);assert.equal(result?.code,'tech_company_manual_only');
  assert.match(result.reasons[0],/明确标注/);
});

for(const job of [
  {company:'上海创新科技有限公司',companySize:'1000-9999人',financing:'已上市'},
  {company:'某中型机械公司'}, {company:'普通游戏公司',title:'游戏测试工程师'},
  {company:'普通产品公司',description:'使用腾讯云、阿里云、Python，客户包括字节跳动，具有大厂经验优先。'},
  {company:'普通公司',employerCompany:'腾讯',employerCompanyConfirmed:false},
  {company:'普通公司',recruiterName:'腾讯老师',tags:['互联网大厂']},
  {company:'腾讯云合作伙伴'},{company:'小米授权店'},{company:'华为代理商'},
  {company:'appletree科技'},{company:'myjdXcom测试公司'},
  {company:'上海金山科技有限公司'}, {company:'上海中兴软件有限公司'},
  {company:'上海苹果教育科技有限公司'}, {company:'小贝壳教育'},{company:'3600科技'},
  {title:'软件测试（大厂经验优先）'},{title:'软件测试（有互联网大厂背景优先）'},
  {title:'游戏测试（具备大厂工作经验）'},{title:'软件测试（非互联网大厂）'},
  {title:'软件测试（不要求大厂经验）'},{title:'软件测试（服务互联网大厂客户）'},
  {title:'软件测试（对标互联网中厂）'},{title:'软件测试（大厂同款福利）'}
]) test(`不误伤 ${JSON.stringify(job)}：不能据此认定当前雇主是大中厂`,()=>{
  assert.equal(precheckTechCompany(job),null);
});
