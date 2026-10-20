import {normalizeText, normalizeCompanyKey} from './core.js';

// 字段来自不同页面区域，不能把列表公司或招聘者所属公司直接认作合同主体/甲方。
export function resolveCompanyRoles({listingCompany='',detailCompany='',detailCompanySource='',recruiterCompany='',employerCompany='',agencyText=''}={}) {
  const values = Object.fromEntries(Object.entries({listingCompany,detailCompany,detailCompanySource,recruiterCompany,employerCompany}).map(([key,value])=>[key,normalizeText(value)]));
  const names = [values.listingCompany,values.detailCompany,values.recruiterCompany].filter(Boolean);
  const comparable = value => normalizeCompanyKey(value) || normalizeText(value);
  const multiple = new Set(names.map(comparable)).size > 1;
  const explicitAgency = /猎头|代招|委托招聘/u.test(agencyText)
    || /(?:^|[\s，。；:：])(?:外包|劳务派遣|驻场)(?:$|[\s，。；:：]|岗位|招聘|项目|服务)/u.test(agencyText);
  const recruitmentMode = multiple ? 'multi_entity' : explicitAgency ? 'agency' : 'direct';
  const employer = values.employerCompany || (recruitmentMode === 'direct' ? values.listingCompany || values.detailCompany : '');
  return {...values,companyRoleVersion:1,recruitmentMode,employerCompany:employer,
    employerCompanyConfirmed:Boolean(normalizeCompanyKey(employer)),
    recruitmentEvidence:multiple ? '页面不同区域公司名称不同，不能据此断言谁是甲方' : explicitAgency ? '页面明确标注猎头/外包/代招' : '未发现多主体信息'};
}

export function contactCompanyKey(job = {}) {
  if (job.companyRoleVersion) return job.employerCompanyConfirmed ? normalizeCompanyKey(job.employerCompany) : '';
  return normalizeCompanyKey(job.company);
}

export function recruiterContactKey(job = {}) {
  if (job.recruiterId) return `id:${String(job.recruiterId).slice(0,160)}`;
  const name = normalizeText(job.recruiterName);
  // “王女士”“陈老师”等不能当作唯一招聘者，会误锁住一家公司的多个HR。
  if (!/^[\u3400-\u9fff]{2,5}$/u.test(name) || /女士|先生|老师|经理|主管|人事|招聘/u.test(name)) return '';
  const company = normalizeCompanyKey(job.recruiterCompany);
  return company ? `name:${company}:${name}` : '';
}

export function companyRoleFields(job = {}) {
  const result = {};
  for (const key of ['listingTitle','listingCompany','detailCompany','detailCompanySource','recruiterCompany','employerCompany','recruitmentMode','recruitmentEvidence','recruiterName','recruiterId']) {
    if (job[key] !== undefined) result[key] = String(job[key] || '').slice(0,200);
  }
  if (job.companyRoleVersion) {
    result.companyRoleVersion = 1;
    result.employerCompanyConfirmed = job.employerCompanyConfirmed === true;
  }
  return result;
}

// 绑定发起核对时的列表详情；不能把一次证明套到核对期间已改变的页面内容上。
export function detailProofSnapshot(job = {}) {
  return Object.fromEntries(['title','description','recruiterName','detailCompany']
    .map(key => [key,normalizeText(job[key])]));
}

export function independentDetailMatches(expectedKey, observed, proof) {
  const current = detailProofSnapshot(observed);
  // 新证明比较同一列表页前后的快照。旧证明没有快照，仍沿用原来的严格匹配。
  const snapshotMatches = proof?.listSnapshot
    ? Object.entries(current).every(([key,value]) => value === normalizeText(proof.listSnapshot[key]))
    : current.description === normalizeText(proof?.description);
  return Boolean(expectedKey && !String(expectedKey).startsWith('fallback-')
    && proof?.source === 'extension_detail_tab' && proof.jobKey === expectedKey
    && current.title && current.title === normalizeText(proof.title)
    && current.description.length >= 20 && normalizeText(proof.description).length >= 20
    && snapshotMatches
    && current.recruiterName.length >= 2
    && current.recruiterName === normalizeText(proof.recruiterName));
}

// 聊天目标必须是同一职位和招聘者；职位名称或公司在联系人列表里出现一次不算证明。
export function conversationIdentityMatches(job, identity) {
  if (!identity) return false;
  const title = normalizeText(identity.title), recruiter = normalizeText(identity.recruiterName);
  if (!title || title !== normalizeText(job.title) || !recruiter || recruiter !== normalizeText(job.recruiterName)) return false;
  if (job.recruiterId && identity.recruiterId && job.recruiterId !== identity.recruiterId) return false;
  const actualCompany = normalizeCompanyKey(identity.recruiterCompany);
  const expectedCompany = normalizeCompanyKey(job.recruiterCompany);
  return !expectedCompany || (actualCompany && actualCompany === expectedCompany);
}

// actual 必须来自页面自身，不能从待发任务补值。独立详情ID可靠时按用户要求优先投递。
export function destinationIdentityReport(expected = {}, actual, pageType = 'detail', {detailsReady = false} = {}) {
  const observed = actual || {};
  const checks = [];
  const check = (field,label,want,got,required = true) => {
    want=normalizeText(want); got=normalizeText(got);
    const status=!required ? 'not_checked' : !want ? 'missing_expected' : !got ? 'missing_observed' : want===got ? 'match' : 'mismatch';
    checks.push({field,label,expected:want,observed:got,status});
  };
  check('job_id','岗位 ID',expected.jobKey,observed.jobKey,pageType==='detail');
  check('title','岗位标题',expected.title,observed.title);
  check('recruiter','招聘者姓名',expected.recruiterName,observed.recruiterName);
  if (pageType==='chat') {
    check('recruiter_id','招聘者 ID',expected.recruiterId,observed.recruiterId,Boolean(expected.recruiterId && observed.recruiterId));
    check('recruiter_company','招聘者所属公司',normalizeCompanyKey(expected.recruiterCompany),normalizeCompanyKey(observed.recruiterCompany),Boolean(normalizeCompanyKey(expected.recruiterCompany)));
  }
  const reliableId=Boolean(expected.jobKey && !String(expected.jobKey).startsWith('fallback-') && observed.jobKey===expected.jobKey);
  const idFirst=pageType==='detail' && reliableId && detailsReady;
  const matched=pageType==='detail'
    ? idFirst || observed.jobKey===expected.jobKey && normalizeText(observed.title)===normalizeText(expected.title)
      && normalizeText(observed.recruiterName)===normalizeText(expected.recruiterName)
    : Boolean(conversationIdentityMatches(expected,actual));
  const failures=checks.filter(item=>!['match','not_checked'].includes(item.status));
  const labels={missing_expected:'待投任务缺少该字段',missing_observed:'页面未读取到匹配字段',mismatch:'值不一致'};
  const warning=idFirst && failures.length>0;
  const code=!actual ? 'conversation_scope_missing' : warning ? 'job_id_confirmed_display_difference' : matched ? 'identity_match' : failures[0] ? `${failures[0].field}_${failures[0].status}` : 'identity_mismatch';
  return {matched,checks,code,reason:warning ? '独立岗位ID一致且正文已加载；标题/姓名显示差异仅记录提示，按多投优先继续'
    : matched ? '目标身份校验通过' : !actual ? '没有定位到可信的当前会话区域'
    : failures.map(item=>`${item.label}${labels[item.status]}：预期“${item.expected || '未提供'}”，读到“${item.observed || '未读到'}”`).join('；')};
}
