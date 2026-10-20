import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeJob,
  buildModelPayload,
  containsSelfDisadvantage,
  contactEligibility,
  formatPreferredGreeting,
  conversationalJobTitle,
  checkSkipKeywords,
  parseKeywords,
  jobOutcomeBadge,
  looksLikeCapabilityMenu,
  normalizeCompanyKey,
  parseModelResult,
  recruiterSalutation,
  stableJobKey
} from "../shared/core.js";
import { DEFAULT_SETTINGS } from "../settings.js";

const shanghaiSoftwareJob = {
  title: "软件测试工程师",
  company: "示例教育科技",
  location: "上海·浦东新区·张江",
  description: "负责Android App、Web和H5功能测试、接口测试及回归测试，使用Postman、MySQL和pytest。",
  tags: ["功能测试", "接口测试", "Python"],
  recruiterName: "陈晓",
  activityText: "今日活跃",
  replyText: "今日回复过"
};

test("推荐上海常规软件测试岗位", () => {
  const result = analyzeJob(shanghaiSoftwareJob);
  assert.equal(result.decision, "recommend");
  assert.equal(result.locationOk, true);
  assert.equal(result.hr.repliedToday, true);
  assert.ok(result.positiveMatches.includes("接口测试"));
  assert.ok(result.matchedProfilePoints.includes("Android App、Web及H5端测试"));
});

test("非上海岗位不投递", () => {
  const result = analyzeJob({ ...shanghaiSoftwareJob, location: "杭州·余杭区" });
  assert.equal(result.decision, "exclude");
  assert.equal(result.category, "non_shanghai");
});

const postponeCases = [
  {
    name: "伺服硬件测试",
    expected: "hardware",
    job: {
      title: "伺服测试工程师",
      location: "上海",
      description: "负责伺服驱动器功能测试、性能测试和硬件测试，使用PID参数整定、永磁同步电机和电子电路。"
    }
  },
  {
    name: "整车车载测试",
    expected: "automotive",
    job: {
      title: "整车测试工程师（车身功能/数字钥匙）",
      location: "上海",
      description: "开展HIL、ECU、实车道路测试，基于CAN/LIN网络完成UDS协议诊断测试。"
    }
  },
  {
    name: "嵌入式软硬件测试",
    expected: "hardware",
    job: {
      title: "测试工程师（松江）",
      location: "上海",
      description: "嵌入式软件测试优先，熟悉串口和总线测试方法，使用示波器、万用表和接口抓包工具。"
    }
  },
  {
    name: "光学设备测试",
    expected: "optical",
    job: {
      title: "光学测试工程师",
      location: "上海",
      description: "负责光学精密设备测试方案和光学算法测试，要求光学、激光或物理背景。"
    }
  }
];

for (const entry of postponeCases) {
  test(`暂缓：${entry.name}`, () => {
    const result = analyzeJob(entry.job);
    assert.equal(result.decision, "postpone");
    assert.equal(result.category, entry.expected);
  });
}

test("Python和自动化测试不能覆盖汽车测试对象", () => {
  const result = analyzeJob({
    title: "整车自动化测试工程师",
    location: "上海",
    description: "使用Python开发自动化测试脚本，完成ECU、CANoe和数字钥匙测试。"
  });
  assert.equal(result.decision, "postpone");
  assert.equal(result.category, "automotive");
});

test("车载软件测试和纯嵌入式词仍进入暂缓", () => {
  const vehicle = analyzeJob({
    title: "车载软件测试工程师",
    location: "上海",
    description: "使用Python进行功能测试和接口测试。"
  });
  const embedded = analyzeJob({
    title: "嵌入式测试工程师",
    location: "上海",
    description: "负责嵌入式产品的功能和自动化测试。"
  });
  assert.equal(vehicle.decision, "postpone");
  assert.equal(vehicle.category, "automotive");
  assert.equal(embedded.decision, "postpone");
  assert.equal(embedded.category, "embedded");
});

test("测试对象不明确但无明确排除证据时本地宽松放行，不交模型决定投递", () => {
  const result = analyzeJob({
    title: "测试工程师",
    location: "上海",
    description: "负责产品质量验证、整理测试结果并跟踪问题。"
  });
  assert.equal(result.decision, "recommend");
});

test("游戏软件测试不会因为兼容性描述中的泛硬件词被误跳过", () => {
  const result = analyzeJob({
    title: "游戏测试工程师",
    company: "示例游戏",
    location: "上海",
    description: "负责手游客户端的功能测试、版本回归和兼容性测试，需要了解常见手机软硬件配置。"
  });
  assert.equal(result.decision, "recommend");
  assert.equal(result.category, "software_testing");
  assert.deepEqual(result.postponeMatches.hardware, undefined);
});

test("招聘者称呼支持普通姓和复姓", () => {
  assert.equal(recruiterSalutation("赵洁琼 在线"), "赵老师您好");
  assert.equal(recruiterSalutation("欧阳娜 今日活跃"), "欧阳老师您好");
  assert.equal(recruiterSalutation("Recruiter A"), "您好");
});

test("模型话术会统一为用户指定的自然开头并隐藏具体公司名", () => {
  const greeting = formatPreferredGreeting(
    "赵老师好，看到示例教育科技公司在招软件测试工程师，我有3年软件测试经验，也做过App和接口测试，希望进一步沟通。",
    {
      title: "软件测试工程师",
      company: "示例教育科技公司",
      recruiterName: "赵洁琼 在线"
    }
  );
  // 只统一称呼；正文开场保留模型按职位描述写的内容，公司全称换成“贵公司”。
  assert.equal(greeting, "赵老师您好，看到贵公司在招软件测试工程师，我有3年软件测试经验，也做过App和接口测试，希望进一步沟通。");
  assert.doesNotMatch(greeting, /示例教育科技/u);
  assert.doesNotMatch(greeting, /老师好/u);
});

test("称呼统一但不再强加固定的“看贵公司在招聘…岗位”开头", () => {
  const job = { title: "接口测试工程师", company: "示例公司", recruiterName: "陈女士" };
  assert.equal(formatPreferredGreeting("陈老师你好！看JD里要做支付链路的接口测试，这块我之前一直在做。", job),
    "陈老师您好，看JD里要做支付链路的接口测试，这块我之前一直在做。");
  assert.equal(formatPreferredGreeting("您好，看岗位要负责App回归，我平时就在跟这块。", job),
    "陈老师您好，看岗位要负责App回归，我平时就在跟这块。");
  assert.doesNotMatch(formatPreferredGreeting("岗位里提到的订单测试我做过不少。", job), /看贵公司在招聘/u);
  assert.match(formatPreferredGreeting("", job), /^陈老师您好，.+聊聊。$/u);
});

test("菜单式技术堆砌会被识别，只回应1至2个岗位要求的话术可以通过", () => {
  assert.equal(looksLikeCapabilityMenu("赵老师您好，我熟悉功能测试、接口测试、自动化测试、性能测试，能使用Postman、Apifox、MySQL、Charles、Linux、pytest和JMeter。"), true);
  assert.equal(looksLikeCapabilityMenu("赵老师您好，看贵公司在招聘接口测试工程师岗位，我有3年软件测试经验，熟悉使用Postman进行接口验证，也能用Python编写接口自动化脚本。岗位要求和我的经历比较匹配，期待您的回复，感谢！"), false);
  assert.equal(looksLikeCapabilityMenu("赵老师您好，看贵公司在招聘自动化测试工程师岗位，我有3年测试经验，熟悉根据需求设计测试用例，也参与过JMeter性能回归。期待您的回复，感谢！"), false);
});

test("模型输入只提供最相关的两项候选人匹配点", () => {
  const payload = buildModelPayload(shanghaiSoftwareJob, analyzeJob(shanghaiSoftwareJob), DEFAULT_SETTINGS, 1);
  assert.equal(payload.localAnalysis.matchedProfilePoints.length, 2);
});

test("禁止招呼语暴露不会没做过和经验不足等个人短板", () => {
  for (const greeting of [
    "这个方向我不会，但愿意学习。",
    "虽然没有做过支付测试，但是我愿意学。",
    "我对性能测试不太熟悉，可以快速提升。",
    "相关经验有限，希望给我一个机会。",
    "我是非科班转行，目前还需要加强接口测试。"
  ]) assert.equal(containsSelfDisadvantage(greeting), true, greeting);
  assert.equal(containsSelfDisadvantage("我具备3年软件测试经验，熟悉功能、接口和自动化测试。"), false);
  assert.equal(containsSelfDisadvantage("学习能力和业务适应能力较强，期待进一步沟通。"), false);
});

test("公司名称归一化用于跨岗位防重并忽略匿名公司", () => {
  assert.equal(normalizeCompanyKey("上海示例科技有限公司"), "上海示例科技");
  assert.equal(normalizeCompanyKey("上海示例科技（集团）有限公司"), "上海示例科技");
  assert.equal(normalizeCompanyKey("上海某大型游戏公司"), "");
  assert.equal(normalizeCompanyKey("公司未识别"), "");
});

test("优先使用BOSS岗位详情URL生成稳定键", () => {
  assert.equal(
    stableJobKey({ url: "https://www.zhipin.com/job_detail/abc123.html?securityId=x" }),
    "abc123"
  );
});

test("首次可发送、二次遵守最短间隔、第三次需等上海次日", () => {
  const firstAt = "2026-09-02T02:00:00.000Z";
  const secondAt = "2026-09-02T06:30:00.000Z";
  const first = contactEligibility([], DEFAULT_SETTINGS, new Date(firstAt).getTime());
  assert.equal(first.eligible, true);
  assert.equal(first.round, 1);

  const second = contactEligibility(
    [{ status: "sent", sentAt: firstAt }],
    DEFAULT_SETTINGS,
    new Date("2026-09-02T02:05:00.000Z").getTime()
  );
  assert.equal(second.eligible, false);
  assert.equal(second.round, 2);

  const secondAfterInterval = contactEligibility(
    [{ status: "sent", sentAt: firstAt }],
    DEFAULT_SETTINGS,
    new Date("2026-09-02T06:01:00.000Z").getTime()
  );
  assert.equal(secondAfterInterval.eligible, true);
  assert.equal(secondAfterInterval.round, 2);

  const importedSecond = contactEligibility(
    [{ status: "sent", sentAt: firstAt, imported: true }],
    DEFAULT_SETTINGS,
    new Date("2026-09-02T02:05:00.000Z").getTime()
  );
  assert.equal(importedSecond.eligible, false);
  assert.equal(importedSecond.round, 2);

  const attempts = [
    { status: "sent", sentAt: firstAt },
    { status: "sent", sentAt: secondAt }
  ];
  const sameShanghaiDay = contactEligibility(
    attempts,
    DEFAULT_SETTINGS,
    new Date("2026-09-02T07:00:00.000Z").getTime()
  );
  assert.equal(sameShanghaiDay.eligible, false);
  assert.equal(sameShanghaiDay.round, 3);

  const nextShanghaiDay = contactEligibility(
    attempts,
    DEFAULT_SETTINGS,
    new Date("2026-09-02T16:01:00.000Z").getTime()
  );
  assert.equal(nextShanghaiDay.eligible, true);
  assert.equal(nextShanghaiDay.round, 3);
});

test("三次发送后停止继续发送", () => {
  const attempts = [1, 2, 3].map((round) => ({
    round,
    status: "sent",
    sentAt: `2026-09-0${round}T02:00:00.000Z`
  }));
  const result = contactEligibility(attempts, DEFAULT_SETTINGS, Date.now());
  assert.equal(result.eligible, false);
  assert.match(result.reason, /三次/u);
});

test("模型话术不做字数和夸大限制，只校验结构", () => {
  const longGreeting = "您好，" + "非常期待与您沟通这个岗位。".repeat(30);
  const parsed = parseModelResult(JSON.stringify({
    decision: "recommend",
    category: "software_testing",
    confidence: 0.9,
    matchedKeywords: ["接口测试"],
    excludedKeywords: [],
    selectedProfileFacts: ["接口测试"],
    reason: "岗位匹配",
    greeting: longGreeting
  }));
  assert.equal(parsed.greeting, longGreeting);
});

test("模型结果中的候选人优势最多保留两项", () => {
  const parsed = parseModelResult(JSON.stringify({
    decision: "recommend",
    category: "software_testing",
    confidence: 0.9,
    matchedKeywords: ["接口测试"],
    excludedKeywords: [],
    selectedProfileFacts: ["接口测试", "Python自动化", "MySQL", "JMeter"],
    reason: "岗位匹配",
    greeting: "您好，希望沟通。"
  }));
  assert.deepEqual(parsed.selectedProfileFacts, ["接口测试", "Python自动化"]);
});

test("模型输入使用设置页保存的招呼语规则", () => {
  const analysis = analyzeJob(shanghaiSoftwareJob);
  const payload = buildModelPayload(
    shanghaiSoftwareJob,
    analysis,
    { ...DEFAULT_SETTINGS, greetingRules: "拟人化；有礼貌；结合招聘信息" },
    2
  );
  assert.equal(payload.greetingRules, "拟人化；有礼貌；结合招聘信息");
  assert.equal(payload.contactRound, 2);
  assert.match(payload.candidateSummary, /掌门AI一对一/u);
});

test("话术里的岗位名去掉括号备注、招聘前缀和福利尾巴，原始标题不变", () => {
  assert.equal(conversationalJobTitle("软件测试工程师（电商方向）"), "软件测试工程师");
  assert.equal(conversationalJobTitle("测试工程师(上海)(急招)"), "测试工程师");
  assert.equal(conversationalJobTitle("【急招】接口测试工程师"), "接口测试工程师");
  assert.equal(conversationalJobTitle("高级测试工程师-五险一金"), "高级测试工程师");
  assert.equal(conversationalJobTitle("徐汇区/诚聘测试工程师（无需加班）"), "测试工程师");
  assert.equal(conversationalJobTitle("产品+运营"), "产品+运营");
  const job = { title: "软件测试工程师（电商方向）", recruiterName: "陈女士", company: "示例公司", description: "负责订单和支付流程测试" };
  assert.equal(formatPreferredGreeting("看咱们软件测试工程师（电商方向）要做订单测试，（电商方向）这块我做过。", job),
    "陈老师您好，看咱们软件测试工程师要做订单测试，这块我做过。");
  const payload = buildModelPayload(job, analyzeJob(job), DEFAULT_SETTINGS);
  assert.equal(payload.job.jobTitle, "软件测试工程师");
  assert.equal(job.title, "软件测试工程师（电商方向）");
});

test("跳过关键词：分隔、去重、任意/全部/至少N个，英文按完整单词，留空不限制", () => {
  assert.deepEqual(parseKeywords("实习，外包;驻场\n外包；ECU, ecu"), ["实习", "外包", "驻场", "ECU"]);
  const job = { title: "软件测试工程师（外包驻场）", description: "负责ECU相关软件测试，需要长期出差。" };
  assert.equal(checkSkipKeywords(job, {}), null);
  assert.equal(checkSkipKeywords(job, null), null);
  assert.match(checkSkipKeywords(job, { skipTitleKeywords: "外包，实习" }).reasons[0], /岗位标题命中“外包”（命中任意1个）/u);
  assert.equal(checkSkipKeywords(job, { skipTitleKeywords: "外包，实习", skipTitleMode: "all" }), null);
  assert.ok(checkSkipKeywords(job, { skipTitleKeywords: "外包，驻场", skipTitleMode: "all" }));
  assert.equal(checkSkipKeywords(job, { skipDescriptionKeywords: "出差，夜班，单休", skipDescriptionMode: "count", skipDescriptionCount: 2 }), null);
  assert.match(checkSkipKeywords(job, { skipDescriptionKeywords: "出差，ECU，单休", skipDescriptionMode: "count", skipDescriptionCount: 2 }).reasons[0], /职位描述命中“出差、ECU”（至少命中2个不同词）/u);
  assert.equal(checkSkipKeywords({ title: "测试", description: "SECURE 平台" }, { skipDescriptionKeywords: "ECU" }), null);
  assert.equal(checkSkipKeywords({ title: "测试工程师" }, { skipDescriptionKeywords: "出差" }), null);
  const badge = jobOutcomeBadge({ status: "skipped", category: "filtered", reason: "跳过关键词：岗位标题命中“外包”（命中任意1个）" });
  assert.match(badge.text, /^本轮关键词跳过/u);
});
