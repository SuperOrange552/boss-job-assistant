import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomRestSeconds } from "../shared/core.js";
import { DEFAULT_SETTINGS } from "../settings.js";

test("每条发送后的随机等待固定在1到3秒", () => {
  const settings = {
    restMinSeconds: DEFAULT_SETTINGS.perSendRestMinSeconds,
    restMaxSeconds: DEFAULT_SETTINGS.perSendRestMaxSeconds
  };
  assert.equal(randomRestSeconds(settings, 0), 1);
  assert.equal(randomRestSeconds(settings, 0.999999), 3);
});

test("默认单轮上限可由用户重新设置", () => {
  assert.equal(DEFAULT_SETTINGS.defaultRunLimit, 20);
  assert.equal(DEFAULT_SETTINGS.dailyLimit, 500);
});

test("自动模式按左侧列表逐条处理且保留开始停止入口", async () => {
  const content = await readFile(new URL("../content.js", import.meta.url), "utf8");
  assert.match(content, /id="run-limit"/u);
  assert.match(content, /id="start"/u);
  assert.match(content, /id="stop"/u);
  assert.match(content, /collectCards/u);
  assert.match(content, /nextCard/u);
  assert.match(content, /currentPlan/u);
  assert.equal(content.includes('restoreSourcePlan'),false,'禁止重载后自动点击恢复求职分类');
  assert.equal((content.match(/await runLoop\(\)/gu) || []).length,1,'只有手动开始入口可以启动主列表循环');
  assert.match(content, /锁定求职方向/u);
  assert.doesNotMatch(content, /candidates\.sort/u);
  assert.doesNotMatch(content, /cards\.length\s*>\s*before/u);
  assert.match(content, /let deadline = Date\.now\(\) \+ 7000/u);
});

test("自动模式保留原列表并由后台临时标签页发送和关闭", async () => {
  const content = await readFile(new URL("../content.js", import.meta.url), "utf8");
  const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
  assert.match(content, /SET_PENDING_DELIVERY/u);
  assert.match(content, /GET_PENDING_DELIVERY/u);
  assert.match(content, /OPEN_DELIVERY_WORKER/u);
  assert.match(content, /waitForWorkerOutcome/u);
  assert.match(content, /getPendingForCurrentPage/u);
  assert.match(content, /latest\.delegated/u);
  assert.match(content, /RESERVE_TEXT_SEND/u);
  assert.match(content, /RESERVE_COMMUNICATION_ACTION/u);
  assert.match(content, /CLOSE_DELIVERY_WORKER/u);
  assert.match(content, /waitForSendEvidence/u);
  assert.match(content, /sendResumeImage/u);
  assert.match(content, /GET_RESUME_IMAGE_FOR_DELIVERY/u);
  assert.match(content, /RECORD_SEND/u);
  assert.match(background, /pendingDelivery/u);
  assert.match(background, /chrome\.tabs\.create\(\{ url: workerUrl, active: false \}\)/u);
  assert.match(background, /perSendRestSeconds/u);
  assert.match(background, /batchRestSeconds/u);
  assert.doesNotMatch(content, /location\.assign\(pending\.sourceUrl\)/u);
  assert.doesNotMatch(content, /history\.back\(\)/u);
  assert.match(content, /GET_CONTACT_MARKERS/u);
  assert.match(content, /safeElementClick/u);
  assert.match(content, /Extension context invalidated/u);
  assert.doesNotMatch(content, /panel\.style\.display\s*=\s*["']none["']/u);
  assert.match(background, /claimPendingDelivery/u);
  assert.match(background, /pending\.chatTabId\s*=\s*tabId/u);
  assert.match(background, /deliveryTabIds\(pending\)\.includes\(sender\.tab\.openerTabId\)/u);
});

test("独立详情页按可见文字识别并兼容BOSS隐藏SEO文本", async () => {
  const content = await readFile(new URL("../content.js", import.meta.url), "utf8");
  assert.match(content, /function renderedText\(element\)/u);
  assert.match(content, /visibleText\(element\)/u);
  assert.match(content, /"\.job-detail-section"/u);
  assert.match(content, /\/职位描述\/u\.test\(renderedText\(element\)\)/u);
  assert.doesNotMatch(content, /\/职位描述\/u\.test\(element\.textContent/u);
});

test("新版清单版本为0.4.19并允许持久保存简历图片", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.version, "0.4.19");
  assert.ok(manifest.permissions.includes("unlimitedStorage"));
});

test("模型提示词以职位描述切入、结合个人总结、真人语气且禁止菜单式罗列", async () => {
  const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
  const prompt = background.slice(background.indexOf("const MODEL_SYSTEM_PROMPT"), background.indexOf("function publicSettings("));
  assert.match(prompt, /最核心、最具体的1至2个点/u);
  assert.match(prompt, /结合 candidateSummary/u);
  assert.match(prompt, /语气像真人聊天/u);
  assert.match(prompt, /最多提到2个工具或技术栈/u);
  // 不再对模型做真实性约束，也不再强制固定的“看贵公司在招聘”开头。
  assert.doesNotMatch(prompt, /真实经验|编造|已经具备|离家/u);
  assert.doesNotMatch(prompt, /开头必须严格写成/u);
  assert.match(background, /looksLikeCapabilityMenu/u);
});
