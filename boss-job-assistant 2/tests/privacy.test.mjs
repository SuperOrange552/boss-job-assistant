import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DEFAULT_SETTINGS, normalizeApiBaseUrl } from "../settings.js";

test("默认使用智谱且不预置API Key", () => {
  assert.equal(DEFAULT_SETTINGS.modelProvider, "zhipu");
  assert.equal(DEFAULT_SETTINGS.apiBaseUrl, "https://open.bigmodel.cn/api/paas/v4");
  assert.equal(DEFAULT_SETTINGS.model, "glm-4.7-flash");
  assert.equal(DEFAULT_SETTINGS.apiKey, "");
});

test("Base URL和完整chat completions地址都会规范化为同一个Base URL", () => {
  assert.equal(
    normalizeApiBaseUrl("https://open.bigmodel.cn/api/paas/v4"),
    "https://open.bigmodel.cn/api/paas/v4"
  );
  assert.equal(
    normalizeApiBaseUrl("https://open.bigmodel.cn/api/paas/v4/chat/completions"),
    "https://open.bigmodel.cn/api/paas/v4"
  );
  assert.equal(
    normalizeApiBaseUrl("https://open.bigmodel.cn/api/paas/v4/chat/completions/"),
    "https://open.bigmodel.cn/api/paas/v4"
  );
});

test("网页可访问资源不包含个人总结或设置模块", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  const exposed = manifest.web_accessible_resources.flatMap((entry) => entry.resources);
  assert.deepEqual(exposed, ["shared/core.js", "shared/page.js", "shared/identity.js", "shared/chat.js"]);
  assert.ok(!exposed.includes("settings.js"));
  const publicCore = await readFile(new URL("../shared/core.js", import.meta.url), "utf8");
  assert.doesNotMatch(publicCore, /掌门AI一对一/u);
  assert.doesNotMatch(publicCore, /apiKey/u);
  assert.ok(!exposed.includes("settings.js"));
  assert.ok(!exposed.some((file) => /resume/iu.test(file)));
});

test("简历图片由设置页选择并保存在扩展存储而非源文件路径", async () => {
  const [options, background] = await Promise.all([
    readFile(new URL("../options.html", import.meta.url), "utf8"),
    readFile(new URL("../background.js", import.meta.url), "utf8")
  ]);
  assert.match(options, /id="resume-image-file"[^>]*type="file"/u);
  assert.match(options, /image\/jpeg,image\/png,image\/webp/u);
  assert.match(background, /resumeImage:\s*"resumeImage"/u);
  assert.match(background, /RESUME_IMAGE_MAX_BYTES/u);
});

test("扩展只授权BOSS、智谱和DeepSeek三个远程站点", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.host_permissions, [
    "https://www.zhipin.com/*",
    "https://open.bigmodel.cn/*",
    "https://api.deepseek.com/*"
  ]);
});
