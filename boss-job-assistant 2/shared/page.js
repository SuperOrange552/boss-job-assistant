import { normalizeText, normalizeCompanyKey } from './core.js';
import {independentDetailMatches} from './identity.js';

// Only read rendered job text. Hidden watermark spans and STYLE nodes are not job requirements.
export function visibleText(root, styleOf = element => getComputedStyle(element), skipElement = () => false) {
  const blocks = /^(DIV|P|LI|UL|OL|H[1-6]|SECTION|ARTICLE|HEADER|FOOTER|BR)$/u;
  function walk(node) {
    if (node.nodeType === 3) return node.textContent || '';
    if (node.nodeType !== 1) return '';
    // 插件卡片结果不是招聘正文；避免“猎头/上海/硬件”等原因反向污染下轮识别。
    if (node.dataset?.bjaContactMarker==='1' || node.dataset?.bjaResultMarker==='1') return '';
    if (skipElement(node)) return '';
    if (/^(STYLE|SCRIPT|NOSCRIPT|TEMPLATE)$/u.test(node.tagName) || node.hidden) return '';
    const style = styleOf(node);
    if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility)
      || style.opacity === '0' || parseFloat(style.fontSize) === 0
      || (style.overflow === 'hidden' && parseFloat(style.width) <= 1 && parseFloat(style.height) <= 1)) return '';
    const text = [...node.childNodes].map(walk).join('');
    return blocks.test(node.tagName) ? `\n${text}\n` : text;
  }
  return normalizeText(walk(root));
}

export function sameCompany(a, b) {
  if (!a || !b) return false;
  if (normalizeText(a) === normalizeText(b)) return true;
  const x = normalizeCompanyKey(a), y = normalizeCompanyKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const isTruncated = value => /…|\.{3}/u.test(value);
  const prefix = value => normalizeCompanyKey(value.replace(/….*|\.{3}.*$/u, ''));
  return (isTruncated(a) && prefix(a).length >= 5 && y.startsWith(prefix(a)))
    || (isTruncated(b) && prefix(b).length >= 5 && x.startsWith(prefix(b)));
}

// 只去掉位于标题末尾、由分隔符或括号隔开的完整福利词；职位级别、领域、地点不能丢弃。
const BENEFITS = ['五险一金', '六险一金', '七险一金', '双休', '周末双休', '带薪年假', '年终奖'];
const benefitSeparators = /[\s、，,/+＋|｜·\-—–－]+/u;
const benefitAtom = `(?:${BENEFITS.join('|')})`;
const benefitTail = new RegExp(`[\\s、，,/+＋|｜·\\-—–－]+${benefitAtom}(?:[\\s、，,/+＋|｜·\\-—–－]+${benefitAtom})*$`, 'u');

export function normalizeJobTitle(title) {
  const original = normalizeText(title);
  let value = original;
  while (value) {
    const bracket = value.match(/(?:\(([^()]*)\)|（([^（）]*)）|【([^【】]*)】|\[([^\[\]]*)\])$/u);
    const terms = bracket ? bracket.slice(1).find(part => part !== undefined).trim().split(benefitSeparators) : [];
    const next = normalizeText(bracket && terms.length && terms.every(term => BENEFITS.includes(term))
      ? value.slice(0, bracket.index) : value.replace(benefitTail, ''));
    if (next === value) break;
    value = next;
  }
  return value || original;
}

export function compareJobTitles(a, b) {
  const expected = normalizeText(a), observed = normalizeText(b);
  if (!expected || !observed) return { matches: false, benefitSuffix: false };
  if (expected === observed) return { matches: true, benefitSuffix: false };
  const matches = normalizeJobTitle(expected) === normalizeJobTitle(observed);
  return { matches, benefitSuffix: matches };
}

// Never pick the first same-title job. 福利差异回退还必须有独立详情公司，且只允许唯一匹配。
export function resolveCard(records, title, company = '') {
  const selected = records.filter(card => card.selected);
  if (selected.length === 1) return selected[0];
  if (selected.length > 1) return null;
  let matches = records.filter(card => {
    const comparison = compareJobTitles(card.title, title);
    return comparison.matches && (!comparison.benefitSuffix || Boolean(company));
  });
  if (company) matches = matches.filter(card => sameCompany(card.company, company));
  return matches.length === 1 ? matches[0] : null;
}

export function detailFingerprint(job = {}) {
  return normalizeText(`${job.title}|${job.detailCompany || ''}|${job.recruiterName || ''}|${job.description || ''}`);
}

export function detailReadiness(expected, observed, before = null, proof = null) {
  const fail = (code, reason) => ({ready:false,code,reason});
  if (!observed?.description || observed.description.length < 20) return fail('missing_description', '右侧岗位正文未完整读取');
  const titles = compareJobTitles(expected.title, observed.title);
  if (!titles.matches) return fail('title_mismatch', `岗位标题不一致：目标“${normalizeText(expected.title)}”，读到“${normalizeText(observed.title)}”`);
  // 先排除旧正文，再判断公司角色；不能因为还没切完详情就打开额外核对页。
  if (before && before.jobKey !== expected.jobKey && (
    detailFingerprint(before) === detailFingerprint(observed)
    || normalizeText(before.description) === normalizeText(observed.description))) {
    return fail('stale_detail', '右侧正文仍与切换前相同，尚未确认新岗位详情已更新');
  }
  const verified = independentDetailMatches(expected.jobKey,observed,proof);
  if (!verified && observed.detailCompany && expected.company && !sameCompany(expected.company, observed.detailCompany)) {
    return fail('company_mismatch', `公司不一致：目标“${expected.company}”，右侧读到“${observed.detailCompany}”`);
  }
  if (!verified && titles.benefitSuffix && !sameCompany(expected.company, observed.detailCompany)) {
    return fail('missing_company', '标题仅福利后缀不同，但右侧缺少可独立核对的公司，暂不放行');
  }
  if (verified) return {ready:true,code:'ready_independent_detail',reason:'独立岗位链接、标题和招聘者已核对，原列表快照未变；公司名称及跨页正文展示差异不阻断'};
  return {ready:true,code:titles.benefitSuffix ? 'ready_benefit_suffix' : 'ready',
    reason:titles.benefitSuffix ? '仅明确福利后缀不同；岗位主体、独立详情公司与更新校验通过' : '岗位标题、公司与详情核对通过'};
}

export function detailReady(expected, observed, before = null, proof = null) {
  return detailReadiness(expected, observed, before, proof).ready;
}
