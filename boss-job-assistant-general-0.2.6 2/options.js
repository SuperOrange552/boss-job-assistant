import {DEFAULT_SETTINGS,normalizeApiBaseUrl} from './settings.js';
import {FILTER_FIELD_DEFINITIONS,KEYWORD_GROUPS,validateSettings,parseKeywords,keywordRuleLabel} from './shared/config.js';
const byId=id=>document.getElementById(id);
const PROVIDER_PRESETS={zhipu:{apiBaseUrl:'https://open.bigmodel.cn/api/paas/v4',model:''},deepseek:{apiBaseUrl:'https://api.deepseek.com',model:''}};

const kebab=(value)=>String(value).replace(/[A-Z]/gu,(letter)=>`-${letter.toLowerCase()}`);
const keywordGroupMarkup=(definition,excluded)=>{
  const key=`${definition.key}${excluded?'Exclude':'Include'}`,id=`filter-${kebab(key)}`,action=excluded?'排除':'保留';
  return `<div class="keyword-group"><label>${definition.label} · ${excluded?'排除':'包含'}词（可不填）<textarea id="${id}" rows="3" placeholder="${definition.placeholder}"></textarea><small>只检查${definition.source}；达到本组规则才${excluded?'跳过':'保留'}。留空不限制。</small><small class="separator-note">用换行、中文/英文逗号或分号分隔；一个词组内部的空格会保留。</small></label><label>本组${action}条件<select id="${id}-mode"><option value="any">命中任意 1 个词</option><option value="all">全部词都命中</option><option value="count">至少命中 N 个不同词</option></select></label><label id="${id}-count-row">至少命中几个不同词<input id="${id}-count" type="number" min="1" max="100" step="1"></label><small id="${id}-summary" class="rule-summary"></small></div>`;
};
// 页面由统一字段定义生成。今后新增筛选字段不需要再复制一套 HTML。
byId('filter-groups').innerHTML=FILTER_FIELD_DEFINITIONS.flatMap((definition)=>[keywordGroupMarkup(definition,false),keywordGroupMarkup(definition,true)]).join('');

const fields=Object.fromEntries(Object.entries({"candidateSummary":"candidate-summary","greetingMaxChars":"greeting-max-chars","greetingRules":"greeting-rules","modelProvider":"model-provider","apiBaseUrl":"api-base-url","model":"model-name","apiKey":"api-key","dailyLimit":"daily-limit","batchSize":"batch-size","restMinSeconds":"rest-min","restMaxSeconds":"rest-max","perSendRestMinSeconds":"per-send-min","perSendRestMaxSeconds":"per-send-max","defaultRunLimit":"default-run-limit","detailLoadTimeoutSeconds":"detail-load-timeout","chatReadyTimeoutSeconds":"chat-ready-timeout","sendEvidenceTimeoutSeconds":"send-evidence-timeout","resumeSendTimeoutSeconds":"resume-send-timeout","secondContactMinHours":"second-contact-hours","laterContactMinHours":"later-contact-hours","laterContactsRequireNextDay":"later-contacts-next-day","maxContactsPerJob":"max-contacts-per-job","companyCooldownHours":"company-cooldown-hours","attachResumeImage":"attach-resume-image","enableDirectSend":"enable-direct-send","activationMode":"activation-mode","activationTemplate":"activation-template","activationRules":"activation-rules","activationReadFilter":"activation-read-filter","activationReplyFilter":"activation-reply-filter","activationSentFilter":"activation-sent-filter","activationRunLimit":"activation-limit","activationCooldownHours":"activation-cooldown","activationUseCategories":"activation-use-categories"}).map(([key,id])=>[key,byId(id)]));
const dynamicFilterEntries=KEYWORD_GROUPS.flatMap((key)=>[[key,`filter-${kebab(key)}`],[`${key}Mode`,`filter-${kebab(key)}-mode`],[`${key}Count`,`filter-${kebab(key)}-count`]]);
const filterFields=Object.fromEntries([...dynamicFilterEntries,['hrActiveDays','filter-hr-days'],['hrUnknownPolicy','filter-hr-unknown']].map(([key,id])=>[key,byId(id)]));
const RESUME_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const RESUME_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
let selectedResumeImage = null;
let savedResumeImageConfigured = false;

function renderResume(image, statusText = "") {
  const preview = byId("resume-preview");
  const status = byId("resume-status");
  if (image?.dataUrl) {
    preview.src = image.dataUrl;
    preview.hidden = false;
    status.textContent = statusText || `已保存：${image.name}（${Math.ceil(image.size / 1024)} KB）`;
    status.className = "inline-status success";
  } else {
    preview.removeAttribute("src");
    preview.hidden = true;
    status.textContent = statusText || "尚未保存简历图片";
    status.className = statusText ? "inline-status failure" : "inline-status";
  }
}

async function loadResumeImage() {
  const response = await chrome.runtime.sendMessage({ type: "GET_RESUME_IMAGE" });
  if (!response?.ok) throw new Error(response?.error || "读取简历图片失败");
  savedResumeImageConfigured = Boolean(response.configured);
  renderResume(response.image);
}

function fileToResumeImage(file) {
  if (!RESUME_IMAGE_TYPES.has(file.type)) throw new Error("简历图片只支持 JPG、PNG 或 WebP");
  if (!file.size || file.size > RESUME_IMAGE_MAX_BYTES) throw new Error("简历图片必须小于或等于 8 MB");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve({ name: file.name, type: file.type, size: file.size, dataUrl: String(reader.result || "") }), { once: true });
    reader.addEventListener("error", () => reject(new Error("读取所选简历图片失败")), { once: true });
    reader.readAsDataURL(file);
  });
}

async function persistSelectedResumeImage() {
  if (!selectedResumeImage) return savedResumeImageConfigured;
  const response = await chrome.runtime.sendMessage({ type: "SAVE_RESUME_IMAGE", image: selectedResumeImage });
  if (!response?.ok) throw new Error(response?.error || "保存简历图片失败");
  savedResumeImageConfigured = true;
  renderResume(selectedResumeImage, `已保存：${selectedResumeImage.name}（${Math.ceil(selectedResumeImage.size / 1024)} KB）`);
  selectedResumeImage = null;
  return true;
}


function displayModes(){
  byId('activation-categories').hidden=!fields.activationUseCategories.checked;
  for(const key of KEYWORD_GROUPS){
    const mode=filterFields[key+'Mode'].value,count=filterFields[key+'Count'].value,terms=parseKeywords(filterFields[key].value);
    byId(filterFields[key].id+'-count-row').hidden=mode!=='count';
    byId(filterFields[key].id+'-summary').textContent=terms.length
      ? '已识别 '+terms.length+' 个不同词：'+terms.join(' / ')+'；本组'+keywordRuleLabel(mode,count)+(mode==='count'&&Number(count)>terms.length?'。数量超过现有词数，请调整。':'。')
      : '留空：本组不参与筛选。';
  }
}
function writeFields(map,values){for(const [key,element] of Object.entries(map)){if(element.type==='checkbox')element.checked=Boolean(values[key]);else element.value=values[key]??'';}}
async function load(){
  const response=await chrome.runtime.sendMessage({type:'GET_SETTINGS',includeApiKey:true});
  if(!response?.ok)throw new Error(response?.error||'无法加载设置');
  const s={...DEFAULT_SETTINGS,...response.settings};
  writeFields(fields,s);writeFields(filterFields,s.filters);
  for(const group of ['read','unread','replied','never_sent'])byId('activation-text-'+group.replace('_','-')).value=s.activationTemplates[group];
  await loadResumeImage();displayModes();
}
function readFields(map){return Object.fromEntries(Object.entries(map).map(([key,e])=>[key,e.type==='checkbox'?e.checked:e.type==='number'?(e.value===''?'':Number(e.value)):e.value]));}
function readSettings(){
  const values={...DEFAULT_SETTINGS,...readFields(fields),filters:readFields(filterFields),activationTemplates:{}};
  for(const group of ['read','unread','replied','never_sent'])values.activationTemplates[group]=byId('activation-text-'+group.replace('_','-')).value.trim();
  values.apiBaseUrl=normalizeApiBaseUrl(values.apiBaseUrl);
  const validated=validateSettings(values);
  // 后台不拥有前台话术字段，避免保存后台设置时覆盖另一个页面刚保存的模板。
  delete validated.greetingMode;delete validated.greetingTemplate;
  return validated;
}
for(const field of Object.values(filterFields)){field.addEventListener('input',displayModes);field.addEventListener('change',displayModes);}
fields.activationUseCategories.addEventListener('change',displayModes);
byId("save").addEventListener("click", async () => {
  const status = byId("save-status");
  try {
    if (selectedResumeImage) await persistSelectedResumeImage();
    if (fields.attachResumeImage.checked && !savedResumeImageConfigured) throw new Error("请先选择并保存一张简历图片，或关闭自动附带简历图片");
    const settings = readSettings();
    const response = await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings });
    if (!response?.ok) throw new Error(response?.error || "保存失败");
    status.textContent = "已保存；正在运行的批次保持原设置，修改在下一轮生效";
    status.className = "inline-status success";
  } catch (error) {
    status.textContent = error.message;
    status.className = "inline-status failure";
  }
});

byId("resume-image-file").addEventListener("change", async (event) => {
  try {
    const file = event.target.files?.[0];
    if (!file) return;
    selectedResumeImage = await fileToResumeImage(file);
    renderResume(selectedResumeImage, `已选择但尚未保存：${file.name}（${Math.ceil(file.size / 1024)} KB）`);
    byId("resume-status").className = "inline-status";
  } catch (error) {
    selectedResumeImage = null;
    renderResume(null, error.message);
  }
});

byId("save-resume-image").addEventListener("click", async () => {
  const status = byId("resume-status");
  try {
    if (!selectedResumeImage) throw new Error("请先选择一张简历图片");
    await persistSelectedResumeImage();
    fields.attachResumeImage.checked = true;
    await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings: { attachResumeImage: true } });
  } catch (error) {
    status.textContent = error.message;
    status.className = "inline-status failure";
  }
});

byId("clear-resume-image").addEventListener("click", async () => {
  if (!window.confirm("确认清除保存在扩展中的简历图片吗？")) return;
  const response = await chrome.runtime.sendMessage({ type: "CLEAR_RESUME_IMAGE" });
  if (!response?.ok) return renderResume(null, response?.error || "清除简历图片失败");
  selectedResumeImage = null;
  savedResumeImageConfigured = false;
  fields.attachResumeImage.checked = false;
  byId("resume-image-file").value = "";
  await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings: { attachResumeImage: false } });
  renderResume(null);
});

byId("model-provider").addEventListener("change", () => {
  const preset = PROVIDER_PRESETS[fields.modelProvider.value];
  fields.apiBaseUrl.value = preset.apiBaseUrl;
  fields.model.value = preset.model;
});

byId("toggle-key").addEventListener("click", () => {
  const showing = fields.apiKey.type === "text";
  fields.apiKey.type = showing ? "password" : "text";
  byId("toggle-key").textContent = showing ? "显示" : "隐藏";
});

byId("clear-key").addEventListener("click", async () => {
  if (!window.confirm("确认清空已保存在该扩展中的 API Key 吗？")) return;
  fields.apiKey.value = "";
  const current = await chrome.runtime.sendMessage({ type: "GET_SETTINGS", includeApiKey: true });
  const settings = { ...DEFAULT_SETTINGS, ...(current?.settings || {}), apiKey: "" };
  const response = await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings });
  const status = byId("model-status");
  status.textContent = response?.ok ? "API Key 已清空" : (response?.error || "清空失败");
  status.className = response?.ok ? "inline-status success" : "inline-status failure";
});

byId("test-model").addEventListener("click", async () => {
  const status = byId("model-status");
  status.textContent = "连接中…";
  status.className = "inline-status";
  try {
    const saved=await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings: readSettings() });
    if(!saved?.ok)throw new Error(saved?.error||"保存失败，未测试接口");
    const response = await chrome.runtime.sendMessage({ type: "TEST_MODEL" });
    if (!response?.ok) throw new Error(response?.error || "连接失败");
    status.textContent = `接口可用；模型 ${response.model.model}`;
    status.className = "inline-status success";
  } catch (error) {
    status.textContent = error.message;
    status.className = "inline-status failure";
  }
});

load().catch((error) => {
  byId("save-status").textContent = error.message;
  byId("save-status").className = "inline-status failure";
});
