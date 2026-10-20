import test from "node:test";
import assert from "node:assert/strict";
import {resolveCompanyRoles,detailProofSnapshot} from '../shared/identity.js';

const store = {};
let messageListener;
let nextTabId = 100;
const createdTabs = [];
const removedTabs = [];

globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        if (typeof keys === "string") return { [keys]: store[keys] };
        if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, store[key]]));
        return { ...store };
      },
      async set(values) {
        Object.assign(store, values);
      }
    }
  },
  tabs: {
    async create(options) {
      const tab = { id: nextTabId++, ...options };
      createdTabs.push(tab);
      return tab;
    },
    async remove(tabId) {
      removedTabs.push(tabId);
    }
  },
  runtime: {
    getManifest() {return {version:'0.4.12'};},
    getURL(path) { return `chrome-extension://test/${path}`; },
    onInstalled: { addListener() {} },
    onMessage: { addListener(listener) { messageListener = listener; } }
  }
};

await import(`../background.js?test=${Date.now()}`);

function send(message, sender = { url: "https://www.zhipin.com/web/geek/jobs", tab: { id: 11 } }) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("background response timeout")), 5000);
    messageListener(message, sender, (response) => {
      clearTimeout(timeout);
      resolve(response);
    });
  });
}

const softwareJob = {
  title: "软件测试工程师",
  company: "示例科技",
  location: "上海",
  description: "负责Web和接口功能测试，使用Postman和MySQL验证业务数据。",
  recruiterName: "陈老师",
  activityText: "今日活跃",
  tags: ["功能测试", "接口测试"],
  url: "https://www.zhipin.com/job_detail/test-job-1.html"
};

test('新版诊断经真实后台保存再读取：版本、标签、分项值可见，消息图片与Key不落日志',async()=>{
  const previous=store.settings;
  store.settings={...previous,apiKey:'TEST_DIAGNOSTIC_SECRET'};
  try {
    const result=await send({type:'APPEND_DIAGNOSTIC',event:{runId:'diagnostic-test',stage:'临时详情身份核对',result:'read_error',reason:'招聘者读取失败',
      job:softwareJob,expected:{...softwareJob,jobKey:'target'},observed:{title:softwareJob.title,recruiterName:''},
      details:{code:'recruiter_missing_observed',pageType:'detail',pageUrl:'https://www.zhipin.com/job_detail/target.html?token=PRIVATE#data',
        rootFound:true,recruiterSource:'not_found',attempts:50,elapsedMs:15000,apiKey:'PRIVATE',message:'PRIVATE',html:'PRIVATE',resumeImage:'PRIVATE',
        checks:[{field:'recruiter',label:'招聘者',status:'missing_observed',expected:'TEST_DIAGNOSTIC_SECRET',observed:''}]}}},
      {url:'https://www.zhipin.com/job_detail/target.html?secret=PRIVATE',tab:{id:321}});
    assert.equal(result.ok,true);
    const logs=await send({type:'GET_DIAGNOSTICS'});
    const entry=logs.events.find(event=>event.runId==='diagnostic-test');
    assert.equal(entry.extensionVersion,'0.4.12');assert.equal(entry.tabId,321);assert.equal(entry.logSchemaVersion,2);
    assert.equal(entry.details.checks[0].expected,'[REDACTED]');
    assert.equal(entry.details.attempts,50);assert.equal(entry.expected.recruiterName,softwareJob.recruiterName);
    assert.doesNotMatch(JSON.stringify(entry),/PRIVATE|TEST_DIAGNOSTIC_SECRET|resumeImage|"html"/u);
  } finally {store.settings=previous;}
});

test("开始运行、记录岗位、保存待发送消息和成功计数形成闭环", async () => {
  const started = await send({
    type: "START_AUTOMATION",
    runLimit: 2,
    sourceUrl: "https://www.zhipin.com/web/geek/jobs",
    sourcePlan: { label: "测试开发（上海）", key: "测试开发(上海)" }
  });
  assert.equal(started.ok, true);
  assert.equal(started.session.schemaVersion, 11);
  assert.equal(started.session.sourcePlan.label, "测试开发（上海）");
  assert.equal(started.session.runLimit, 2);
  assert.equal(started.session.successCount, 0);

  const registered = await send({
    type: "REGISTER_AUTOMATION_JOB",
    sessionId: started.session.id,
    job: softwareJob,
    analysis: { decision: "recommend", category: "software_testing", score: 80, reasons: ["符合"] },
    status: "queued",
    reason: "准备发送"
  });
  assert.equal(registered.ok, true);
  assert.equal(registered.publicSession.scannedCount, 1);

  const pending = await send({
    type: "SET_PENDING_DELIVERY",
    delivery: {
      mode: "auto",
      automationRunId: started.session.id,
      job: softwareJob,
      message: "陈老师您好，我有接口和功能测试经验，希望和您沟通一下岗位。",
      round: 1,
      sourceUrl: "https://www.zhipin.com/web/geek/jobs"
    }
  });
  assert.equal(pending.ok, true);
  assert.equal(pending.pending.job.title, softwareJob.title);

  const opened = await send({ type: "OPEN_DELIVERY_WORKER" });
  assert.equal(opened.ok, true);
  assert.equal(opened.pending.originTabId, 11);
  assert.equal(opened.pending.workerTabId, 100);
  assert.deepEqual(createdTabs[0], { id: 100, url: softwareJob.url, active: false });
  const workerSender = { url: softwareJob.url, tab: { id: 100 } };
  const claimed = await send({ type: "GET_PENDING_DELIVERY" }, workerSender);
  assert.equal(claimed.isWorker, true);
  assert.equal(claimed.workerRole, "detail");
  const openingChat = await send({
    type: "UPDATE_PENDING_DELIVERY",
    deliveryId: pending.pending.id,
    stage: "opening_chat"
  }, workerSender);
  assert.equal(openingChat.ok, true);
  const chatSender = {
    url: "https://www.zhipin.com/web/geek/chat?id=test-job-1",
    tab: { id: 101, openerTabId: 100 }
  };
  const chatClaim = await send({
    type: "GET_PENDING_DELIVERY",
    pageText: "陈老师 示例科技 软件测试工程师"
  }, chatSender);
  assert.equal(chatClaim.isWorker, true);
  assert.equal(chatClaim.workerRole, "chat");
  assert.equal(chatClaim.pending.chatTabId, 101);

  const recorded = await send({
    type: "RECORD_SEND",
    deliveryId: pending.pending.id,
    automationRunId: started.session.id,
    job: softwareJob,
    message: pending.pending.message,
    round: 1,
    resumeImageStatus: "sent",
    resumeImageName: "resume.png"
  }, chatSender);
  assert.equal(recorded.ok, true);
  assert.equal(recorded.automationSession.successCount, 1);
  assert.equal(recorded.automationSession.status, "running");
  assert.ok(recorded.perSendRestSeconds >= 1 && recorded.perSendRestSeconds <= 3);
  assert.equal((await send({ type: "GET_PENDING_DELIVERY" })).pending, null);
  const outcome = await send({ type: "GET_DELIVERY_OUTCOME", deliveryId: pending.pending.id });
  assert.equal(outcome.outcome.resumeImageStatus, "sent");
  assert.equal(outcome.outcome.workerTabId, 100);
  assert.equal(outcome.outcome.chatTabId, 101);
  const closing = await send({ type: "CLOSE_DELIVERY_WORKER", deliveryId: pending.pending.id }, chatSender);
  assert.equal(closing.ok, true);

  const markers = await send({ type: "GET_CONTACT_MARKERS" });
  assert.equal(markers.ok, true);
  assert.equal(markers.jobs["test-job-1"].attempts, 1);
  assert.equal(markers.companies["示例科技"].attempts, 1);

  store.cooldownUntil = 0;
  const sameCompany = await send({
    type: "CHECK_CONTACT",
    job: { ...softwareJob, title: "App测试工程师", url: "https://www.zhipin.com/job_detail/test-job-company.html" }
  });
  assert.equal(sameCompany.allowed, false);
  assert.match(sameCompany.reason, /同公司其他岗位.*24 小时/u);

  const secondJob = { ...softwareJob, title: "Web测试工程师", url: "https://www.zhipin.com/job_detail/test-job-2.html" };
  await send({
    type: "REGISTER_AUTOMATION_JOB",
    sessionId: started.session.id,
    job: secondJob,
    analysis: { decision: "recommend", category: "software_testing", score: 78, reasons: ["符合"] },
    status: "queued"
  });
  const secondRecorded = await send({
    type: "RECORD_SEND",
    automationRunId: started.session.id,
    job: secondJob,
    message: "您好，我有Web和接口测试经验，希望和您沟通一下岗位。",
    round: 1
  });
  assert.equal(secondRecorded.automationSession.successCount, 2);
  assert.equal(secondRecorded.automationSession.status, "completed");
  assert.match(secondRecorded.automationSession.reason, /本轮 2 条/u);
});

test("重新设置新一轮会重置本轮计数但保留当日成功数", async () => {
  const previousDaily = store.dailyStats.successfulContacts;
  const restarted = await send({
    type: "START_AUTOMATION",
    runLimit: 7,
    sourceUrl: "https://www.zhipin.com/web/geek/jobs",
    sourcePlan: { label: "测试开发（上海）", key: "测试开发(上海)" }
  });
  assert.equal(restarted.session.runLimit, 7);
  assert.equal(restarted.session.successCount, 0);
  const state = await send({ type: "GET_STATE" });
  assert.equal(state.dailyStats.successfulContacts, previousDaily);
});

test("没有锁定顶部求职方向时拒绝启动，避免落入推荐列表", async () => {
  const response = await send({
    type: "START_AUTOMATION",
    runLimit: 3,
    sourceUrl: "https://www.zhipin.com/web/geek/jobs"
  });
  assert.equal(response.ok, false);
  assert.match(response.error, /顶部求职方向/u);
});

test("旧设置也会自动补上短板与菜单式话术限制", async () => {
  const optionsSender = { url: "chrome-extension://test/options.html" };
  const saved = await send({ type: "SAVE_SETTINGS", settings: { greetingRules: "拟人化；有礼貌；结合岗位信息" } }, optionsSender);
  assert.equal(saved.ok, true);
  const current = await send({ type: "GET_SETTINGS", includeApiKey: true }, optionsSender);
  assert.match(current.settings.greetingRules, /不得出现不会、没做过/u);
  assert.match(current.settings.greetingRules, /只选最相关的1至2项/u);
  assert.match(current.settings.greetingRules, /最多提及2个工具或技术栈/u);
});

test("简历图片只能由设置页保存读取，并只交给当前临时投递页或其聊天页", async () => {
  const optionsSender = { url: "chrome-extension://test/options.html" };
  const image = {
    name: "我的简历.png",
    type: "image/png",
    size: 4,
    dataUrl: "data:image/png;base64,dGVzdA=="
  };
  const saved = await send({ type: "SAVE_RESUME_IMAGE", image }, optionsSender);
  assert.equal(saved.ok, true);
  assert.equal(saved.configured, true);
  assert.equal(Object.hasOwn(saved, "dataUrl"), false);

  const denied = await send({ type: "GET_RESUME_IMAGE" });
  assert.equal(denied.ok, false);
  assert.match(denied.error, /设置页/u);
  const optionsRead = await send({ type: "GET_RESUME_IMAGE" }, optionsSender);
  assert.equal(optionsRead.image.dataUrl, image.dataUrl);

  await send({ type: "SAVE_SETTINGS", settings: { attachResumeImage: true } }, optionsSender);
  const started = await send({
    type: "START_AUTOMATION",
    runLimit: 1,
    sourceUrl: "https://www.zhipin.com/web/geek/jobs",
    sourcePlan: { label: "测试开发（上海）", key: "测试开发(上海)" }
  });
  const pending = await send({
    type: "SET_PENDING_DELIVERY",
    delivery: {
      mode: "auto",
      automationRunId: started.session.id,
      job: softwareJob,
      message: "陈老师您好，看您贵公司在招软件测试工程师，想和您沟通一下。",
      round: 1,
      sourceUrl: "https://www.zhipin.com/web/geek/jobs"
    }
  });
  const opened = await send({ type: "OPEN_DELIVERY_WORKER" });
  const wrongTabRead = await send({ type: "GET_RESUME_IMAGE_FOR_DELIVERY", deliveryId: pending.pending.id });
  assert.equal(wrongTabRead.ok, false);
  assert.match(wrongTabRead.error, /临时投递页/u);
  const workerSender = { url: softwareJob.url, tab: { id: opened.workerTabId } };
  const workerRead = await send({ type: "GET_RESUME_IMAGE_FOR_DELIVERY", deliveryId: pending.pending.id }, workerSender);
  assert.equal(workerRead.ok, true);
  assert.equal(workerRead.enabled, true);
  assert.equal(workerRead.image.dataUrl, image.dataUrl);
  await send({ type: "UPDATE_PENDING_DELIVERY", deliveryId: pending.pending.id, stage: "opening_chat" }, workerSender);
  const chatSender = {
    url: "https://www.zhipin.com/web/geek/chat?id=test-job-1",
    tab: { id: 202, openerTabId: opened.workerTabId }
  };
  const adopted = await send({ type: "GET_PENDING_DELIVERY", pageText: "示例科技 软件测试工程师" }, chatSender);
  assert.equal(adopted.isWorker, true);
  const chatRead = await send({ type: "GET_RESUME_IMAGE_FOR_DELIVERY", deliveryId: pending.pending.id }, chatSender);
  assert.equal(chatRead.ok, true);
  assert.equal(chatRead.image.dataUrl, image.dataUrl);
  await send({ type: "STOP_AUTOMATION", reason: "测试结束" });
});

test("无关聊天页不能接管待发送任务", async () => {
  const started = await send({
    type: "START_AUTOMATION",
    runLimit: 1,
    sourceUrl: "https://www.zhipin.com/web/geek/jobs",
    sourcePlan: { label: "测试开发（上海）", key: "测试开发(上海)" }
  });
  const pending = await send({
    type: "SET_PENDING_DELIVERY",
    delivery: {
      mode: "auto",
      automationRunId: started.session.id,
      job: softwareJob,
      message: "陈老师您好，看您贵公司在招软件测试工程师，想和您沟通一下。",
      round: 1,
      sourceUrl: "https://www.zhipin.com/web/geek/jobs"
    }
  });
  const opened = await send({ type: "OPEN_DELIVERY_WORKER" });
  const detailSender = { url: softwareJob.url, tab: { id: opened.workerTabId, windowId: 8 } };
  await send({ type: "UPDATE_PENDING_DELIVERY", deliveryId: pending.pending.id, stage: "opening_chat" }, detailSender);
  const unrelated = await send({
    type: "GET_PENDING_DELIVERY",
    pageText: "其他招聘者 其他公司 其他岗位"
  }, {
    url: "https://www.zhipin.com/web/geek/chat?id=unrelated",
    tab: { id: 303, windowId: 99 }
  });
  assert.equal(unrelated.isWorker, false);
  assert.equal(unrelated.pending.chatTabId, null);
  const denied = await send({ type: "GET_RESUME_IMAGE_FOR_DELIVERY", deliveryId: pending.pending.id }, {
    url: "https://www.zhipin.com/web/geek/chat?id=unrelated",
    tab: { id: 303, windowId: 99 }
  });
  assert.equal(denied.ok, false);
  await send({ type: "STOP_AUTOMATION", reason: "测试结束" });
});

test("菜单式模型话术会携带原因自动重写一次", async () => {
  store.cooldownUntil = 0;
  const optionsSender = { url: "chrome-extension://test/options.html" };
  await send({
    type: "SAVE_SETTINGS",
    settings: {
      apiKey: "test-key",
      model: "test-model",
      apiBaseUrl: "https://open.bigmodel.cn/api/paas/v4"
    }
  }, optionsSender);
  const targetJob = {
    ...softwareJob,
    title: "接口测试工程师",
    company: "另一测试公司",
    url: "https://www.zhipin.com/job_detail/model-rewrite-job.html"
  };
  const replies = [
    "我熟悉功能测试、接口测试、自动化测试、性能测试，会用Postman、Apifox、MySQL、Charles、Linux、pytest和JMeter。",
    "我有3年软件测试经验，熟悉使用Postman进行接口验证，也能用Python编写接口自动化脚本。岗位要求和我的经历比较匹配，期待您的回复，感谢！"
  ];
  const originalFetch = globalThis.fetch;
  const requestBodies = [];
  globalThis.fetch = async (_url, options) => {
    requestBodies.push(JSON.parse(options.body));
    const greeting = replies[requestBodies.length - 1];
    return {
      ok: true,
      async json() {
        return {
          model: "test-model",
          choices: [{ message: { content: JSON.stringify({
            decision: "recommend",
            category: "software_testing",
            confidence: 0.9,
            matchedKeywords: ["接口测试", "Python"],
            excludedKeywords: [],
            selectedProfileFacts: ["3年测试经验", "Python接口自动化"],
            reason: "岗位匹配",
            greeting
          }) } }]
        };
      }
    };
  };
  try {
    const generated = await send({ type: "GENERATE_GREETING", job: targetJob });
    assert.equal(generated.ok, true);
    assert.equal(requestBodies.length, 2);
    assert.match(requestBodies[1].messages[1].content, /像在背技能清单/u);
    assert.match(generated.modelResult.greeting, /^陈老师您好，看贵公司在招聘接口测试工程师岗位，/u);
    assert.doesNotMatch(generated.modelResult.greeting, /JMeter/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('旧版2到8秒配置自动迁移为1到3秒且不改API Key或公司防重设置', async () => {
  const original=store.settings;
  store.settings={...original,perSendRestMinSeconds:2,perSendRestMaxSeconds:8,pacingVersion:1,companyCooldownHours:24};
  const result=await send({type:'GET_SETTINGS',includeApiKey:true},{url:'chrome-extension://test/options.html'});
  assert.equal(result.settings.perSendRestMinSeconds,1);
  assert.equal(result.settings.perSendRestMaxSeconds,3);
  assert.equal(result.settings.companyCooldownHours,24);
  assert.equal(result.settings.apiKey,original.apiKey);
  store.settings=original;
});

test('读取失败和话术问题分开计数，未重复累计跳过且日志重读仍存在', async () => {
  const started=await send({type:'START_AUTOMATION',runLimit:2,sourceUrl:'https://www.zhipin.com/web/geek/jobs',sourcePlan:{key:'测试(上海)',label:'测试(上海)'}});
  const id=started.session.id;
  const diagnosticJob={...softwareJob,url:'https://www.zhipin.com/job_detail/log-job.html'};
  const registered=await send({type:'REGISTER_AUTOMATION_JOB',sessionId:id,job:diagnosticJob,status:'read_error',reason:'读取失败：右侧没有完整加载'});
  assert.equal(registered.publicSession.skippedCount,0);
  assert.equal(registered.publicSession.readErrorCount,1);
  await send({type:'MARK_AUTOMATION_CANDIDATE',sessionId:id,jobKey:'log-job',status:'generation_error',reason:'模型接口请求失败'});
  let state=await send({type:'GET_AUTOMATION'});
  assert.equal(state.publicSession.generationErrorCount,1);
  assert.equal(state.publicSession.skippedCount,0);
  for(let i=0;i<2;i++) await send({type:'MARK_AUTOMATION_CANDIDATE',sessionId:id,jobKey:'log-job',status:'skipped',reason:'当前暂缓方向：光学'});
  state=await send({type:'GET_AUTOMATION'});
  assert.equal(state.publicSession.skippedCount,1);
  const logs=await send({type:'GET_DIAGNOSTICS'});
  assert.equal(logs.current.rows[0].reason,'当前暂缓方向：光学');
  assert.ok(logs.events.some(event=>event.result==='read_error'));
  assert.ok(logs.archive.length>0);
  await send({type:'STOP_AUTOMATION',reason:'隔离测试结束'});
});

test('阶段日志只保存白名单，去掉Key、消息与简历数据', async () => {
  const event={runId:'privacy-test',stage:'读取',reason:'error test-key',job:{...softwareJob,apiKey:'secret',message:'PRIVATE_MESSAGE',resumeImage:'PRIVATE_IMAGE'},expected:softwareJob,observed:softwareJob};
  const response=await send({type:'APPEND_DIAGNOSTIC',event});
  const output=JSON.stringify(response);
  assert.doesNotMatch(output,/test-key|PRIVATE_MESSAGE|PRIVATE_IMAGE|description|securityId/u);
  assert.match(output,/REDACTED/u);
});

test('两次菜单式话术后使用一项真实匹配经历，不再错误丢弃推荐岗位', async () => {
  store.cooldownUntil=0;
  const originalFetch=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async()=>({ok:true,async json(){calls++;return {choices:[{message:{content:JSON.stringify({decision:'recommend',reason:'匹配',greeting:'熟悉Postman、MySQL、Python、JMeter、Charles、pytest和Linux。'})}}]};}});
  try {
    const response=await send({type:'GENERATE_GREETING',job:{...softwareJob,company:'独立备用话术测试公司',url:'https://www.zhipin.com/job_detail/fallback-job.html'}});
    assert.equal(response.ok,true);
    assert.equal(calls,2);
    assert.equal(response.modelResult.fallbackUsed,true);
    assert.equal(response.modelResult.decision,'recommend');
    assert.match(response.modelResult.greeting,/Postman/u);
    assert.doesNotMatch(response.modelResult.greeting,/没做过|不会|JMeter/u);
  } finally {globalThis.fetch=originalFetch;}
});

function resetContactStore() {
  store.jobHistories={};store.dailyStats={};store.cooldownUntil=0;
  store.pendingDelivery=null;store.automationSession=null;store.diagnosticEvents=[];
}

test('实际后台防重：同外包商不同HR不一并拦截，同岗位与同HR仍限制',async()=>{
  resetContactStore();
  const job={...softwareJob,...resolveCompanyRoles({listingCompany:'服务商',detailCompany:'甲方A',recruiterCompany:'服务商'}),
    company:'服务商',recruiterName:'王明',url:'https://www.zhipin.com/job_detail/agency-first.html'};
  const sent=await send({type:'RECORD_SEND',job,message:'offline test',round:1});
  assert.equal(sent.ok,true);store.cooldownUntil=0;
  assert.equal(store.jobHistories['agency-first'].recruiterCompany,'服务商');
  assert.equal(store.jobHistories['agency-first'].recruitmentMode,'multi_entity');
  assert.equal((await send({type:'CHECK_CONTACT',job})).allowed,false);
  const other={...job,detailCompany:'甲方B',recruiterName:'李明',url:'https://www.zhipin.com/job_detail/agency-second.html'};
  assert.equal((await send({type:'CHECK_CONTACT',job:other})).allowed,true);
  const sameHR=await send({type:'CHECK_CONTACT',job:{...other,recruiterName:'王明'}});
  assert.equal(sameHR.allowed,false);assert.match(sameHR.reason,/同一招聘者/u);
  const markers=await send({type:'GET_CONTACT_MARKERS'});
  assert.equal(markers.companies['服务商'],undefined);
  assert.equal(markers.jobs['agency-first'].attempts,1);
});

test('明确甲方才执行同甲方防重，未知角色的旧记录不会锁住甲方',async()=>{
  resetContactStore();
  const base={...softwareJob,...resolveCompanyRoles({listingCompany:'外包服务商',recruiterCompany:'外包服务商',employerCompany:'甲方科技',agencyText:'猎头'}),
    company:'外包服务商',recruiterName:'王明',url:'https://www.zhipin.com/job_detail/client-first.html'};
  await send({type:'RECORD_SEND',job:base,message:'offline test',round:1});store.cooldownUntil=0;
  const other={...base,recruiterName:'李明',url:'https://www.zhipin.com/job_detail/client-second.html'};
  const hold=await send({type:'CHECK_CONTACT',job:other});
  assert.equal(hold.allowed,false);assert.match(hold.reason,/同公司/u);
  const legacy=structuredClone(store.jobHistories['client-first']);
  delete legacy.companyRoleVersion;legacy.company='甲方科技';
  store.jobHistories={'client-first':legacy};
  assert.equal((await send({type:'CHECK_CONTACT',job:other})).allowed,true);
});

test('待发送任务保存公司角色，不把招聘公司覆盖成甲方',async()=>{
  resetContactStore();
  const job={...softwareJob,...resolveCompanyRoles({listingCompany:'客户企业',recruiterCompany:'代理商',detailCompany:'代理商'})};
  const result=await send({type:'SET_PENDING_DELIVERY',delivery:{mode:'manual',job,message:'offline',sourceUrl:'https://www.zhipin.com/web/geek/jobs'}});
  assert.equal(result.pending.job.recruiterCompany,'代理商');
  assert.equal(result.pending.job.employerCompany,'');
  assert.equal(result.pending.job.companyRoleVersion,1);
  await send({type:'CLEAR_PENDING_DELIVERY'});
});

test('独立详情194与167字符差异只记日志，绑定列表且只读，不创建待发消息',async()=>{
  resetContactStore();
  const started=await send({type:'START_AUTOMATION',runLimit:2,sourceUrl:'https://www.zhipin.com/web/geek/jobs',sourcePlan:{key:'测试(上海)',label:'测试(上海)'}});
  const observed={...softwareJob,url:'https://www.zhipin.com/job_detail/proof-job.html',description:'列表的完整公开岗位正文'.padEnd(194,'测'),recruiterName:'王明'};
  const independent={...observed,description:'独立的完整公开岗位正文'.padEnd(167,'试')};
  const originalGet=chrome.tabs.get,originalSend=chrome.tabs.sendMessage;
  const startCreated=createdTabs.length,startRemoved=removedTabs.length;
  const requests=[];
  chrome.tabs.get=async id=>({id,status:'complete',url:id===11 ? 'https://www.zhipin.com/web/geek/jobs' : observed.url});
  chrome.tabs.sendMessage=async(id,message)=>{requests.push(message.type);return {ready:true,jobKey:'proof-job',url:observed.url,...independent};};
  try {
    const result=await send({type:'VERIFY_JOB_IDENTITY',sessionId:started.session.id,jobUrl:observed.url,observed});
    assert.equal(result.ok,true);assert.equal(result.proof.jobKey,'proof-job');
    assert.deepEqual(result.proof.listSnapshot,detailProofSnapshot(observed));
    assert.equal(result.proof.description,independent.description);
    assert.equal(createdTabs.length,startCreated+1);assert.equal(createdTabs.at(-1).active,false);
    assert.equal(removedTabs.slice(startRemoved).filter(id=>id===createdTabs.at(-1).id).length,1);
    assert.equal(removedTabs.at(-1),createdTabs.at(-1).id);
    assert.ok(requests.every(type=>type==='READ_ONLY_JOB_IDENTITY'));
    assert.equal(store.pendingDelivery,null);assert.deepEqual(store.jobHistories,{});
    const ready=store.diagnosticEvents.find(event=>event.runId===started.session.id && event.stage==='公司角色核对' && event.result==='ready');
    assert.ok(ready);
    assert.equal(ready.details.code,'independent_identity_confirmed_text_difference');
    assert.equal(ready.details.expectedDescriptionLength,194);
    assert.equal(ready.details.descriptionLength,167);
    assert.equal(ready.details.descriptionEqual,false);
    assert.equal(ready.observed.title,independent.title);
    assert.equal(ready.observed.recruiterName,independent.recruiterName);
    assert.doesNotMatch(JSON.stringify(store.diagnosticEvents),/完整公开岗位正文/u);
  } finally {chrome.tabs.get=originalGet;chrome.tabs.sendMessage=originalSend;}
});

test('独立核对遇到平台限制或错误岗位ID时清理标签，不放行也不发送',async()=>{
  resetContactStore();
  const started=await send({type:'START_AUTOMATION',runLimit:2,sourceUrl:'https://www.zhipin.com/web/geek/jobs',sourcePlan:{key:'测试(上海)',label:'测试(上海)'}});
  const observed={...softwareJob,url:'https://www.zhipin.com/job_detail/proof-block.html'};
  const originalGet=chrome.tabs.get,originalSend=chrome.tabs.sendMessage;
  chrome.tabs.get=async id=>({id,status:'complete',url:id===11 ? 'https://www.zhipin.com/web/geek/jobs' : observed.url});
  try {
    for(const snapshot of [{error:'独立核对页出现平台限制：安全验证'},{ready:true,jobKey:'wrong-id',url:observed.url,...observed}]) {
      chrome.tabs.sendMessage=async()=>snapshot;
      const result=await send({type:'VERIFY_JOB_IDENTITY',sessionId:started.session.id,jobUrl:observed.url,observed});
      assert.equal(result.ok,false);assert.match(result.error,/限制|ID不一致/u);
      assert.equal(removedTabs.at(-1),createdTabs.at(-1).id);assert.equal(store.pendingDelivery,null);
    }
    const before=createdTabs.length;
    const external=await send({type:'VERIFY_JOB_IDENTITY',sessionId:started.session.id,jobUrl:'https://example.com/job_detail/attack.html',observed});
    assert.equal(external.ok,false);assert.equal(createdTabs.length,before);
  } finally {chrome.tabs.get=originalGet;chrome.tabs.sendMessage=originalSend;}
});

test('独立核对中用户停止，本页被清理且不会继续完成任务',async()=>{
  resetContactStore();
  const started=await send({type:'START_AUTOMATION',runLimit:2,sourceUrl:'https://www.zhipin.com/web/geek/jobs',sourcePlan:{key:'测试(上海)',label:'测试(上海)'}});
  const observed={...softwareJob,url:'https://www.zhipin.com/job_detail/proof-stop.html'};
  const originalGet=chrome.tabs.get,originalSend=chrome.tabs.sendMessage;
  chrome.tabs.get=async id=>({id,status:'complete',url:id===11 ? 'https://www.zhipin.com/web/geek/jobs' : observed.url});
  chrome.tabs.sendMessage=async()=>{store.automationSession.status='stopped';return {ready:false};};
  try {
    const result=await send({type:'VERIFY_JOB_IDENTITY',sessionId:started.session.id,jobUrl:observed.url,observed});
    assert.equal(result.ok,false);assert.match(result.error,/已停止/u);
    assert.equal(removedTabs.at(-1),createdTabs.at(-1).id);assert.equal(store.pendingDelivery,null);
  } finally {chrome.tabs.get=originalGet;chrome.tabs.sendMessage=originalSend;}
});
