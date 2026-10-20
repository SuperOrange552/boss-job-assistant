export function reasonCategory(reason = '', status = '') {
  if (status === 'sent') return 'sent';
  if (/没有完整加载|读取|身份|不一致|未稳定/u.test(reason) || status === 'read_error') return 'read_error';
  if (/话术|模型|接口请求/u.test(reason) || status === 'generation_error') return 'generation_error';
  if (/同公司|距离首次|达到当前设置的上限|后续沟通需间隔|已标记招聘者回复/u.test(reason)) return 'contact_hold';
  if (/当前暂缓方向|位置未识别|包含词.*未通过|排除词.*跳过/u.test(reason)) return 'filtered';
  return status === 'skipped' ? 'other_skip' : status || 'unknown';
}

export function diagnosticText(value = '', secret = '') {
  let text = String(value || '');
  if (secret) text = text.split(secret).join('[REDACTED]');
  return text.replace(/Bearer\s+\S+/giu, 'Bearer [REDACTED]')
    .replace(/https?:\/\/[^\s，；]+/gu, url => url.split(/[?#]/u)[0])
    .slice(0, 500);
}

export function identitySummary(value = {}) {
  return {jobKey:String(value.jobKey || '').slice(0,100), title:String(value.title || '').slice(0,160),
    company:String(value.company || '').slice(0,160), detailCompany:String(value.detailCompany || '').slice(0,160)};
}

export function sessionDiagnostics(session) {
  if (!session) return null;
  const counts = {};
  const rows = (session.candidates || []).map(row => {
    const category = reasonCategory(row.reason, row.status);
    counts[category] = (counts[category] || 0) + 1;
    return {...identitySummary({...row.job,jobKey:row.jobKey}),category,status:row.status,
      reason:diagnosticText(row.reason),at:row.updatedAt || row.createdAt || session.updatedAt};
  });
  return {id:session.id,status:session.status,startedAt:session.startedAt,updatedAt:session.updatedAt,
    sourcePlan:session.sourcePlan?.label || '',successCount:session.successCount,scannedCount:session.scannedCount,counts,rows};
}
