import { DEFAULT_SETTINGS, normalizeApiBaseUrl } from "./settings.js";
import { parseKeywords } from "./shared/core.js";

const byId = (id) => document.getElementById(id);
const PROVIDER_PRESETS = Object.freeze({
  zhipu: {
    apiBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4.7-flash"
  },
  deepseek: {
    apiBaseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash"
  }
});

const fields = {
  candidateSummary: byId("candidate-summary"),
  modelProvider: byId("model-provider"),
  apiBaseUrl: byId("api-base-url"),
  model: byId("model-name"),
  apiKey: byId("api-key"),
  greetingRules: byId("greeting-rules"),
  dailyLimit: byId("daily-limit"),
  batchSize: byId("batch-size"),
  restMinSeconds: byId("rest-min"),
  restMaxSeconds: byId("rest-max"),
  defaultRunLimit: byId("default-run-limit"),
  secondContactMinHours: byId("second-contact-hours"),
  companyCooldownHours: byId("company-cooldown-hours"),
  attachResumeImage: byId("attach-resume-image"),
  enableDirectSend: byId("enable-direct-send"),
  skipTitleKeywords: byId("skip-title-keywords"),
  skipTitleMode: byId("skip-title-mode"),
  skipTitleCount: byId("skip-title-count"),
  skipDescriptionKeywords: byId("skip-description-keywords"),
  skipDescriptionMode: byId("skip-description-mode"),
  skipDescriptionCount: byId("skip-description-count")
};

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

async function load() {
  const [response] = await Promise.all([
    chrome.runtime.sendMessage({ type: "GET_SETTINGS", includeApiKey: true }),
    loadResumeImage()
  ]);
  const settings = { ...DEFAULT_SETTINGS, ...(response?.settings || {}) };
  fields.candidateSummary.value = settings.candidateSummary;
  fields.modelProvider.value = settings.modelProvider;
  fields.apiBaseUrl.value = normalizeApiBaseUrl(settings.apiBaseUrl);
  fields.model.value = settings.model;
  fields.apiKey.value = settings.apiKey;
  fields.greetingRules.value = settings.greetingRules;
  fields.dailyLimit.value = settings.dailyLimit;
  fields.batchSize.value = settings.batchSize;
  fields.restMinSeconds.value = settings.restMinSeconds;
  fields.restMaxSeconds.value = settings.restMaxSeconds;
  fields.defaultRunLimit.value = settings.defaultRunLimit;
  fields.secondContactMinHours.value = settings.secondContactMinHours;
  fields.companyCooldownHours.value = settings.companyCooldownHours;
  fields.attachResumeImage.checked = Boolean(settings.attachResumeImage);
  fields.enableDirectSend.checked = Boolean(settings.enableDirectSend);
  for (const key of ["Title", "Description"]) {
    fields[`skip${key}Keywords`].value = settings[`skip${key}Keywords`] || "";
    fields[`skip${key}Mode`].value = settings[`skip${key}Mode`] || "any";
    fields[`skip${key}Count`].value = settings[`skip${key}Count`] || 2;
  }
}

function readSettings() {
  const restMinSeconds = Number(fields.restMinSeconds.value);
  const restMaxSeconds = Number(fields.restMaxSeconds.value);
  if (!fields.candidateSummary.value.trim()) throw new Error("个人总结不能为空");
  if (!fields.apiBaseUrl.value.trim()) throw new Error("API Base URL不能为空");
  if (!fields.model.value.trim()) throw new Error("模型名称不能为空");
  if (!fields.apiKey.value.trim()) throw new Error("API Key不能为空");
  if (!fields.greetingRules.value.trim()) throw new Error("招呼语规则不能为空");
  const normalizedBaseUrl = normalizeApiBaseUrl(fields.apiBaseUrl.value);
  const apiUrl = new URL(normalizedBaseUrl);
  if (apiUrl.protocol !== "https:") throw new Error("API Base URL必须使用HTTPS");
  if (restMaxSeconds < restMinSeconds) throw new Error("最长休息时间不能小于最短休息时间");
  const skip = {};
  for (const [key, label] of [["Title", "岗位标题"], ["Description", "职位描述"]]) {
    const raw = fields[`skip${key}Keywords`].value.trim();
    const mode = fields[`skip${key}Mode`].value;
    const count = Number(fields[`skip${key}Count`].value);
    const terms = parseKeywords(raw);
    if (raw.length > 5000) throw new Error(`${label}跳过关键词不能超过5000字`);
    if (!["any", "all", "count"].includes(mode)) throw new Error(`${label}跳过关键词的匹配方式无效`);
    if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error(`${label}跳过关键词的 N 必须是1至100的整数`);
    if (mode === "count" && terms.length && count > terms.length) throw new Error(`${label}跳过关键词的 N 不能超过不同关键词数量（当前${terms.length}个）`);
    Object.assign(skip, {[`skip${key}Keywords`]: raw, [`skip${key}Mode`]: mode, [`skip${key}Count`]: count});
  }
  return {
    candidateSummary: fields.candidateSummary.value.trim(),
    modelProvider: fields.modelProvider.value,
    apiBaseUrl: normalizedBaseUrl,
    model: fields.model.value.trim(),
    apiKey: fields.apiKey.value.trim(),
    greetingRules: fields.greetingRules.value.trim(),
    dailyLimit: Number(fields.dailyLimit.value),
    batchSize: Number(fields.batchSize.value),
    restMinSeconds,
    restMaxSeconds,
    defaultRunLimit: Math.max(1, Math.min(500, Number(fields.defaultRunLimit.value) || DEFAULT_SETTINGS.defaultRunLimit)),
    secondContactMinHours: Math.max(0, Math.min(168, Number(fields.secondContactMinHours.value) || 0)),
    companyCooldownHours: Math.max(0, Math.min(720, Number(fields.companyCooldownHours.value) || 0)),
    attachResumeImage: fields.attachResumeImage.checked,
    enableDirectSend: fields.enableDirectSend.checked,
    previewBeforeSend: true,
    secondContactSameDay: true,
    thirdContactNextDay: true,
    maxContactsPerJob: 3,
    ...skip
  };
}

byId("save").addEventListener("click", async () => {
  const status = byId("save-status");
  try {
    if (selectedResumeImage) await persistSelectedResumeImage();
    if (fields.attachResumeImage.checked && !savedResumeImageConfigured) throw new Error("请先选择并保存一张简历图片，或关闭自动附带简历图片");
    const settings = readSettings();
    const response = await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings });
    if (!response?.ok) throw new Error(response?.error || "保存失败");
    status.textContent = "已保存";
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
    await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings: readSettings() });
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
