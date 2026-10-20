export const CANDIDATE_SUMMARY = `具备3年软件测试及教育产品测试经验，参与掌门AI一对一、掌门好家长及掌门优课CRM等存量产品的版本回归和部分新增功能测试，覆盖Android App、Web及H5端。熟悉软件测试流程，能够参与需求评审、需求分析、测试分析、测试点梳理、测试用例设计、测试执行、缺陷提交与跟踪、修复验证、回归测试、上线前验收及线上验证，并能够根据需求变更、上下游依赖、版本影响范围和历史缺陷确定回归重点。熟悉功能测试、接口测试、业务流程测试、异常测试、边界测试、权限测试、兼容性测试及数据一致性验证，能够使用Postman、Apifox验证登录鉴权、参数校验、错误码、权限控制、接口关联、重复请求、异常场景及业务状态流转。能够使用MySQL编写SQL查询业务数据，结合客户端表现、接口请求与响应、Charles抓包、adb logcat、Linux服务端日志、运营后台及数据库记录还原问题链路，协助定位客户端、接口、服务端及跨端数据不一致问题。具备订单、支付状态同步、课程权益、预约排课、取消课程、课时退回、退款、客户管理、数据权限及CRM业务测试经验。具备Python、Requests、pytest接口自动化回归实践，能够维护请求、鉴权、测试数据和公共断言，使用YAML管理测试数据、Allure生成测试报告并分析失败结果；能够使用JMeter参与基础并发测试和性能回归，关注TPS、P95响应时间、错误率及并发稳定性。参与过AI水平诊断、口语测评和学习建议等功能测试，具备Dify批量评测、标准答案校验、规则断言、人工抽检及LLM-as-Judge评测实践。`;

// 0.4.18及更早版本的默认写作要求；用于把已保存的旧默认规则迁移为新版。
export const LEGACY_GREETING_RULES = "1. 拟人化，像真人自然交流\n2. 有礼貌\n3. 结合当前招聘信息中的职责或要求打招呼\n4. 只表达已经具备的匹配优势，不得出现不会、没做过、不了解、经验不足或先承认短板再表示愿意学习的内容\n5. 正文必须以当前岗位职责和任职要求为主，从个人总结中只选最相关的1至2项经历去回应，不得罗列个人优势清单\n6. 最多提及2个工具或技术栈名称，不得连续堆砌测试类型、端、平台、工具或业务名词\n7. 只有输入明确提供候选人居住地且与岗位地址相近时，才能写公司离家近；不得仅因岗位在上海就推断离家近";

export const DEFAULT_SETTINGS = Object.freeze({
  candidateSummary: CANDIDATE_SUMMARY,
  modelProvider: "zhipu",
  apiBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
  model: "glm-4.7-flash",
  apiKey: "",
  greetingRules: "1. 用求职者本人的口吻写，像真人在BOSS上随手发给HR的消息：口语、自然、有温度，不要书面套话和模板腔\n2. 先读职位描述：从岗位职责和任职要求里挑出1至2个最核心的点，开场就点出你注意到了这些具体内容，可以直接用JD里的业务、职责或技术关键词\n3. 再结合个人总结，针对这几个点讲自己做过的相关事情：在什么业务里做的、怎么做的、解决了什么问题；可以围绕个人总结自然展开，补充具体的场景和细节，让HR觉得你确实干过这类活，而不是空泛地说“经历很匹配”\n4. 不要罗列技能清单，最多提及2个工具或技术栈名称，不得连续堆砌测试类型、端、平台、工具或业务名词\n5. 不得出现不会、没做过、不了解、经验不足或先承认短板再表示愿意学习的内容\n6. 3至4句话、80至150字左右，结尾像聊天一样自然地表示想进一步聊聊，不要每条都用“期待您的回复，感谢！”\n7. 每条措辞都要跟着当前岗位变化，不要用“我对贵公司岗位很感兴趣”“我的经历与岗位要求比较匹配”这类千篇一律的句子",
  greetingRulesVersion: 2,
  skipTitleKeywords: "",
  skipTitleMode: "any",
  skipTitleCount: 2,
  skipDescriptionKeywords: "",
  skipDescriptionMode: "any",
  skipDescriptionCount: 2,
  dailyLimit: 500,
  batchSize: 10,
  restMinSeconds: 10,
  restMaxSeconds: 30,
  perSendRestMinSeconds: 1,
  perSendRestMaxSeconds: 3,
  pacingVersion: 2,
  defaultRunLimit: 20,
  defaultHrActivityFilter: 'within3days',
  secondContactMinHours: 4,
  companyCooldownHours: 24,
  secondContactSameDay: true,
  thirdContactNextDay: true,
  maxContactsPerJob: 3,
  attachResumeImage: false,
  previewBeforeSend: true,
  enableDirectSend: false
});

export function normalizeApiBaseUrl(value = "") {
  const raw = String(value).trim().replace(/\/+$/u, "");
  return raw.replace(/\/chat\/completions$/iu, "").replace(/\/+$/u, "");
}
