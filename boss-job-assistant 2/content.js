(async () => {
  if (window.__BOSS_JOB_ASSISTANT_LOADED__) return;
  window.__BOSS_JOB_ASSISTANT_LOADED__ = true;

  const core = await import(chrome.runtime.getURL("shared/core.js"));
  const { analyzeJob, precheckExplicitTitle, precheckAgency, precheckTechCompany, jobOutcomeBadge, normalizeCompanyKey, normalizeText, recruiterSalutation, stableJobKey,
    HR_ACTIVITY_FILTERS, HR_ACTIVITY_LABEL_PATTERN, hrActivityLabel, checkHrActivity, normalizeHrActivityFilter } = core;
  const { visibleText, resolveCard, detailReady, detailReadiness, detailFingerprint } = await import(chrome.runtime.getURL("shared/page.js"));
  const {resolveCompanyRoles, independentDetailMatches, conversationIdentityMatches, destinationIdentityReport} = await import(chrome.runtime.getURL("shared/identity.js"));
  const {readChatIdentity} = await import(chrome.runtime.getURL("shared/chat.js"));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const sourceDocumentToken = crypto.randomUUID();

  const state = {
    job: null,
    analysis: null,
    modelResult: null,
    round: 1,
    settings: null,
    automation: null,
    contactMarkers: { jobs: {}, companies: {} },
    busy: false,
    engineBusy: false,
    stopRequested: false,
    lastFingerprint: ""
  };
  state.refreshSequence = 0;
  state.clickedJobKey = null;
  state.contact = null;
  state.diagnostics = null;
  state.identityProof = null;
  state.pageDeparted = false;
  state.departureSequence = 0;

  const host = document.createElement("div");
  host.id = "boss-job-assistant-host";
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host{all:initial}.panel{position:fixed;right:18px;bottom:18px;z-index:2147483646;width:390px;max-height:calc(100vh - 36px);overflow:auto;box-sizing:border-box;border:1px solid #dfe7e8;border-radius:14px;background:#fff;color:#1f2d2f;box-shadow:0 12px 38px rgba(15,46,49,.18);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;font-size:13px;line-height:1.55}.panel.collapsed{width:230px}.panel.collapsed .body{display:none}.header{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#00bebd;color:#fff}.header strong{flex:1;font-size:15px}.icon-button{border:0;background:rgba(255,255,255,.18);color:#fff;border-radius:7px;padding:4px 8px;cursor:pointer}.body{padding:13px 14px 15px}.run-box{margin-bottom:12px;padding:10px;border:1px solid #d8e7e8;border-radius:10px;background:#f7fbfb}.run-title{display:flex;justify-content:space-between;gap:8px;font-weight:700}.run-controls{display:grid;grid-template-columns:92px 1fr 1fr;gap:7px;margin-top:8px}.run-controls input{width:100%;box-sizing:border-box;border:1px solid #bfcfd1;border-radius:8px;padding:7px;font:inherit}.progress{margin-top:7px;color:#536b6e;white-space:pre-wrap}.status{display:inline-flex;border-radius:999px;padding:3px 9px;font-weight:700}.recommend{color:#067647;background:#ecfdf3}.review{color:#9a6700;background:#fff7d6}.postpone,.exclude{color:#b42318;background:#fef3f2}.muted{color:#6b7c7e}.job{margin:10px 0;padding-bottom:10px;border-bottom:1px solid #edf1f2}.job-title{font-size:15px;font-weight:700}.meta{margin-top:3px;color:#56696c;word-break:break-word}.reasons{margin:9px 0;padding-left:18px}.reasons li{margin:3px 0}.greeting{width:100%;min-height:92px;resize:vertical;box-sizing:border-box;border:1px solid #cad7d8;border-radius:9px;padding:9px;color:#1f2d2f;font:inherit}.buttons{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}button.action{border:1px solid #00aead;border-radius:8px;padding:8px 9px;cursor:pointer;background:#fff;color:#007c7b;font:inherit;font-weight:600}button.action.primary{background:#00bdbc;color:#fff}button.action.stop{border-color:#e8a09b;color:#b42318}button.action:disabled{cursor:not-allowed;opacity:.48}.notice{margin-top:9px;padding:8px 9px;border-radius:8px;background:#f4f7f7;color:#526669;white-space:pre-wrap}.error{background:#fff1f0;color:#b42318}.ok{background:#ecfdf3;color:#067647}.privacy{margin-top:8px;font-size:12px;color:#748487}
    </style>
    <section class="panel">
      <div class="header"><strong>BOSS 岗位助手</strong><button class="icon-button" id="refresh">识别</button><button class="icon-button" id="collapse">收起</button></div>
      <div class="body">
        <div class="run-box">
          <div class="run-title"><span>自动逐条投放（成功数上限）</span><span id="run-state">未开始</span></div>
          <div class="run-controls"><input id="run-limit" type="number" min="1" max="500" value="20" title="本轮最多成功投递数"><button class="action primary" id="start">开始</button><button class="action stop" id="stop" disabled>停止</button></div>
          <label for="hr-activity-filter" style="display:block;margin-top:9px;font-weight:600">本轮 HR 活跃筛选</label>
          <select id="hr-activity-filter" style="width:100%;box-sizing:border-box;border:1px solid #bfcfd1;border-radius:8px;padding:8px;background:#fff;color:#1f2d2f;font:inherit">
            <option value="online">当前在线</option><option value="today">当天活跃（含在线、刚刚活跃）</option><option value="within3days" selected>3 天内活跃（含当天）</option><option value="any">不限</option>
          </select>
          <div class="privacy">以 HR 姓名旁的活跃标签为准。未读到标签时，仅“不限”通过；不符合就记日志、跳过，不停止整轮。选择会自动保存，开始后锁定本轮。</div>
          <div class="privacy">自动批量暂缓猎头/外包（含科锐国际、中软、京北方等），留给手动投递。先本地筛选，再调用模型；模型只写招呼语。</div>
          <div class="progress" id="progress">成功 0/0 · 已识别 0 · 已跳过 0</div>
        </div>
        <div id="extension-version" class="muted"></div>
        <div class="privacy">批量预筛：名单内大中型科技/互联网公司及明确大中厂标注留给手动投递；命中时不调用模型，记录原因并继续下一条。</div>
        <div class="privacy">插件无需调试连接。请勿同时开启网页开发者工具或 ChatGPT 浏览器调试接管；页面重载后不会自动续投。</div>
        <details id="diagnostics"><summary>运行日志 / 具体未发送原因</summary><button class="action" id="read-logs">刷新日志</button> <button class="action" id="capture-page">采集页面状态（不发送）</button> <button class="action" id="export-logs">导出日志</button><div id="log-summary" class="notice">点击刷新查看，读取日志不会投递。</div><div id="log-entries" style="max-height:260px;overflow:auto;font-size:12px;white-space:pre-wrap"></div></details>
        <div id="summary"><span class="muted">正在读取当前岗位…</span></div>
        <div class="buttons"><button class="action primary" id="generate">单条模型生成</button><button class="action" id="copy" disabled>复制话术</button><button class="action primary" id="send" disabled>确认并发送</button><button class="action" id="mark-existing">登记已有沟通</button><button class="action" id="mark-replied">招聘者已回复</button></div>
        <div class="notice" id="notice">请先由你选择好求职列表，再设置本轮上限并点击“开始”。</div>
        <div class="privacy">原职位列表保持不动；每条成功后等待 1–3 秒，每 10 次额外等待 10–30 秒。列表标签页被隐藏时暂停识别，返回后继续。</div>
      </div>
    </section>`;

  const $ = (selector) => shadow.querySelector(selector);
  $('#extension-version').textContent = `本页插件版本：${chrome.runtime.getManifest().version}`;
  const panel = $(".panel");
  const summary = $("#summary");
  const notice = $("#notice");
  const startButton = $("#start");
  const stopButton = $("#stop");
  const runLimitInput = $("#run-limit");
  const hrActivitySelect = $('#hr-activity-filter');
  const generateButton = $("#generate");
  const copyButton = $("#copy");
  const sendButton = $("#send");

  function setNotice(text, type = "") {
    notice.textContent = text;
    notice.className = `notice ${type}`.trim();
  }

  async function logEvent(stage, result, reason, job = state.job, extra = {}) {
    await sendRuntimeMessage({type:'APPEND_DIAGNOSTIC',event:{runId:state.automation?.id || '',stage,result,reason,
      job:job ? {...job,jobKey:stableJobKey(job)} : {},...extra}});
  }

  async function readDiagnostics() {
    const response = await sendRuntimeMessage({type:'GET_DIAGNOSTICS'});
    if (!response?.ok) return setNotice(response?.error || '读取日志失败','error');
    state.diagnostics = response;
    const labels = {queued:'等待生成话术',delivering:'正在投递',sent:'已发送',read_error:'读取失败',delivery_error:'发送流程失败',send_state_unknown:'发送结果待核对',generation_error:'话术/模型问题',contact_hold:'沟通防重',filtered:'筛选不符',other_skip:'其他未发送'};
    $('#log-summary').textContent = response.current
      ? Object.entries(response.current.counts).map(([key,count])=>`${labels[key] || key} ${count}`).join(' · ')
      : '尚无运行记录';
    const rows = response.current?.rows || [];
    const rowLines = rows.map(row=>`${row.at || ''}｜${row.company} / ${row.title}\n${labels[row.category] || row.status}：${row.reason}`);
    const events = (response.events || []).filter(event=>event.runId === response.current?.id).slice(-100);
    const eventLines = events.map(formatDiagnosticEvent);
    $('#log-entries').textContent = [...rowLines,'—— 最近处理阶段 ——',...eventLines].join('\n\n');
  }

  async function capturePageDiagnostics() {
    const pageType = /^\/web\/geek\/jobs\/?$/u.test(location.pathname) ? 'list'
      : /^\/job_detail\//u.test(location.pathname) ? 'detail' : 'other';
    const trace = {code:'passive_page_snapshot',pageType,pageUrl:location.href,
      readyState:document.readyState,visibility:document.visibilityState,
      navigationType:performance.getEntriesByType('navigation')[0]?.type || 'unknown',
      sourcePlan:pageType === 'list' ? currentPlan()?.label || '' : '',
      cardCount:pageType === 'list' ? collectCards().length : 0};
    // 仅收集岗位身份/字段来源，不导出整页 HTML、聊天正文、简历或模型配置。
    const observed = pageType === 'other' ? {} : extractCurrentJob(null,trace);
    trace.descriptionLength = normalizeText(observed.description || '').length;
    await logEvent('页面状态快照','snapshot','用户主动采集：未点击岗位、未请求模型、未发送消息',observed,
      {expected:state.job || {},observed,details:trace});
    await readDiagnostics();
  }

  function formatDiagnosticEvent(event) {
    const d=event.details || {};
    const lines=[`${event.at}｜${event.stage}｜${event.company} / ${event.title}`,event.reason];
    if (event.extensionVersion) lines.push(`插件 ${event.extensionVersion}｜标签 ${event.tabId ?? '后台'}｜${d.code || event.result}`);
    if (d.hrActivityFilter) lines.push(`HR筛选=${HR_ACTIVITY_FILTERS[d.hrActivityFilter] || d.hrActivityFilter}；页面标签=${d.hrActivityLabel || '未识别/未显示'}`);
    if ('modelCalled' in d) lines.push(`模型接口=${d.modelCalled ? '已请求（仅生成话术）' : '未调用'}${d.modelAttempt ? `；第${d.modelAttempt}次请求` : ''}`);
    if (d.continuation) lines.push(`后续处理=${d.continuation === 'next_job' ? '跳过本条，继续下一条' : d.continuation}；岗位ID=${event.jobKey || '未读取'}；任务=${d.deliveryId || '尚未创建投递任务'}`);
    if (d.textState) lines.push(`文字状态=${({not_started:'尚未发送',unknown:'结果未知，不自动重发',confirmed_sent:'已确认发送'})[d.textState] || d.textState}；失败阶段=${d.deliveryStage || '未知'}`);
    if (event.expected) {
      lines.push(`目标：${event.expected.company || '未提供'} / ${event.expected.title || '未提供'} / ${event.expected.jobKey || '未提供'} / 招聘者=${event.expected.recruiterName || '未提供'}`);
      lines.push(`读到：${event.observed?.detailCompany || event.observed?.company || '未读到'} / ${event.observed?.title || '未读到'} / ${event.observed?.jobKey || '未读到'} / 招聘者=${event.observed?.recruiterName || '未读到'}`);
    }
    const status={match:'通过',mismatch:'值不同',missing_expected:'任务字段缺失',missing_observed:'页面字段未匹配',not_checked:'本阶段不校验'};
    for (const item of d.checks || []) lines.push(`${item.label}：${status[item.status] || item.status}；预期=${item.expected || '未提供'}；实际=${item.observed || '未读到'}`);
    if (d.pageType) lines.push(`页面=${d.pageType}；加载=${d.readyState || '?'}；可见性=${d.visibility || '?'}；等待=${d.elapsedMs ?? '-'}ms；读取=${d.attempts ?? '-'}次`);
    if (d.pageUrl || event.senderUrl) lines.push(`地址：${d.pageUrl || event.senderUrl}`);
    if (d.pageEvent) lines.push(`页面事件=${d.pageEvent}；自动恢复=${d.automaticRecovery ? '开启' : '关闭'}`);
    if (d.sourcePlan || d.navigationType) lines.push(`求职方向=${d.sourcePlan || '未读取'}；加载类型=${d.navigationType || '未知'}；卡片数=${d.cardCount ?? '-'}`);
    if ('rootFound' in d) lines.push(`详情容器=${d.rootFound ? '找到' : '未找到'}；来源=${d.rootSource || '?'}；节点=${d.rootTag || '?'} .${d.rootClass || ''}；正文长度=${d.descriptionLength ?? 0}`);
    if (d.titleSource || d.recruiterSource) lines.push(`标题读取规则=${d.titleSource || '?'}；招聘者读取规则=${d.recruiterSource || '?'}；招聘者容器=${d.recruiterContainerFound ? '找到' : '未找到'}`);
    if ('communicationButtonFound' in d) lines.push(`沟通按钮=${d.communicationButtonFound ? '找到' : '未找到'}`);
    if ('buttonDisabled' in d) lines.push(`按钮=${d.buttonTag || '?'}；链接类型=${d.buttonHrefKind || '?'}；禁用=${d.buttonDisabled ? '是' : '否'}；可见弹窗=${d.dialogPresent ? '有' : '无'}；聊天子标签=${d.chatTabBound ? '已绑定' : '未绑定'}；输入框=${d.inputFound ? '找到' : '未找到'}`);
    if (d.conversationScope) lines.push(`会话定位=${d.conversationScope}；输入框=${d.inputFound ? '找到' : '未找到'}；查看职位入口=${d.viewJobLinkCount ?? 0}个；抬头元素=${d.headerElementCount ?? 0}个`);
    if (d.headerSource) lines.push(`抬头读取=${d.headerSource}；容器层级=${d.scopeDepth ?? '?'}；公司读取=${d.recruiterCompanySource || '?'}；等待前身份结果=${d.identityCode || d.code || '?'}`);
    if (d.scopeStopReason) lines.push(`向上查找结束原因=${d.scopeStopReason}；最终尝试层=${d.lastScopeDepth ?? '?'}；采用层=${d.selectedScopeDepth ?? '?'}`);
    for (const scope of d.scopeAttempts || []) {
      lines.push(`结构第${scope.depth ?? '?'}层：${scope.rootTag || '?'} .${scope.rootClass || ''}；${scope.outcome || scope.reason || ''}；职位入口=${scope.viewJobLinkCount ?? 0}`);
      if (scope.cardTag) lines.push(`  岗位卡：${scope.cardTag} .${scope.cardClass || ''}`);
      for (const header of scope.headerAttempts || []) lines.push(`  抬头候选：${header.tag} .${header.className || ''}；${header.source}；${header.reason}`);
      for (const field of scope.fieldAttempts || []) lines.push(`  ${field.field}：${field.source}；命中${field.matchedCount ?? 0}，可用${field.acceptedCount ?? 0}`);
    }
    if (d.observedMeaning) lines.push(d.observedMeaning);
    if ('descriptionEqual' in d) lines.push(`正文比较：${d.descriptionEqual ? '相同' : '不同'}${'expectedDescriptionLength' in d ? `；预期长度=${d.expectedDescriptionLength}；读到长度=${d.descriptionLength}` : '（与切换前正文比较）'}`);
    if (d.errorName) lines.push(`异常=${d.errorName}；代码位置=${d.errorSite || '未提供'}；发送阶段=${d.deliveryStage || '未知'}`);
    if (event.recruitmentMode && event.recruitmentMode!=='direct') lines.push(`公司角色：列表=${event.listingCompany || '?'}；招聘者所属=${event.recruiterCompany || '?'}；明确甲方=${event.employerCompany || '未明确'}；右侧来源=${event.detailCompanySource || '?'}`);
    return lines.join('\n');
  }

  async function waitSourceVisible() {
    if (state.stopRequested) throw new Error('本轮已停止');
    if (document.visibilityState !== 'hidden') return;
    await logEvent('页面可见性','paused','主列表标签页已隐藏，暂停点击和读取；返回后继续');
    while (document.visibilityState === 'hidden' && !state.stopRequested) {
      setNotice('主列表标签页已隐藏，已暂停。请返回当前BOSS岗位列表，之后会继续。');
      await sleep(250);
    }
    if (state.stopRequested) throw new Error('用户已停止');
    await logEvent('页面可见性','resumed','主列表已恢复可见，继续核对当前岗位');
  }

  async function sendRuntimeMessage(message) {
    const invalidText = "扩展刚刚被重新加载，请刷新当前 BOSS 页面后再开始";
    if (!chrome.runtime?.id) {
      state.stopRequested = true;
      setNotice(invalidText, "error");
      return { ok: false, error: invalidText, contextInvalidated: true };
    }
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      if (/Extension context invalidated|Receiving end does not exist/iu.test(String(error?.message || error))) {
        state.stopRequested = true;
        setNotice(invalidText, "error");
        return { ok: false, error: invalidText, contextInvalidated: true };
      }
      throw error;
    }
  }

  window.addEventListener("unhandledrejection", (event) => {
    if (/Extension context invalidated/iu.test(String(event.reason?.message || event.reason || ""))) {
      event.preventDefault();
      state.stopRequested = true;
      setNotice("扩展刚刚被重新加载，请刷新当前 BOSS 页面后再开始", "error");
    }
  });

  function isVisible(element) {
    if (!element || host.contains(element)) return false;
    if (element.closest?.("[data-bja-contact-marker='1'],[data-bja-result-marker='1']")) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) !== 0 && rect.width > 0 && rect.height > 0;
  }

  function visible(selector, root = document) {
    return [...root.querySelectorAll(selector)].filter(isVisible);
  }

  function safeElementClick(element) {
    if (state.pageDeparted) throw new Error('原页面已离开，取消迟到的点击操作');
    const href = String(element?.getAttribute?.("href") || "").trim();
    if (/^javascript:/iu.test(href)) {
      element.addEventListener("click", (event) => event.preventDefault(), { capture: true, once: true });
    }
    element.click();
  }

  function ownText(element) {
    if (!element) return "";
    return normalizeText([...element.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
      .join(" "));
  }

  function planKey(value = "") {
    return normalizeText(value)
      .replace(/[（]/gu, "(")
      .replace(/[）]/gu, ")")
      .replace(/\s+/gu, "")
      .toLowerCase();
  }

  function isBossAccent(color = "") {
    const channels = String(color).match(/\d+(?:\.\d+)?/gu)?.slice(0, 3).map(Number) || [];
    if (channels.length < 3) return false;
    const [red, green, blue] = channels;
    return green >= 120 && blue >= 100 && red + 45 < Math.min(green, blue);
  }

  function planTabs() {
    const tabCandidates = [];
    for (const element of visible("[role='tab'],a,button,li,span,div[class*='expect'],div[class*='tab'],div[class*='nav'],div[class*='position']")) {
      const rect = element.getBoundingClientRect();
      if (rect.top < 45 || rect.bottom > 220 || rect.left > Math.max(1100, innerWidth * 0.7)) continue;
      const label = normalizeText(element.textContent);
      if (!label || label.length > 50 || !(/^(?:推荐)$/u.test(label) || /测试|测开|质量|qa/iu.test(label))) continue;
      const key = planKey(label);
      const classText = String(element.className || "");
      const style = getComputedStyle(element);
      const afterStyle = getComputedStyle(element, "::after");
      let activeScore = 0;
      if (element.getAttribute("aria-selected") === "true" || element.getAttribute("aria-current") === "page") activeScore += 100;
      if (/(?:^|[-_\s])(active|selected|current|checked|cur|on)(?:$|[-_\s])/iu.test(classText)) activeScore += 60;
      if (isBossAccent(style.color)) activeScore += 25;
      if (isBossAccent(style.borderBottomColor) && style.borderBottomWidth !== "0px") activeScore += 20;
      if (isBossAccent(afterStyle.backgroundColor) || isBossAccent(afterStyle.borderBottomColor)) activeScore += 15;
      tabCandidates.push({ element, label, key, activeScore, area: rect.width * rect.height });
    }
    const unique = new Map();
    for (const item of tabCandidates.sort((a, b) => b.activeScore - a.activeScore || a.area - b.area)) {
      if (!unique.has(item.key)) unique.set(item.key, item);
    }
    return [...unique.values()];
  }

  function currentPlan() {
    const tabs = planTabs().sort((a, b) => b.activeScore - a.activeScore || a.area - b.area);
    if (!tabs.length || tabs[0].activeScore <= 0) return null;
    return { label: tabs[0].label, key: tabs[0].key };
  }

  async function waitForListReady(timeout = 12000, fingerprintBeforeSwitch = "") {
    const deadline = Date.now() + timeout;
    let previousFingerprint = "";
    let stableChecks = 0;
    while (Date.now() < deadline) {
      const cards = collectCards();
      const fingerprint = cards.map((card) => card.jobKey).join("|");
      const switched = !fingerprintBeforeSwitch || fingerprint !== fingerprintBeforeSwitch;
      if (cards.length && findDetailRoot() && switched) {
        stableChecks = fingerprint && fingerprint === previousFingerprint ? stableChecks + 1 : 0;
        if (stableChecks >= 2) return cards;
      }
      previousFingerprint = fingerprint;
      await sleep(350);
    }
    throw new Error("求职方向已切换，但左侧岗位列表没有稳定加载");
  }

  function firstText(selectors, root = document, trace = null, traceKey = '') {
    for (const selector of selectors) {
      const element = [...root.querySelectorAll(selector)].find(isVisible);
      const text = element ? renderedText(element) : "";
      if (text) {
        if (trace && traceKey) trace[traceKey]=selector;
        return text;
      }
    }
    return "";
  }

  function renderedText(element) {
    return element ? visibleText(element) : "";
  }

  function exactText(pattern, root = document) {
    return [...root.querySelectorAll("h1,h2,h3,h4,h5,button,a,span,div,p")]
      .filter(isVisible)
      .filter(element => pattern.test(normalizeText(element.innerText || "")))
      .filter((element) => pattern.test(renderedText(element)))
      .sort((a, b) => renderedText(a).length - renderedText(b).length)[0] || null;
  }

  function findDetailRoot(trace = null) {
    if (trace) trace.rootSource='not_found';
    const heading = exactText(/^职位描述$/u);
    if (heading) {
      let current = heading.parentElement;
      while (current && current !== document.body) {
        const text = renderedText(current);
        if (current.querySelectorAll("a[href*='/job_detail/']").length > 1) break;
        const hasCommunicationButton = visible('button,a',current).some(element=>/^(?:立即沟通|继续沟通|沟通)$/u.test(renderedText(element)));
        if (hasCommunicationButton && text.length > 100 && text.length < 30000) {
          if (trace) trace.rootSource='职位描述与沟通按钮的共同祖先';
          return current;
        }
        current = current.parentElement;
      }
    }
    for (const selector of [".job-detail-box", ".job-detail-container", ".job-detail-content", ".job-detail-wrapper", ".job-detail-section", ".job-detail"]) {
      const root = visible(selector).filter((element) => /职位描述/u.test(renderedText(element)))
        .sort((a, b) => renderedText(a).length - renderedText(b).length)[0];
      if (root) {
        if (trace) trace.rootSource=selector;
        return root;
      }
    }
    return null;
  }

  function detailTitle(root = findDetailRoot(), trace = null) {
    if (!root) return "";
    if (/^\/job_detail\/[^/]+\.html$/u.test(location.pathname)) {
      // 独立详情的岗位标题在顶部横幅，正文容器外。绝不向上抓任意name，工商信息也有name。
      const selectors=['.job-primary .name h1','.job-banner .name h1','.job-detail-info .name h1'];
      const headings=[...new Set(selectors.flatMap(selector=>visible(selector,document)))];
      const candidates=headings.length ? headings : visible('h1',document);
      const titles=[...new Set(candidates.map(renderedText).filter(text=>text && text.length<=160
        && !/^(?:公司名称|工商信息|公司介绍|法定代表人|注册资金|BOSS安全提示)/u.test(text)))];
      if (titles.length===1) {
        if (trace) trace.titleSource=headings.length ? '独立详情顶部岗位h1' : '独立详情唯一可见h1';
        return titles[0];
      }
      if (trace) trace.titleSource=titles.length ? '独立详情多个不同h1，未猜测标题' : '独立详情岗位h1尚未读到';
      return '';
    }
    const selected = firstText([".job-detail-info .name h1", ".job-detail-info .name", ".job-detail-header .name", ".job-primary .name", ".job-detail-box h1", ".job-name", "[class*='job-name']"], root, trace, 'titleSource');
    if (selected) return selected;
    const heading = exactText(/^职位描述$/u, root);
    let current = heading?.parentElement;
    for (let depth = 0; depth < 5 && current; depth += 1, current = current.parentElement) {
      const candidate = visible("h1,h2,[class*='name']", current)
        .map(renderedText)
        .find((text) => text && text !== "职位描述" && !/在线|活跃/u.test(text) && text.length <= 80);
      if (candidate) {
        if (trace) trace.titleSource=`职位描述祖先${depth}层的h1/h2/name回退`;
        return candidate;
      }
    }
    return "";
  }

  function cardRoot(link) {
    const direct = link.closest(".job-card-wrapper,.job-card-box,.job-list-box li,.job-list li,li");
    if (direct && direct.querySelectorAll("a[href*='/job_detail/']").length === 1) return direct;
    let current = link.parentElement;
    for (let depth = 0; depth < 7 && current && current !== document.body; depth += 1, current = current.parentElement) {
      const text = normalizeText(current.textContent);
      if (current.querySelectorAll("a[href*='/job_detail/']").length === 1 && text.length <= 1200 && /上海/u.test(text)) return current;
    }
    return null;
  }

  function cardIsSelected(link, root) {
    for (let element = link; element; element = element.parentElement) {
      if (element.getAttribute("aria-selected") === "true" || element.getAttribute("aria-current") === "true"
        || /(?:^|[-_\s])(?:active|selected|current|checked)(?:$|[-_\s])/iu.test(String(element.className))) return true;
      const style = getComputedStyle(element);
      const rgb = style.borderTopColor.match(/[\d.]+/gu)?.map(Number) || [];
      if (parseFloat(style.borderTopWidth) >= 1 && style.borderTopStyle !== "none"
        && rgb[0] < 70 && rgb[1] > 130 && rgb[2] > 120) return true;
      if (element === root) break;
    }
    return false;
  }

  function rawCards() {
    const found = [];
    const keys = new Set();
    for (const link of visible("a[href*='/job_detail/']")) {
      const root = cardRoot(link);
      if (!root) continue;
      const href = new URL(link.getAttribute("href"), window.location.href).href;
      const jobKey = stableJobKey({ url: href });
      if (keys.has(jobKey)) continue;
      keys.add(jobKey);
      const texts = visible("a,span,div,li", root).map(ownText).filter(Boolean);
      const location = texts.filter((text) => /^上海(?:市)?(?:$|·)/u.test(text) && text.length <= 50)
        .sort((a, b) => a.length - b.length)[0]
        || renderedText(root).match(/上海(?:市)?(?:·[^\s，,｜|]{1,40})?/u)?.[0]
        || "";
      const companyLink = visible("a", root).find((element) => element !== link && !String(element.getAttribute("href") || "").includes("/job_detail/"));
      found.push({
        link,
        root,
        href,
        jobKey,
        title: renderedText(link),
        company: companyLink ? renderedText(companyLink) : "",
        agencyHint: /猎头|代招/u.test(renderedText(root).replace(/(?:非|不是|拒绝)\s*(?:猎头|代招)/gu,'')),
        selected: cardIsSelected(link, root),
        location: location.replace(/^上海市/u, "上海"),
        tags: visible("li,[class*='tag']", root).map((element) => normalizeText(element.textContent)).filter((text) => text && text.length <= 30).slice(0, 20)
      });
    }
    return found;
  }

  function findActiveJobLink() {
    const cards = rawCards();
    const active = resolveCard(cards, detailTitle(), extractDetailCompany(findDetailRoot()));
    if (active) return active.link;
    // Explicit user/runner clicks identify the left card, never the first matching title.
    return cards.find(card => card.jobKey === state.clickedJobKey)?.link || null;
  }

  function collectCards() {
    const found = rawCards();
    const active = findActiveJobLink();
    const activeIndex = found.findIndex((item) => item.link === active);
    return activeIndex > 0 ? [...found.slice(activeIndex), ...found.slice(0, activeIndex)] : found;
  }

  function applyContactMarkers() {
    if (state.pageDeparted) return;
    const results=new Map((state.automation?.results || []).map(row=>[row.jobKey,row]));
    for (const card of rawCards()) {
      const jobMarker = state.contactMarkers.jobs?.[card.jobKey];
      const companyKey = normalizeCompanyKey(card.company);
      const companyMarker = companyKey && !card.agencyHint ? state.contactMarkers.companies?.[companyKey] : null;
      const text = jobMarker
        ? `助手：本岗位已沟通 ${jobMarker.attempts} 次`
        : companyMarker
          ? "助手：历史同名公司记录（非本岗位，需核对）"
          : "";
      let marker = card.root.querySelector(":scope > [data-bja-contact-marker='1']");
      if (!text) {
        marker?.remove();
      } else if (!marker) {
        marker = document.createElement("span");
        marker.dataset.bjaContactMarker = "1";
        marker.style.cssText = "display:inline-block;margin:6px 8px 6px 0;padding:2px 7px;border-radius:999px;background:#e8f8f7;color:#087f7e;font:12px/1.5 -apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;";
        card.root.appendChild(marker);
      }
      if (text && marker.textContent !== text) marker.textContent = text;

      const badge=jobOutcomeBadge(results.get(card.jobKey));
      // 成功次数已有原标记时不重复占一行；图片失败仍必须单独展示。
      const show=badge && !(badge.tone==='success' && jobMarker);
      let outcome=card.root.querySelector(":scope > [data-bja-result-marker='1']");
      if (!show) {outcome?.remove();continue;}
      if (!outcome) {
        outcome=document.createElement('span');
        outcome.dataset.bjaResultMarker='1';
        outcome.style.cssText="display:block;max-width:calc(100% - 16px);box-sizing:border-box;margin:5px 8px 7px 0;padding:4px 7px;border-radius:6px;white-space:normal;overflow-wrap:anywhere;font:12px/1.5 -apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;";
        card.root.appendChild(outcome);
      }
      const colors={warning:['#fff4df','#8a4b08'],error:['#fff0ee','#b42318'],success:['#e8f8f7','#087f7e']};
      if (outcome.dataset.tone!==badge.tone) {
        outcome.dataset.tone=badge.tone;
        [outcome.style.backgroundColor,outcome.style.color]=colors[badge.tone];
      }
      if (outcome.textContent!==badge.text) outcome.textContent=badge.text;
      if (outcome.title!==badge.title) {outcome.title=badge.title;outcome.setAttribute('aria-label',badge.title);}
    }
  }

  function extractDescription(root) {
    if (!root) return "";
    const direct = firstText([".job-sec-text", ".job-detail-section .text", ".job-description", ".job-detail-content .text", "[class*='job-sec-text']", "[class*='job-description']"], root);
    if (direct.length > 20) return direct;
    const heading = exactText(/^职位描述$/u, root);
    if (!heading) return "";
    let section = heading.parentElement;
    for (let depth = 0; depth < 4 && section; depth += 1, section = section.parentElement) {
      const text = visibleText(section, undefined, element=>element.matches('button,.boss-info,.job-boss-info,.recruiter-info,[class*="boss-info"],.job-address,.work-address'))
        .replace(/^职位描述/u, "");
      if (text.length > 20 && text.length < 15000) return text;
    }
    return "";
  }

  function extractLocation(root, activeLink, hint) {
    let scope = root;
    for (let depth = 0; depth < 5 && scope; depth += 1, scope = scope.parentElement) {
      const value = visible("a[href*='/c101020100']", scope).map((element) => normalizeText(element.textContent))
        .find((text) => /^上海(?:市)?(?:$|·)/u.test(text));
      if (value) return value.replace(/^上海市/u, "上海");
    }
    const activeCard = collectCards().find((item) => item.link === activeLink);
    if (activeCard?.location) return activeCard.location;
    return hint?.location || "";
  }

  function extractDetailCompany(root) {
    return extractCompanyContext(root).detailCompany;
  }

  function extractCompanyContext(root) {
    const empty = {detailCompany:'',detailCompanySource:'',recruiterCompany:'',employerCompany:'',agencyText:''};
    if (!root || root.querySelectorAll("a[href*='/job_detail/']").length > 1) return empty;
    const recruiter = visible(".boss-info,.job-boss-info,.recruiter-info,[class*='boss-info']", root)[0];
    const companyLine = recruiter && visible('div,p,span', recruiter).map(renderedText)
      .filter(text=>/[·｜|]/u.test(text) && text.length<160 && !/去App|随时沟通|在线|活跃/u.test(text)).sort((a,b)=>a.length-b.length)[0];
    const recruiterCompany = companyLine?.split(/[·｜|]/u)[0].trim() || '';
    const selectors = ".job-detail-company .name,.company-info .name,.company-name,[class*='company-info'] a";
    const direct = visible(selectors,root).find(element=>!recruiter?.contains(element));
    // 仅接受页面明确的字段标签，不从JD中的客户行业或公司顺序猜甲方。
    const employerLabels = visible('div,p,span',root).filter(element=>element.children.length===0).map(renderedText)
      .map(text=>text.match(/^(?:甲方公司|用人企业|实际用人单位|驻场公司|服务客户)[：:]\s*([^，。；\n]{2,80})$/u)?.[1]).filter(Boolean);
    return {detailCompany:direct ? renderedText(direct) : recruiterCompany,
      detailCompanySource:direct ? 'company_section' : recruiterCompany ? 'recruiter_profile' : '',
      recruiterCompany,employerCompany:employerLabels.length===1 ? employerLabels[0] : '',
      agencyText:companyLine || ''};
  }

  function extractCompany(root, activeLink, hint) {
    // The selected card is the company source. Independent detail company is checked separately.
    const card = activeLink ? cardRoot(activeLink) : null;
    const company = card && visible("a", card).find((element) => element !== activeLink && !String(element.getAttribute("href") || "").includes("/job_detail/"));
    return (company ? renderedText(company) : "") || hint?.company || extractDetailCompany(root);
  }

  function extractRecruiter(root, trace = null) {
    const container = visible(".boss-info,.job-boss-info,.recruiter-info,[class*='boss-info']")
      .find((element) => !root || root.contains(element) || element.contains(root));
    if (trace) {
      trace.recruiterContainerFound=Boolean(container);
      trace.recruiterContainerTag=container?.tagName || '';
      trace.recruiterContainerClass=String(container?.className || '');
    }
    let name = firstText([".boss-name", ".job-boss-info .name", ".recruiter-name", "[class*='boss-name']"], container || root || document, trace, 'recruiterSource');
    // 不再把整个HR介绍（公司/职位/去App文案）作为活跃状态，避免“在线教育”等误命中。
    const activityLabels = container ? visible('span,em,i,b,div',container)
      .filter(element=>!element.closest?.("a[href*='/gongsi/'],.company-name,.recruiter-company,.boss-company"))
      .map(element=>hrActivityLabel(renderedText(element))).filter(Boolean) : [];
    const nameAndActivity = new RegExp(`^([\\u3400-\\u9fff·]{1,8}?)\\s*(${HR_ACTIVITY_LABEL_PATTERN})$`,'u');
    const inlineName = normalizeText(name).match(nameAndActivity);
    if (inlineName) {name=inlineName[1];activityLabels.push(inlineName[2]);}
    if (!name) {
      const candidate = visible("h1,h2,h3,h4,div,span", root || document)
        .map((element) => normalizeText(renderedText(element)).match(nameAndActivity))
        .filter(Boolean).sort((a,b)=>a[0].length-b[0].length)[0];
      if (candidate) {
        if (trace) trace.recruiterSource='姓名加在线/活跃文字回退';
        name = candidate[1];
        activityLabels.push(candidate[2]);
      }
    }
    name = normalizeText(name);
    const uniqueLabels = [...new Set(activityLabels)];
    const activityText = uniqueLabels.length===1 ? uniqueLabels[0] : '';
    if (trace) {trace.hrActivityLabel=activityText;trace.hrActivitySource=activityText ? 'recruiter_badge' : uniqueLabels.length>1 ? 'conflicting_badges' : 'badge_not_found';}
    return { name, activityText };
  }

  function communicationButton(root = findDetailRoot()) {
    for (const scope of [root, root?.parentElement, document].filter(Boolean)) {
      const button = visible("button,a", scope)
        .filter((element) => /^(?:立即沟通|继续沟通|沟通)$/u.test(normalizeText(element.textContent)))[0];
      if (button) return button;
    }
    return null;
  }

  function extractCurrentJob(hint = null, trace = null) {
    const root = findDetailRoot(trace);
    if (trace) Object.assign(trace,{rootFound:Boolean(root),rootTag:root?.tagName || '',rootClass:String(root?.className || ''),titleSource:'not_found',recruiterSource:'not_found'});
    if (!root) return { title: "", company: "", description: "", location: "", recruiterName: "", recruiterSalutation: "您好", activityText: "", replyText: "", tags: [], buttonText: "", url: window.location.href };
    const standalone=/^\/job_detail\/[^/]+\.html$/u.test(location.pathname);
    const activeLink = standalone ? null : hint?.link || findActiveJobLink() || null;
    const recruiter = extractRecruiter(root, trace);
    const button = communicationButton(root);
    const tags = [...new Set(visible(".job-tags li,.job-tags span,.tag-list li,[class*='job-tag'] li", root).map((element) => normalizeText(element.textContent)).filter(Boolean))].slice(0, 20);
    const pageText = renderedText(root);
    const context = extractCompanyContext(root);
    const listingCompany = extractCompany(root, activeLink, hint);
    const roles = resolveCompanyRoles({...context,listingCompany,agencyText:`${context.agencyText} ${hint?.agencyHint ? '猎头' : ''}`});
    const title=detailTitle(root,trace) || (!standalone && (normalizeText(activeLink?.textContent) || hint?.title)) || '';
    if (trace && title && trace.titleSource==='not_found') trace.titleSource=activeLink ? '列表链接文字回退' : '传入卡片标题回退';
    return {
      ...roles,
      listingTitle: hint?.title || (activeLink ? renderedText(activeLink) : ''),
      title,
      company: listingCompany,
      detailCompany: extractDetailCompany(root),
      description: extractDescription(root),
      location: extractLocation(root, activeLink, hint),
      recruiterName: recruiter.name,
      recruiterSalutation: recruiterSalutation(recruiter.name),
      activityText: recruiter.activityText,
      agencyHint: Boolean(hint?.agencyHint),
      replyText: pageText.match(/(?:今日|今天)回复(?:过求职者|过候选人|活跃)?[^\s，。；]{0,12}/u)?.[0] || "",
      tags: tags.length ? tags : (hint?.tags || []),
      buttonText: normalizeText(button?.textContent),
      url: standalone ? window.location.href : activeLink ? new URL(activeLink.getAttribute("href"), window.location.href).href : (hint?.href || window.location.href),
      identityReady: !/\/web\/geek\/jobs/u.test(location.pathname) || Boolean(activeLink)
    };
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" })[char]);
  }

  function label(decision) {
    return ({ recommend: "推荐", review: "待核对", postpone: "当前暂缓", exclude: "不符合" })[decision] || "待判断";
  }

  function renderAutomation() {
    const run = state.automation;
    const running = run?.status === "running";
    $("#run-state").textContent = run?.statusLabel || "未开始";
    $("#progress").textContent = run
      ? `成功 ${run.successCount || 0}/${run.runLimit || 0} · 已识别 ${run.scannedCount || 0} · 条件/防重跳过 ${run.skippedCount || 0}\n异常跳过：读取 ${run.readErrorCount || 0} · 话术 ${run.generationErrorCount || 0} · 投递 ${run.deliveryErrorCount || 0} · 结果待核对 ${run.unknownSendCount || 0}${run.sourcePlan?.label ? `\n锁定方向：${run.sourcePlan.label}` : ""}${run.reason ? `\n${run.reason}` : ""}`
      : "成功 0/0 · 已识别 0 · 已跳过 0";
    startButton.disabled = running || state.engineBusy;
    stopButton.disabled = !running;
    runLimitInput.disabled = running;
    hrActivitySelect.disabled = running || state.engineBusy;
    if (run?.hrActivityFilterLabel) $('#progress').textContent += `\n本轮 HR 活跃要求：${run.hrActivityFilterLabel}`;
  }

  function renderJob() {
    if (!state.job?.title || !state.analysis) {
      summary.innerHTML = `<span class="status review">未识别</span><div class="notice error">请停留在“左侧岗位列表＋右侧完整职位描述”页面。</div>`;
      generateButton.disabled = true;
      copyButton.disabled = true;
      sendButton.disabled = true;
      $('#mark-existing').disabled = true;
      $('#mark-replied').disabled = true;
      return;
    }
    const result = state.modelResult || state.analysis;
    const greeting = state.modelResult?.greeting || "";
    const reasons = result.reason ? [result.reason] : (state.analysis.reasons || []);
    summary.innerHTML = `<span class="status ${escapeHtml(result.decision)}">${label(result.decision)}</span><div class="job"><div class="job-title">${escapeHtml(state.job.title)}</div><div class="meta">${escapeHtml(state.job.company || "公司未识别")} · ${escapeHtml(state.job.location || "地点未识别")}</div><div class="meta">${escapeHtml(state.job.recruiterSalutation)} · ${escapeHtml(state.job.activityText || "活跃状态未识别")} · 第 ${state.round} 次沟通</div></div><ul class="reasons">${reasons.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul><textarea class="greeting" id="greeting" placeholder="自动模式会直接生成；也可点击单条模型生成">${escapeHtml(greeting)}</textarea>`;
    const contactLine = document.createElement('div');
    contactLine.className = 'notice';
    const previous = state.automation?.results?.find(row=>row.jobKey === stableJobKey(state.job));
    const statusName = {sent:'已发送',skipped:'条件/防重跳过',read_error:'读取失败，已跳过',delivery_error:'投递失败，已跳过',send_state_unknown:'发送待核对，已跳过',generation_error:'话术问题，已跳过',queued:'等待生成',delivering:'发送中'};
    contactLine.textContent = `发送资格：${state.contact?.reason || '正在核对'}${previous ? `\n本轮记录：${statusName[previous.status] || previous.status} · ${previous.reason}` : ''}`;
    summary.prepend(contactLine);
    if (['agency','multi_entity'].includes(state.job.recruitmentMode)) {
      const roles=document.createElement('div');
      roles.className='notice';
      roles.textContent=`公司角色分别记录：\n列表：${state.job.listingCompany || '未识别'}\n招聘者所属：${state.job.recruiterCompany || '未识别'}\n明确甲方/用人企业：${state.job.employerCompanyConfirmed ? state.job.employerCompany : '页面未明确，不猜测'}\n右侧公司来源：${state.job.detailCompanySource==='recruiter_profile' ? '招聘者介绍' : '公司信息区域'}`;
      summary.prepend(roles);
    }
    generateButton.disabled = state.busy || ["postpone", "exclude"].includes(state.analysis.decision);
    copyButton.disabled = !greeting;
    sendButton.disabled = !greeting || state.modelResult?.decision !== "recommend" || !state.settings?.enableDirectSend;
    if (!state.job.identityReady) { generateButton.disabled = true; sendButton.disabled = true; }
    $('#mark-existing').disabled = !state.job.identityReady || state.engineBusy;
    $('#mark-replied').disabled = !state.job.identityReady || state.engineBusy;
  }

  function render() {
    renderAutomation();
    renderJob();
    applyContactMarkers();
  }

  async function loadState() {
    const [settings, automation, markers] = await Promise.all([
      sendRuntimeMessage({ type: "GET_SETTINGS" }),
      sendRuntimeMessage({ type: "GET_AUTOMATION" }),
      sendRuntimeMessage({ type: "GET_CONTACT_MARKERS" })
    ]);
    if (settings?.ok) {
      state.settings = settings.settings;
      if (!runLimitInput.dataset.ready) {
        runLimitInput.value = String(settings.settings.defaultRunLimit || 20);
        runLimitInput.dataset.ready = "1";
      }
      if (!hrActivitySelect.dataset.ready) {
        hrActivitySelect.value=normalizeHrActivityFilter(settings.settings.defaultHrActivityFilter);
        hrActivitySelect.dataset.ready='1';
      }
    }
    if (automation?.ok) {
      state.automation = automation.publicSession;
      if (automation.publicSession?.status === "running") runLimitInput.value = String(automation.publicSession.runLimit || runLimitInput.value);
      if (automation.publicSession?.status === 'running') hrActivitySelect.value=normalizeHrActivityFilter(automation.publicSession.hrActivityFilter);
    }
    if (markers?.ok) {
      state.contactMarkers = { jobs: markers.jobs || {}, companies: markers.companies || {} };
      applyContactMarkers();
    }
  }

  async function refreshJob(force = false, hint = null) {
    const refreshSequence = ++state.refreshSequence;
    const job = extractCurrentJob(hint);
    const fingerprint = normalizeText(`${job.url}|${job.company}|${detailFingerprint(job)}`);
    if (!force && fingerprint && fingerprint === state.lastFingerprint) {
      applyContactMarkers();
      return job;
    }
    const expected = rawCards().find(card=>card.jobKey === stableJobKey(job));
    if (/\/web\/geek\/jobs/u.test(location.pathname)) {
      const before = state.selectionBefore || (state.job ? {...state.job,jobKey:stableJobKey(state.job)} : null);
      job.identityReady = Boolean(expected && job.identityReady && detailReady(expected,job,before,state.identityProof));
      if (job.identityReady) { state.selectionBefore = null; state.lastVerifiedJob = {...job,jobKey:stableJobKey(job)}; }
    }
    state.lastFingerprint = job.identityReady ? fingerprint : '';
    state.job = job;
    state.analysis = analyzeJob(job);
    state.modelResult = null;
    await loadState();
    if (refreshSequence !== state.refreshSequence) return job;
    const contact = job.title && job.identityReady ? await sendRuntimeMessage({ type: "CHECK_CONTACT", job }) : {allowed:false,reason:'岗位身份或详情尚未对应，等待页面更新，未执行去重或登记'};
    if (refreshSequence !== state.refreshSequence) return job;
    state.contact = contact;
    state.round = contact?.eligibility?.round || 1;
    render();
    if (!job.title) setNotice("未读到右侧岗位详情。请确认页面没有弹窗遮挡。", "error");
    else if (!contact?.allowed) setNotice(contact?.reason || "当前不能沟通");
    else setNotice("已读取当前岗位；自动模式会从左侧当前条目开始向下处理。", "ok");
    return job;
  }

  async function generateGreeting(automatic = false) {
    if (!state.job?.title || state.busy) return null;
    state.busy = true;
    generateButton.textContent = "生成中…";
    render();
    setNotice(`正在为“${state.job.title}”生成招呼语…`);
    try {
      const expectedJob = state.job;
      const expectedRunId=automatic ? state.automation?.id : undefined;
      const response = await sendRuntimeMessage({ type: "GENERATE_GREETING", job: expectedJob,automatic,
        automationRunId:expectedRunId,sourceDocumentToken });
      if(automatic && (state.stopRequested || state.pageDeparted || state.automation?.id!==expectedRunId)) throw new Error('[model_cancelled] 本轮已停止或变更，丢弃迟到话术');
      if (stableJobKey(state.job) !== stableJobKey(expectedJob)) throw new Error('生成过程中岗位已变化，已丢弃上一岗位话术');
      if (!response?.ok) throw new Error(response?.error || "生成失败");
      if (response.blocked) {setNotice(response.reason || '本地条件未通过，未请求模型');return response;}
      state.modelResult = response.modelResult;
      state.round = response.round || state.round;
      await logEvent('生成话术','ready',response.modelResult.fallbackUsed ? '模型话术未通过，已按JD和个人总结的一项匹配经历生成简短备用话术' : '话术已生成并通过校验');
      if (!state.modelResult?.greeting) throw new Error("模型没有生成招呼语");
      setNotice(automatic ? "招呼语已生成，准备进入沟通页面。" : "话术已生成。", "ok");
      return state.modelResult;
    } finally {
      state.busy = false;
      generateButton.textContent = "单条模型生成";
      render();
    }
  }

  function blockerText() {
    const pattern = /操作频繁|沟通人数已达上限|今日沟通.*上限|账号异常|安全验证|请完成验证|存在风险|登录已过期|请重新登录|访问异常|滑块验证/u;
    const visibleBlock = visible("[role='dialog'],.dialog-wrap,.toast,.warning,[class*='captcha'],[class*='verify'],[class*='security']")
      .map((element) => normalizeText(element.textContent)).find((text) => pattern.test(text));
    if (visibleBlock) return visibleBlock;
    return /安全验证|访问验证/u.test(document.title) ? document.title : "";
  }

  function messageInput() {
    const inputs = visible("textarea[placeholder*='输入'],textarea[placeholder*='消息'],.chat-input textarea,.message-input textarea,[contenteditable='true'][data-placeholder*='输入'],[contenteditable='true'][aria-label*='输入'],[contenteditable='true']");
    return inputs.find((element) => /消息|沟通|回复|输入|chat|message/iu.test(normalizeText(`${element.getAttribute("placeholder")} ${element.getAttribute("data-placeholder")} ${element.getAttribute("aria-label")} ${element.className}`))) || inputs.at(-1) || null;
  }

  function isChatPage() {
    const input = messageInput();
    return /\/web\/geek\/(?:chat|message|im)(?:\/|$)/u.test(location.pathname) || Boolean(input && sendButtonFor(input));
  }

  // 各项为等待上限（同通用版0.2.6默认值），页面提前就绪会立即继续。
  const DELIVERY_TIMEOUTS = Object.freeze({detail:30000,chat:60000,sendReady:15000,sendEvidence:15000,workerOutcome:240000});

  // 0.4.19：沟通点击判断沿用通用版 0.2.6。按钮自带站内聊天地址时直接进入该地址。
  function communicationTargetUrl(button) {
    if (!button) return '';
    const anchor = button.matches?.('a[href]') ? button : button.closest?.('a[href]') || button.querySelector?.('a[href]');
    const values = [
      anchor?.getAttribute?.('href'),
      button.getAttribute?.('href'),
      button.getAttribute?.('data-url'),
      button.getAttribute?.('data-href'),
      button.getAttribute?.('data-link'),
      button.getAttribute?.('data-target'),
      button.getAttribute?.('data-chat-url')
    ].map((value) => String(value || '').trim()).filter(Boolean);
    for (const value of values) {
      if (/^javascript:/iu.test(value)) continue;
      try {
        const target = new URL(value, location.href);
        if (target.protocol === 'https:' && target.hostname === 'www.zhipin.com'
          && /\/web\/geek\/(?:chat|message|im)(?:\/|$)/u.test(target.pathname)) return target.href;
      } catch {}
    }
    return '';
  }

  // 同一任务的“立即沟通”“继续沟通”各自只登记并执行一次；页面重载后由后台记录拦住重复点击。
  async function clickCommunication(pending, button) {
    if (!controlEnabled(button)) throw new Error("[communication_button_disabled] 当前沟通按钮尚未就绪，未点击");
    const buttonText = normalizeText(button.textContent || button.getAttribute?.('aria-label') || '');
    const kind = buttonText === "继续沟通" ? "continue" : "initial";
    const reserved = await sendRuntimeMessage({type:'RESERVE_COMMUNICATION_ACTION',deliveryId:pending.id,kind,
      buttonText,path:`${location.pathname}${location.search || ''}`});
    if (!reserved?.ok) throw new Error(reserved?.error || "登记沟通动作失败");
    if (reserved.pending) Object.assign(pending, reserved.pending);
    if (!reserved.claimed) return false;
    const targetUrl = communicationTargetUrl(button);
    if (targetUrl) {
      await logEvent('沟通跳转','direct_navigation',`当前任务从“${buttonText}”进入按钮提供的站内聊天地址`,pending.job);
      location.assign(targetUrl);
    } else {
      safeElementClick(button);
      await logEvent('沟通跳转','clicked',`已点击“${buttonText}”；路径=${location.pathname}；继续等待聊天页`,pending.job);
    }
    return true;
  }

  async function continueCommunication(pending) {
    // 只从点击沟通后的等待阶段调用。无输入框、同一目标岗位，且尚未发送文字时
    // 才允许补上“继续沟通”这一步；同一任务最多登记并点击一次，不循环乱点。
    if (pending.textSendRequestedAt || !["opening_chat", "continuing_chat"].includes(pending.stage)) return false;
    if (messageInput() || !destinationMatches(pending)) return false;
    const lastAction = pending.communicationActions?.at(-1);
    if (lastAction && Date.now() - Date.parse(lastAction.at) < 1000) return false;
    const button = communicationButton(findDetailRoot());
    if (!button || normalizeText(button.textContent) !== "继续沟通" || !controlEnabled(button)) return false;
    if (pending.communicationActions?.some(action => action.kind === "continue")) return false;
    await logEvent('沟通中间页','continue_ready','当前任务仍停在同一岗位详情，出现继续沟通且没有聊天输入框，接着进入消息页',pending.job);
    return clickCommunication(pending, button);
  }

  // 订阅/二维码弹层只在点击立即沟通/继续沟通之后、等待聊天输入框时处理（同 0.2.6）。
  function subscriptionPopupReason(text, qrHints = []) {
    const words = normalizeText(text).replace(/\s+/gu, "");
    if (/验证码|安全验证|风险验证|账号异常|账户异常|登录验证/u.test(words)) return "";
    if (words.includes("订阅") && words.includes("消息")) return "同时出现订阅和消息";
    if (/二维码|扫码|扫一扫/u.test(words)) return "弹窗文字提示二维码或扫码";
    if (qrHints.some((hint) => /二维码|qrcode|qr[-_ ]?code/iu.test(String(hint)))) return "弹窗内有二维码元素";
    return "";
  }

  function subscriptionReplyDialog() {
    return visible("[role='dialog'],.dialog-wrap,[class*='dialog'],[class*='modal']")
      .map((element) => {
        const qrHints = visible("img,canvas,svg,[class*='qr'],[id*='qr']", element)
          .map((item) => `${item.getAttribute?.("alt") || ""} ${item.getAttribute?.("title") || ""} ${item.getAttribute?.("class") || ""} ${item.id || ""} ${item.getAttribute?.("src") || ""}`);
        return { element, reason: subscriptionPopupReason(element.textContent, qrHints) };
      })
      .find(({ element, reason }) => reason && subscriptionDialogCloseButton(element)) || null;
  }

  function subscriptionDialogCloseButton(dialog) {
    if (!dialog) return null;
    const candidates = visible("button,a,[role='button'],[class*='close']", dialog).filter((element) => {
      const descriptor = normalizeText(`${element.textContent} ${element.getAttribute?.("aria-label")} ${element.getAttribute?.("title")} ${element.className}`);
      return /^(?:×|x|关闭)$/iu.test(descriptor) || /关闭|close|dialog-close|modal-close/iu.test(descriptor);
    });
    return candidates.length === 1 ? candidates[0] : candidates.find((element) => /close/iu.test(String(element.className || ""))) || null;
  }

  async function dismissSubscriptionReplyDialog(pending) {
    const match = subscriptionReplyDialog();
    if (!match) return false;
    const close = subscriptionDialogCloseButton(match.element);
    if (!close) return false;
    safeElementClick(close);
    await logEvent("微信订阅弹层", "closed_and_continued",
      `点击立即沟通/继续沟通之后检测到弹层（${match.reason}）；只点击弹层内部关闭按钮，当前岗位继续等待真实聊天输入框`,
      pending?.job);
    return true;
  }

  function chatSurfaceDiagnostics() {
    const dialogs = visible("[role='dialog'],.dialog-wrap,[class*='dialog'],[class*='modal']");
    const placeholders = visible("textarea,input,[contenteditable='true']")
      .map((element) => normalizeText(element.getAttribute?.("placeholder") || element.getAttribute?.("data-placeholder") || element.getAttribute?.("aria-label") || ""))
      .filter(Boolean).slice(0, 8);
    const pageText = normalizeText(document.body?.innerText || "");
    return `可见弹层=${dialogs.length}，订阅回复区域=${pageText.includes("订阅回复消息") ? "是" : "否"}，输入候选=${placeholders.length}，占位提示=${placeholders.join(" / ") || "无"}`;
  }

  function pendingPageContext() {
    return {
      type: "GET_PENDING_DELIVERY",
      pageText: normalizeText(document.body?.innerText || "").slice(0, 20000)
    };
  }

  async function getPendingForCurrentPage(timeout = 0) {
    const deadline = Date.now() + Math.max(0, timeout);
    let response = await sendRuntimeMessage(pendingPageContext());
    while (response?.pending && !response.isWorker && isChatPage() && Date.now() < deadline) {
      await sleep(300);
      response = await sendRuntimeMessage(pendingPageContext());
    }
    return response;
  }

  async function waitForInput(pending = null, timeout = DELIVERY_TIMEOUTS.chat) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const blocker = blockerText();
      if (blocker) throw new Error(`[platform_blocked] 页面出现安全验证或限制：${blocker.slice(0, 120)}`);
      if (pending && await dismissSubscriptionReplyDialog(pending)) { await sleep(300); continue; }
      const input = messageInput();
      if (input) return input;
      if (pending) await continueCommunication(pending);
      await sleep(250);
    }
    return null;
  }

  function setInput(input, text) {
    input.focus();
    if (input.matches("textarea,input")) {
      const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      setter ? setter.call(input, text) : (input.value = text);
    } else {
      input.textContent = text;
    }
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function inputText(input) {
    return normalizeText(input.matches("textarea,input") ? input.value : input.textContent);
  }

  // 只认真实发送控件；外层容器文字恰好是“发送”时不再误选（0.2.6 修复）。
  function sendButtonFor(input) {
    let root = input.parentElement;
    const selectors = "button,a,[role='button'],input[type='submit'],input[type='button'],.btn-send,.send-btn,.send-button,[class*='btn-send'],[class*='send-btn'],[data-action='send'],[data-action='send-message']";
    for (let depth = 0; depth < 8 && root && root !== document.body && root !== document.documentElement; depth += 1, root = root.parentElement) {
      const candidates = visible(selectors, root).filter(element => /^发送$/u.test(normalizeText(element.value || element.textContent)));
      const controls = candidates.filter(element => !candidates.some(other => other !== element && element.contains?.(other)));
      if (controls.length === 1) return controls[0];
      if (controls.length > 1) return null;
    }
    return null;
  }

  function controlEnabled(element) {
    return Boolean(element && !element.disabled && element.getAttribute?.("aria-disabled") !== "true"
      && !element.closest?.("[disabled],[aria-disabled='true'],.disabled,.is-disabled")
      && getComputedStyle(element).pointerEvents !== "none");
  }

  function controlDescription(element) {
    return element ? `${String(element.tagName || '').toLowerCase()}#${element.id || '-'} class=${String(element.className || '').slice(0,100)} 可点击=${controlEnabled(element) ? '是' : '否'}` : "未找到发送控件";
  }

  // 草稿与发送按钮连续两次就绪才点击；输入框被替换时不向旧控件发送。
  async function waitForSendControl(input, text) {
    const expected = normalizeText(text);
    const end = Date.now() + DELIVERY_TIMEOUTS.sendReady;
    let stableSend = null, stableCount = 0;
    while (Date.now() < end) {
      const blocker = blockerText();
      if (blocker) throw new Error(`[platform_blocked] 填写招呼语时页面出现限制：${blocker.slice(0, 120)}`);
      if (messageInput() !== input || input.isConnected === false) {
        throw new Error('[chat_input_changed] 会话输入框已被替换，不能向旧输入框继续发送；发送前核对未通过，本条未继续发送');
      }
      const send = inputText(input) === expected ? sendButtonFor(input) : null;
      if (controlEnabled(send)) {
        stableCount = send === stableSend ? stableCount + 1 : 1;
        stableSend = send;
        if (stableCount >= 2) return send;
      } else { stableSend = null; stableCount = 0; }
      await sleep(250);
    }
    return null;
  }

  function sentMessageNodes(text, input) {
    const expected = normalizeText(text);
    return new Set(visible("div,p,span").filter(element => {
      if (element === input || input?.contains?.(element) || element.contains?.(input)) return false;
      if (element.closest?.("[role='dialog'],.dialog-wrap,[class*='modal'],.user-list,.chat-user-list,.conversation-list,[data-conversation-list],.user-item,.chat-user")) return false;
      return normalizeText(element.innerText || element.textContent) === expected;
    }));
  }

  function countOccurrences(source, text) {
    const needle = normalizeText(text);
    return needle ? normalizeText(source).split(needle).length - 1 : 0;
  }

  // 发送前记录聊天区已有的同文字次数（排除可编辑输入框里的草稿），点击后要求输入框清空且新增本次文字。
  function sendEvidenceBaseline(input, text) {
    const draft = input.matches("textarea,input") ? "" : inputText(input);
    return {nodes:sentMessageNodes(text, input),
      bodyCount:Math.max(0, countOccurrences(document.body?.innerText || "", text) - countOccurrences(draft, text))};
  }

  async function waitForSendEvidence(input, text, baseline = {nodes:new Set(),bodyCount:0}) {
    const end = Date.now() + DELIVERY_TIMEOUTS.sendEvidence;
    let stableEvidence = 0;
    while (Date.now() < end) {
      const blocker = blockerText();
      if (blocker) throw new Error(`[platform_blocked] 发送后页面出现限制：${blocker.slice(0, 120)}`);
      const current = messageInput() || (input.isConnected !== false ? input : null);
      const newMessage = [...sentMessageNodes(text, current || input)].some(element => !baseline.nodes.has(element))
        || countOccurrences(document.body?.innerText || "", text) > baseline.bodyCount;
      stableEvidence = (!current || !inputText(current)) && newMessage ? stableEvidence + 1 : 0;
      if (stableEvidence >= 2) return true;
      await sleep(250);
    }
    return false;
  }

  function resumeFileInputFor(messageField) {
    const candidates = [...document.querySelectorAll("input[type='file']")]
      .filter((input) => !input.disabled)
      .filter((input) => {
        const accept = String(input.accept || "").toLowerCase();
        return !accept || /image|\.jpg|\.jpeg|\.png|\.webp/u.test(accept);
      })
      .map((input) => {
        const descriptor = normalizeText(`${input.name} ${input.id} ${input.className} ${input.accept} ${input.getAttribute("aria-label")} ${input.getAttribute("title")}`);
        let score = /image|图片|照片|photo|picture|pic/iu.test(descriptor) ? 70 : 25;
        if (/avatar|头像|head|profile/iu.test(descriptor)) score -= 120;
        let ancestor = messageField;
        for (let depth = 0; depth < 9 && ancestor; depth += 1, ancestor = ancestor.parentElement) {
          if (ancestor.contains(input)) {
            score += 90 - depth * 7;
            break;
          }
        }
        return { input, score };
      })
      .sort((a, b) => b.score - a.score);
    if (!candidates.length || candidates[0].score < 30) return null;
    if (candidates[1] && candidates[0].score === candidates[1].score) return null;
    return candidates[0].input;
  }

  async function waitForResumeFileInput(messageField, timeout = 5000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const input = resumeFileInputFor(messageField);
      if (input) return input;
      const blocker = blockerText();
      if (blocker) throw new Error(`[platform_blocked] 读取简历图片入口时页面出现限制：${blocker.slice(0, 120)}`);
      await sleep(250);
    }
    return null;
  }

  function chatImageSignatures(messageField) {
    const composer = messageField?.closest("form,[class*='chat-input'],[class*='message-input'],[class*='editor'],[class*='footer']");
    return new Set([...document.querySelectorAll("img")]
      .filter((image) => !host.contains(image))
      .filter((image) => !composer?.contains(image))
      .filter((image) => !image.closest("[role='dialog'],.dialog-wrap,[class*='modal'],[class*='preview']"))
      .map((image) => String(image.currentSrc || image.src || ""))
      .filter(Boolean));
  }

  function imageConfirmationButton() {
    const roots = visible("[role='dialog'],.dialog-wrap,[class*='dialog'],[class*='modal'],[class*='preview']")
      .filter((element) => /发送|预览|图片|照片/iu.test(normalizeText(element.textContent)) || element.querySelector("img"));
    const buttons = roots.flatMap((root) => visible("button,a,[role='button']", root))
      .filter((element) => /^(?:发送|确认发送)$/u.test(normalizeText(element.textContent)));
    return buttons.length === 1 ? buttons[0] : null;
  }

  async function sendResumeImage(image, messageField, fileInput) {
    const baseline = chatImageSignatures(messageField);
    const binary = atob(String(image.dataUrl).split(",", 2)[1] || "");
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const file = new File([bytes], image.name, { type: image.type, lastModified: Date.now() });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    fileInput.files = transfer.files;
    fileInput.dispatchEvent(new Event("input", { bubbles: true }));
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));

    const previewDeadline = Date.now() + 8000;
    let confirmation = null;
    while (Date.now() < previewDeadline) {
      const blocker = blockerText();
      if (blocker) throw new Error(`[platform_blocked] 上传简历图片时页面出现限制：${blocker.slice(0, 120)}`);
      confirmation = imageConfirmationButton();
      const current = chatImageSignatures(messageField);
      if (confirmation || [...current].some((signature) => !baseline.has(signature))) break;
      await sleep(250);
    }
    if (confirmation) {
      if (confirmation.disabled || confirmation.getAttribute("aria-disabled") === "true") throw new Error("简历图片确认发送按钮不可用");
      safeElementClick(confirmation);
    }

    const sentDeadline = Date.now() + 20000;
    let stableEvidence = 0;
    while (Date.now() < sentDeadline) {
      const blocker = blockerText();
      if (blocker) throw new Error(`[platform_blocked] 发送简历图片后页面出现限制：${blocker.slice(0, 120)}`);
      const current = chatImageSignatures(messageField);
      const hasNewChatImage = [...current].some((signature) => !baseline.has(signature));
      const confirmStillVisible = Boolean(imageConfirmationButton());
      stableEvidence = hasNewChatImage && !confirmStillVisible ? stableEvidence + 1 : 0;
      if (stableEvidence >= 2) return true;
      await sleep(350);
    }
    return false;
  }

  async function stopRun(reason, blocked = false) {
    state.stopRequested = true;
    const response = await sendRuntimeMessage({ type: "STOP_AUTOMATION", sessionId: state.automation?.id, reason, status: blocked ? "blocked" : "stopped" });
    if (response?.ok) state.automation = response.publicSession;
    render();
    setNotice(reason, blocked ? "error" : "");
  }

  async function waitCooldown() {
    while (!state.stopRequested) {
      const current = await sendRuntimeMessage({ type: "GET_STATE" });
      const remaining = Number(current?.cooldownUntil || 0) - Date.now();
      if (remaining <= 0) return;
      setNotice(`发送成功，正在按规则休息，还剩 ${Math.ceil(remaining / 1000)} 秒…`, "ok");
      await sleep(Math.min(1000, remaining));
    }
  }

  function destinationMatches(pending) {
    return inspectDestination(pending).matched;
  }

  function inspectDestination(pending) {
    const context={pageUrl:location.href,pageType:/^\/job_detail\//u.test(location.pathname) ? 'detail' : 'chat',
      visibility:document.visibilityState,readyState:document.readyState};
    let observed;
    if (pending.job.companyRoleVersion) {
      if (context.pageType==='detail') {
        const detail = extractCurrentJob(null,context);
        context.descriptionLength=normalizeText(detail.description).length;
        // URL ID取自当前页，而不是extractCurrentJob可能关联的推荐列表链接。
        observed={...detail,jobKey:stableJobKey({url:location.href})};
      } else {
        observed=readConversationIdentity(pending.job,context);
      }
      return {...destinationIdentityReport({...pending.job,jobKey:pending.jobKey},observed,context.pageType,
        {detailsReady:context.rootFound===true && context.descriptionLength>=20}),observed,context};
    }
    const page = normalizeText(document.body.innerText);
    const signals = [pending.job.recruiterName, pending.job.company, pending.job.title].map(normalizeText).filter((value) => value.length >= 2);
    const matched=!signals.length || signals.some((value) => page.includes(value));
    return {matched,code:matched ? 'legacy_identity_match' : 'legacy_identity_mismatch',checks:[],observed:null,context,
      reason:matched ? '旧任务兼容校验通过' : '旧任务的公司、岗位或招聘者信号均未匹配'};
  }

  async function logDestination(pending, stage, result, report, extra = {}) {
    await logEvent(stage,result,report.reason,pending.job,{runId:pending.automationRunId || '',
      expected:{...pending.job,jobKey:pending.jobKey},observed:report.observed || {},
      details:{...report.context,...extra,code:report.code,checks:report.checks}});
  }

  async function assertDeliveryActive(pending) {
    if (state.stopRequested) throw new Error('[delivery_cancelled] 用户已停止，未继续发送');
    const current=await sendRuntimeMessage({type:'GET_PENDING_DELIVERY'}); // 已接管任务，不重复采集聊天正文。
    if (current?.pending?.id!==pending.id || (pending.workerTabId && !current.isWorker)) {
      throw new Error('[delivery_cancelled] 当前标签页的待发送任务已结束或被替换');
    }
    if (pending.mode==='auto') {
      const run=await sendRuntimeMessage({type:'GET_AUTOMATION'});
      if (run?.session?.id!==pending.automationRunId || run.session.status!=='running') {
        throw new Error('[delivery_cancelled] 本轮已停止，未继续发送');
      }
    }
    const blocker=blockerText();
    if (blocker) throw new Error(`[platform_blocked] 页面出现安全验证或限制：${blocker.slice(0,120)}`);
  }

  // 输入框、职位卡片与招聘者抬头分别异步渲染；输入框出现不等于会话已就绪。
  async function waitForConversationDestination(pending, timeout = 20000) {
    const started=Date.now(),deadline=started+timeout;
    let attempts=0,lastReport=null,previous='',stableSince=0,lastInput=null,lastLoggedCode='';
    while (Date.now()<deadline) {
      await assertDeliveryActive(pending);
      if (await dismissSubscriptionReplyDialog(pending)) {stableSince=Date.now();await sleep(300);continue;}
      const report=inspectDestination(pending);
      const input=messageInput();
      attempts++;lastReport=report;
      const ready=report.context.pageType==='chat' && input && report.matched;
      const fingerprint=ready ? JSON.stringify(report.observed) : '';
      if (!ready || fingerprint!==previous || input!==lastInput) stableSince=Date.now();
      previous=fingerprint;lastInput=input;
      if (ready && Date.now()-stableSince>=600) {
        await logDestination(pending,'聊天会话就绪','ready',report,{attempts,elapsedMs:Date.now()-started});
        return input;
      }
      const code=ready ? 'conversation_stabilizing' : 'conversation_identity_loading';
      if (attempts===1 || lastLoggedCode!==`${code}:${report.code}`) {
        lastLoggedCode=`${code}:${report.code}`;
        await logDestination(pending,'聊天会话就绪','loading',{...report,code,
          reason:ready ? '会话身份已读取，等待短暂稳定后再发送'
            : `会话字段尚未就绪或仍在切换，继续等待：${report.reason}`},
          {attempts,elapsedMs:Date.now()-started,identityCode:report.code});
      }
      await sleep(300);
    }
    const report=lastReport || inspectDestination(pending);
    const reason=`聊天会话在 ${Math.round(timeout/1000)} 秒内未完成稳定核对；${report.reason}；没有点击发送`;
    await logDestination(pending,'聊天会话就绪','read_error',{...report,code:'conversation_identity_timeout',reason},
      {attempts,elapsedMs:Date.now()-started,identityCode:report.code});
    throw new Error(`[conversation_identity_timeout] ${reason}`);
  }

  async function requireDestination(pending, stage, expectedInput = null) {
    await assertDeliveryActive(pending);
    const report=inspectDestination(pending);
    if (expectedInput && (messageInput()!==expectedInput || expectedInput.isConnected===false)) {
      report.matched=false;report.code='chat_input_changed';report.reason='会话输入框已被替换，不能向旧输入框继续发送';
    }
    if (report.matched) return;
    await logDestination(pending,stage,'read_error',report);
    throw new Error(`[${report.code}] ${report.reason}；${stage}未通过，本条未继续发送`);
  }

  function readConversationIdentity(job, trace = null) {
    // job 仅保留旧调用签名；实际字段由局部会话 DOM 独立读取，不用预期值凑匹配。
    return readChatIdentity(messageInput(),trace);
  }

  async function updateDeliveryStage(pending, stage) {
    const response = await sendRuntimeMessage({ type: "UPDATE_PENDING_DELIVERY", deliveryId: pending.id, stage });
    if (!response?.ok) throw new Error(response?.error || "更新临时投递状态失败");
    return response.pending;
  }

  async function recordDeliveredText(pending, resumeImageStatus, resumeImageName = "") {
    return sendRuntimeMessage({
      type: "RECORD_SEND",
      deliveryId: pending.id,
      job: pending.job,
      message: pending.message,
      round: pending.round,
      automationRunId: pending.automationRunId,
      resumeImageStatus,
      resumeImageName
    });
  }

  async function deliver(pending) {
    // 页面接管和导航回调可能同时发现输入框，同一文档不重复启动一份发送。
    if (state.deliveryInFlight) return false;
    state.deliveryInFlight=pending.id;
    try {return await performDelivery(pending);}
    finally {state.deliveryInFlight=null;}
  }

  function uncertainError(message) {
    const error = new Error(message);
    error.deliveryUncertain = true;
    return error;
  }

  async function performDelivery(pending) {
    // 页面恢复后，已经登记过发送请求的任务不能再点一次发送。
    if (pending.textSendRequestedAt || ["sending_text", "sending_resume", "recording"].includes(pending.stage)) {
      throw uncertainError("[delivery_already_requested] 当前任务已有发送请求，页面恢复后不重复发送；结果待人工核对");
    }
    // 等待函数检查任务归属。旧任务失效只退出，不能清掉后来新建的待发送任务。
    const input = await waitForConversationDestination(pending);
    const resumeResponse = await sendRuntimeMessage({ type: "GET_RESUME_IMAGE_FOR_DELIVERY", deliveryId: pending.id });
    if (!resumeResponse?.ok) throw new Error(resumeResponse?.error || "读取简历图片配置失败");
    if (resumeResponse.enabled && !resumeResponse.configured) throw new Error("已开启自动附带简历图片，但设置页中没有已保存的图片");
    const resumeFileInput = resumeResponse.enabled ? await waitForResumeFileInput(input) : null;
    if (resumeResponse.enabled && !resumeFileInput) throw new Error("聊天页已打开，但没有唯一识别到图片上传控件，本条尚未发送");
    const existing = inputText(input);
    if (existing && existing !== normalizeText(pending.message)) throw new Error("[chat_draft_conflict] 当前输入框已有其他草稿，未覆盖也未发送");
    await requireDestination(pending,'填写文字前核对',input);
    // 准备草稿与请求发送分两个阶段：草稿已填写但未点击发送，不算已沟通。
    await updateDeliveryStage(pending, "preparing_text");
    if (!existing) setInput(input, pending.message);
    await logEvent('消息草稿',existing ? 'reused' : 'filled',`当前任务招呼语${existing ? '已在输入框中，直接沿用' : '已填写'}，字数=${Array.from(pending.message).length}；等待发送控件就绪`,pending.job,
      {runId:pending.automationRunId || ''});
    const send = await waitForSendControl(input, pending.message);
    if (!send) {
      throw new Error(`[send_control_not_ready] 等待 ${Math.round(DELIVERY_TIMEOUTS.sendReady / 1000)} 秒后草稿或发送按钮未就绪；草稿匹配=${inputText(input) === normalizeText(pending.message) ? '是' : '否'}；${controlDescription(sendButtonFor(input))}；消息未发送；${chatSurfaceDiagnostics()}`);
    }
    if (pending.mode === "auto") {
      const latestRun = await sendRuntimeMessage({ type: "GET_AUTOMATION" });
      if (state.stopRequested || latestRun?.session?.status !== "running" || latestRun.session.id !== pending.automationRunId) {
        throw new Error("本轮已停止，消息没有发送");
      }
    }
    await requireDestination(pending,'发送文字前核对',input);
    const baseline = sendEvidenceBaseline(input, pending.message);
    const reserved = await sendRuntimeMessage({type:'RESERVE_TEXT_SEND',deliveryId:pending.id});
    if (!reserved?.ok) throw new Error(reserved?.error || "登记发送请求失败");
    if (!reserved.claimed) throw uncertainError(`[delivery_already_requested] ${reserved.reason || "当前任务已请求发送，不重复点击"}`);
    Object.assign(pending, reserved.pending);
    await logEvent('消息发送','clicking',`草稿和发送按钮连续就绪，点击${controlDescription(send)}`,pending.job,{runId:pending.automationRunId || ''});
    safeElementClick(send);
    if (!(await waitForSendEvidence(input, pending.message, baseline))) throw new Error("[send_evidence_missing] 点击发送后没有取得明确成功证据（需要输入框清空且聊天记录新增本次文字），本条结果待核对，不计成功");
    let resumeImageStatus = resumeResponse.enabled ? "failed" : "not_requested";
    if (resumeResponse.enabled) {
      await updateDeliveryStage(pending, "sending_resume");
      try {
        await requireDestination(pending,'发送图片前核对',input);
        if (!(await sendResumeImage(resumeResponse.image, input, resumeFileInput))) throw new Error("没有取得简历图片已进入聊天记录的明确证据");
        resumeImageStatus = "sent";
      } catch (error) {
        const recordedText = await recordDeliveredText(pending, "failed", resumeResponse.image?.name || "");
        if (!recordedText?.ok) throw new Error(`招呼语可能已发出，简历图片失败，同时防重记录失败：${recordedText?.error || error.message}`);
        const reason = `招呼语已发送并已记入防重，但简历图片未确认成功：${error.message}`;
        await logEvent('图片发送失败','error',`${reason}；保留文字防重，继续下一条`,pending.job,
          {runId:pending.automationRunId,details:{code:'resume_image_failed',deliveryStage:'sending_resume',textState:'confirmed_sent',continuation:'next_job'}});
        const platformBlock = blockerText() || (/\[platform_blocked\]/u.test(error.message) ? error.message : '');
        if (pending.mode === 'auto' && platformBlock) await sendRuntimeMessage({type:'STOP_AUTOMATION',sessionId:pending.automationRunId,deliveryId:pending.id,reason:platformBlock,status:'blocked'});
        if (pending.workerTabId) await sendRuntimeMessage({ type: "CLOSE_DELIVERY_WORKER", deliveryId: pending.id });
        setNotice(reason, "error");
        return true;
      }
    }
    await updateDeliveryStage(pending, "recording");
    const recorded = await recordDeliveredText(pending, resumeImageStatus, resumeResponse.image?.name || "");
    if (!recorded?.ok) throw new Error(`消息可能已发出，但记录失败：${recorded?.error || "未知错误"}`);
    state.automation = recorded.automationSession;
    render();
    const extra = recorded.batchRestSeconds ? `，并叠加第 10 条后的 ${recorded.batchRestSeconds} 秒` : "";
    const resumeNote = resumeImageStatus === "sent" ? "，简历图片也已发送" : "";
    setNotice(`招呼语发送成功${resumeNote}，逐条等待 ${recorded.perSendRestSeconds} 秒${extra}。`, "ok");
    if (pending.workerTabId) {
      await sendRuntimeMessage({ type: "CLOSE_DELIVERY_WORKER", deliveryId: pending.id });
      return true;
    }
    await waitCooldown();
    return true;
  }

  async function waitForWorkerOutcome(pending, timeout = DELIVERY_TIMEOUTS.workerOutcome) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline && !state.stopRequested) {
      const [outcomeResponse, pendingResponse, runResponse] = await Promise.all([
        sendRuntimeMessage({ type: "GET_DELIVERY_OUTCOME", deliveryId: pending.id }),
        sendRuntimeMessage({ type: "GET_PENDING_DELIVERY" }),
        sendRuntimeMessage({ type: "GET_AUTOMATION" })
      ]);
      const outcome = outcomeResponse?.outcome;
      state.automation = runResponse?.publicSession || state.automation;
      render();
      if (outcome) {
        await loadState();
        render();
        applyContactMarkers();
        if (outcome.status === 'failed') {
          setNotice(outcome.reason || '本条投递失败，已记录并跳过，继续下一条。','error');
          return outcome;
        }
        if (outcome.resumeImageStatus === "failed") {
          if (state.automation?.status === 'running') await waitCooldown();
          setNotice("招呼语已发送并已防重，简历图片失败已记录；继续下一条，运行后可查看日志。", "error");
          return outcome;
        }
        if (state.automation?.status === "running") await waitCooldown();
        setNotice(outcome.resumeImageStatus === "sent" ? "本条文字和简历图片已发送，原职位列表未离开，继续下一条。" : "本条招呼语已发送，原职位列表未离开，继续下一条。", "ok");
        return outcome;
      }
      if (runResponse?.session?.status !== "running") throw new Error(runResponse?.session?.reason || "本轮已停止");
      if (!pendingResponse?.pending) throw new Error("临时投递任务已消失，但没有取得发送结果");
      const stageLabel = ({ opening_job: "正在加载岗位详情", opening_chat: "正在进入沟通页", continuing_chat: "正在处理继续沟通中间页", preparing_text: "正在等待草稿和发送按钮", sending_text: "正在发送招呼语", sending_resume: "正在发送简历图片", recording: "正在保存防重记录" })[pendingResponse.pending.stage] || "正在临时标签页投递";
      setNotice(`${stageLabel}；原职位列表保持不动…`, "ok");
      await sleep(700);
    }
    throw new Error(`[delivery_timeout] 临时投递页超过 ${Math.round(timeout / 1000)} 秒没有完成，本条单独记录，避免重复发送`);
  }

  async function openDelivery(mode, runId = null, alreadyConfirmed = false) {
    const message = $("#greeting")?.value.trim() || state.modelResult?.greeting || "";
    if (!message || !state.job) throw new Error("岗位或招呼语为空");
    const check = await sendRuntimeMessage({ type: "CHECK_CONTACT", job: state.job });
    if (!check?.allowed) throw new Error(check?.reason || check?.error || "当前不能发送");
    if (!alreadyConfirmed) {
      const target = `${state.job.recruiterSalutation} / ${state.job.company || state.job.title}`;
      if (!window.confirm(`即将向 ${target} 发送：\n\n${message}\n\n确认发送吗？`)) return false;
    }
    if (mode === 'manual') {state.stopRequested = false;state.pageDeparted = false;} // 用户确认了新的单条任务。
    if (state.stopRequested || state.pageDeparted) throw new Error('原页面已离开或本轮已停止，未创建新的投递任务');
    const response = await sendRuntimeMessage({ type: "SET_PENDING_DELIVERY", delivery: { mode, automationRunId: runId, job: state.job, message, round: state.round, sourceUrl: state.automation?.sourceUrl || location.href, sourceDocumentToken } });
    if (!response?.ok) throw new Error(response?.error || "保存待发送消息失败");
    if (mode === "auto") {
      const opened = await sendRuntimeMessage({ type: "OPEN_DELIVERY_WORKER" });
      if (!opened?.ok) {
        // 保留 prepared 记录，由单岗位失败处理原子地记账、释放；不能先清掉发送阶段。
        throw new Error(opened?.error || "创建临时投递页失败");
      }
      setNotice("已打开后台临时投递页；插件不主动导航原职位列表，原列表若重载则暂停。", "ok");
      await waitForWorkerOutcome(opened.pending);
      return true;
    }
    const button = communicationButton();
    if (!button) throw new Error("没有找到当前岗位的立即沟通/继续沟通按钮");
    setNotice("正在进入当前岗位的沟通页面…");
    await updateDeliveryStage(response.pending, "opening_chat");
    await clickCommunication(response.pending, button);
    const input = await waitForInput(response.pending);
    if (!input) throw new Error(`点击沟通后未等到聊天输入框；${chatSurfaceDiagnostics()}`);
    await deliver(response.pending);
    return true;
  }

  async function selectAndWait(card) {
    await waitSourceVisible();
    const before = extractCurrentJob();
    before.jobKey = stableJobKey(before);
    const alreadySelected = findActiveJobLink() === card.link;
    state.clickedJobKey = card.jobKey;
    await logEvent('详情读取','loading','正在核对目标岗位与右侧详情',{...card,url:card.href});
    if (!alreadySelected) {
      card.root.scrollIntoView({ block: "center", behavior: "auto" });
      await sleep(250);
      safeElementClick(card.link);
    }
    let remaining = 15000;
    let lastFingerprint = '', stableSince = 0, observed = null;
    let lastReadiness = {ready:false,reason:'尚未读到右侧岗位详情'};
    let readTrace={},readAttempts=0;
    const readStarted=Date.now();
    let probeAttempted = false, probeFingerprint = '', probeStableSince = 0;
    while (remaining > 0) {
      await waitSourceVisible();
      if (state.stopRequested) throw new Error('用户已停止');
      const tick = Date.now();
      const blocker = blockerText();
      if (blocker) throw new Error(`[platform_blocked] BOSS 页面出现限制：${blocker.slice(0, 120)}`);
      const liveCard = rawCards().find(item => item.jobKey === card.jobKey);
      if (!liveCard) throw new Error('目标岗位已从当前列表移除，未读取其他岗位替代');
      readTrace={pageType:'list',pageUrl:location.href,readyState:document.readyState,visibility:document.visibilityState};
      const job = extractCurrentJob(liveCard,readTrace);
      readAttempts++;
      readTrace.descriptionLength=normalizeText(job.description).length;
      readTrace.descriptionEqual=normalizeText(before.description)===normalizeText(job.description);
      // List-selected IDs are not independent proof of right-side identity.
      observed = {...job,company:job.detailCompany,jobKey:''};
      const fingerprint = detailFingerprint(job);
      lastReadiness = detailReadiness(liveCard,job,before,state.identityProof);
      if (!lastReadiness.ready && ['company_mismatch','missing_company'].includes(lastReadiness.code) && !probeAttempted) {
        if (probeFingerprint!==fingerprint) {probeFingerprint=fingerprint;probeStableSince=Date.now();}
        if (Date.now()-probeStableSince>=600) {
          probeAttempted=true;
          setNotice('公司名称来自不同区域，正在只读核对独立岗位详情；不点击沟通…');
          const response=await sendRuntimeMessage({type:'VERIFY_JOB_IDENTITY',sessionId:state.automation?.id,jobUrl:card.href,observed:job});
          if (!response?.ok) throw new Error(`${/平台限制|安全验证/u.test(response?.error || '') ? '[platform_blocked] ' : ''}公司角色核对失败：${response?.error || '独立详情未取得可靠证据'}，尚未发送`);
          state.identityProof=response.proof;
          continue; // 独立核对有自己的超时，返回后重新读取列表，不能用请求前的旧快照直接发送。
        }
      }
      if (lastReadiness.ready) {
        if (fingerprint !== lastFingerprint) { lastFingerprint = fingerprint; stableSince = Date.now(); }
        if (Date.now() - stableSince >= 600) {
          job.identityReady = true;
          state.lastVerifiedJob = {...job,jobKey:stableJobKey(job)};
          await logEvent('详情读取','ready',`${lastReadiness.reason}；内容已稳定`,job,
            {expected:card,observed,details:{...readTrace,code:lastReadiness.code,elapsedMs:Date.now()-readStarted,attempts:readAttempts}});
          return job;
        }
      } else { lastFingerprint = ''; stableSince = 0; }
      await sleep(250);
      if (document.visibilityState !== 'hidden') remaining -= Date.now() - tick;
    }
    const failureReason = lastReadiness.ready ? '右侧岗位内容持续变化，尚未稳定' : lastReadiness.reason;
    await logEvent('详情读取','read_error',`${failureReason}；本条读取失败，不判为岗位不符，由队列记录并跳过`,
      {...card,url:card.href},{expected:card,observed,details:{...readTrace,code:lastReadiness.code,elapsedMs:Date.now()-readStarted,attempts:readAttempts}});
    throw new Error(`读取失败：${card.company} / ${card.title}，${failureReason}；岗位未被判为不符合，请查看日志`);
  }

  async function nextCard(session) {
    const seen = new Set(session.seenJobKeys || []);
    let deadline = Date.now() + 7000;
    while (Date.now() < deadline) {
      const pauseStart = Date.now();
      await waitSourceVisible();
      deadline += Date.now() - pauseStart;
      const cards = collectCards();
      const next = cards.find((card) => !seen.has(card.jobKey));
      if (next) return next;
      const last = cards.at(-1);
      if (last) {
        last.root.scrollIntoView({ block: "end", behavior: "auto" });
        let scroller = last.root.parentElement;
        while (scroller && scroller !== document.body && scroller.scrollHeight <= scroller.clientHeight + 20) scroller = scroller.parentElement;
        if (scroller && scroller !== document.body) scroller.scrollTop += Math.max(260, scroller.clientHeight * .7);
        else window.scrollBy({ top: Math.max(350, innerHeight * .7), behavior: "auto" });
      }
      await sleep(500);
    }
    return null;
  }

  async function registerJob(session, job, analysis, status, reason) {
    const response = await sendRuntimeMessage({ type: "REGISTER_AUTOMATION_JOB", sessionId: session.id, job, analysis, status, reason });
    if (!response?.ok) throw new Error(response?.error || "记录识别结果失败");
    state.automation = response.publicSession;
    render();
  }

  async function continueAfterJobError(session, job, error, {status = 'read_error',deliveryId} = {}) {
    if (state.stopRequested || state.pageDeparted) return false;
    const current = await sendRuntimeMessage({type:'GET_AUTOMATION'});
    if (current?.session?.id !== session.id || current.session.status !== 'running') return false;
    const platformBlock = blockerText() || (/\[platform_blocked\]/u.test(error.message) ? error.message : '');
    if (platformBlock) {
      await sendRuntimeMessage({type:'STOP_AUTOMATION',sessionId:session.id,deliveryId,reason:platformBlock,status:'blocked'});
      await loadState();render();return false;
    }
    const pending = await sendRuntimeMessage({type:'GET_PENDING_DELIVERY'});
    const matching = pending?.pending?.automationRunId === session.id && pending.pending.jobKey === stableJobKey(job);
    const result = await sendRuntimeMessage({type:'FAIL_AUTOMATION_JOB',sessionId:session.id,job,status,
      deliveryId:deliveryId || (matching ? pending.pending.id : undefined),reason:String(error.message || error),
      uncertain:Boolean(error.deliveryUncertain),
      code:String(error.message || '').match(/\[([a-z_]+)\]/u)?.[1] || 'job_exception'});
    if (!result?.ok || result.ignored) throw new Error(result?.reason || result?.error || '本条失败记录未保存，无法安全推进队列');
    state.automation = result.publicSession || state.automation;
    if (result.alreadyCompleted && result.outcome?.status === 'sent') {
      render();setNotice('本条成功回执已保存，忽略迟到的失败报告，继续下一条。','ok');return true;
    }
    state.job = job;
    state.analysis = {decision:'review',reasons:[`本条处理失败，已跳过：${error.message}`]};
    state.contact = {allowed:false,reason:'本轮已跳过；具体失败原因见运行日志'};
    state.modelResult = null;
    render();
    setNotice(`${job.company || '公司未识别'} / ${job.title}：${error.message}；已记录本条，继续下一条。`,'error');
    await sleep(500);
    return true;
  }

  async function runLoop() {
    if (state.engineBusy) return;
    state.engineBusy = true;
    state.stopRequested = false;
    render();
    try {
      while (!state.stopRequested) {
        const runResponse = await sendRuntimeMessage({ type: "GET_AUTOMATION" });
        const session = runResponse?.session;
        state.automation = runResponse?.publicSession || state.automation;
        render();
        if (!session || session.status !== "running" || session.successCount >= session.runLimit) return;
        const runtimeState = await sendRuntimeMessage({ type: "GET_STATE" });
        if (Number(runtimeState?.cooldownUntil || 0) > Date.now()) await waitCooldown();
        if (state.stopRequested) return;
        const blocker = blockerText();
        if (blocker) throw new Error(`检测到安全验证或限制：${blocker.slice(0, 160)}`);
        const pending = await sendRuntimeMessage({ type: "GET_PENDING_DELIVERY" });
        if (pending?.pending) {
          if (pending.pending.mode === "auto") {
            try {
              let activePending = pending.pending;
              if (!activePending.workerTabId) {
                const opened = await sendRuntimeMessage({ type: "OPEN_DELIVERY_WORKER" });
                if (!opened?.ok) throw new Error(opened?.error || "恢复临时投递页失败");
                activePending = opened.pending;
              }
              await waitForWorkerOutcome(activePending);
            } catch (error) {
              if (!(await continueAfterJobError(session,pending.pending.job,error,{deliveryId:pending.pending.id}))) return;
            }
          } else if (/\/web\/geek\/chat/u.test(location.pathname) || messageInput()) {
            await deliver(pending.pending);
          } else {
            throw new Error("存在未完成的单条发送任务，请先人工进入对应沟通页");
          }
          continue;
        }
        if (/\/web\/geek\/chat/u.test(location.pathname)) throw new Error("消息页没有待发送任务，请人工回职位列表");
        await waitSourceVisible();
        const card = await nextCard(session);
        if (!card) {
          await sendRuntimeMessage({ type: "COMPLETE_AUTOMATION", sessionId: session.id, reason: "当前左侧列表已经处理到底" });
          await loadState();
          render();
          setNotice("当前左侧列表已经处理到底，本轮停止。", "ok");
          return;
        }
        let job;
        try {
          const earlyAnalysis = precheckTechCompany({...card,listingCompany:card.company}) || precheckAgency({...card,listingCompany:card.company}) || precheckExplicitTitle(card.title);
          if (earlyAnalysis) {
            // 此卡片尚未打开，不能使用右侧仍显示的上一条正文、公司或招聘者。
            const quick = {title:card.title,listingTitle:card.title,company:card.company,listingCompany:card.company,
              location:card.location,tags:card.tags,url:card.href,description:'',recruiterName:'',activityText:'',replyText:'',agencyHint:Boolean(card.agencyHint)};
            const reason = earlyAnalysis.reasons.join('；');
            state.job = quick;
            state.analysis = earlyAnalysis;
            state.modelResult = null;
            state.contact = {allowed:false,reason};
            // 登记 seenJobKeys / 已识别 / 已跳过，使 nextCard 前进且不占成功上限。
            await registerJob(session, quick, earlyAnalysis, 'skipped', reason);
            await logEvent(earlyAnalysis.code==='tech_company_manual_only' ? '列表大中厂预筛' : earlyAnalysis.code==='agency_manual_only' ? '列表猎头/外包预筛' : '列表标题预筛','skipped',reason,quick,
              {details:{code:earlyAnalysis.code || 'explicit_title_postponed',modelCalled:false,continuation:'next_job'}});
            setNotice(reason);
            await sleep(500);
            continue;
          }
          setNotice(`正在识别：${card.title}…`);
          job = await selectAndWait(card);
          state.job = job;
          state.analysis = precheckTechCompany(job) || precheckAgency(job) || analyzeJob(job);
          state.modelResult = null;
          state.contact = {allowed:false,reason:'详情已核对，正在检查沟通记录'};
          render();
          if (["postpone", "exclude"].includes(state.analysis.decision)) {
            await registerJob(session, job, state.analysis, "skipped", state.analysis.reasons.join("；"));
            await logEvent('模型前本地筛选','skipped',state.analysis.reasons.join('；'),job,
              {details:{code:state.analysis.code || 'local_screening_filtered',modelCalled:false,continuation:'next_job'}});
            setNotice(`${job.title}：${state.analysis.reasons.join("；")}，继续下一条。`);
            await sleep(500);
            continue;
          }
          const hr = checkHrActivity(job.activityText,session.hrActivityFilter);
          await logEvent('HR活跃筛选',hr.allowed ? 'passed' : 'skipped',hr.reason,job,
            {details:{code:hr.code,hrActivityFilter:hr.filter,hrActivityLabel:hr.label,modelCalled:false,continuation:hr.allowed ? 'check_contact' : 'next_job'}});
          if (!hr.allowed) {
            state.analysis={...state.analysis,decision:'postpone',category:'hr_activity',reasons:[hr.reason]};
            state.contact={allowed:false,reason:hr.reason};
            await registerJob(session,job,state.analysis,'skipped',hr.reason);
            setNotice(`${job.company} / ${job.title}：${hr.reason}，继续下一条。`);
            await sleep(500);
            continue;
          }
          let contact = await sendRuntimeMessage({ type: "CHECK_CONTACT", job });
          if (contact?.ok === false) throw new Error(contact.error || '读取沟通记录失败');
          if (["继续沟通", "已沟通"].includes(job.buttonText) && contact?.eligibility?.round === 1 && !contact?.skipExistingImport) {
            const imported = await sendRuntimeMessage({ type: "MARK_EXISTING", job, automatic: true });
            if (!imported?.ok) throw new Error(imported?.error || "登记已有沟通失败");
            contact = await sendRuntimeMessage({ type: "CHECK_CONTACT", job });
            if (contact?.ok === false) throw new Error(contact.error || '重新读取沟通记录失败');
          }
          state.round = contact?.eligibility?.round || 1;
          state.contact = contact;
          if (!contact?.allowed) {
            await registerJob(session, job, state.analysis, "skipped", contact?.reason || "当前不能沟通");
            await logEvent('模型前沟通防重','skipped',contact?.reason || '当前不能沟通',job,{details:{code:'contact_hold',modelCalled:false,continuation:'next_job'}});
            continue;
          }
          await registerJob(session, job, state.analysis, "queued", "本地岗位/公司/HR活跃/防重检查已通过，仅请求模型生成招呼语");
          let model;
          try {
            model = await generateGreeting(true);
          } catch (error) {
            if (!(await continueAfterJobError(session,job,error,{status:'generation_error'}))) return;
            continue;
          }
          if (model?.blocked) {
            const marked=await sendRuntimeMessage({type:'MARK_AUTOMATION_CANDIDATE',sessionId:session.id,jobKey:stableJobKey(job),status:'skipped',reason:model.reason || '本地筛选：模型请求前条件已改变'});
            if(!marked?.ok) throw new Error(marked?.error || '本地筛选结果保存失败');
            setNotice(`${job.title}：${model.reason}；未调用模型，继续下一条。`);
            continue;
          }
          // 是否投递已由本地完成，模型返回的分类字段不能在付费之后再否决岗位。
          await waitSourceVisible();
          const current = extractCurrentJob();
          if (stableJobKey(current) !== stableJobKey(job) || detailFingerprint(current) !== detailFingerprint(job)) {
            await logEvent('发送前核对','read_error','生成话术期间页面岗位发生变化，未发送',job,{expected:{...job,jobKey:stableJobKey(job)},observed:{...current,jobKey:stableJobKey(current)}});
            throw new Error('[source_job_changed] 生成话术期间岗位发生变化，本条未发送');
          }
          await openDelivery("auto", session.id, true);
        } catch (error) {
          // 识别尚未成功时，只能记录左侧目标卡片，不能把上一条右侧公司写入失败日志。
          const target = job || {title:card.title,listingTitle:card.title,company:card.company,listingCompany:card.company,
            description:'',location:card.location,recruiterName:'',tags:card.tags,url:card.href};
          if (!(await continueAfterJobError(session,target,error))) return;
        }
      }
    } catch (error) {
      if (!state.stopRequested) await stopRun(error.message, true);
    } finally {
      state.engineBusy = false;
      render();
    }
  }

  async function startRun() {
    if (state.engineBusy || state.automation?.status === "running") return;
    const limit = Math.max(1, Math.min(500, Math.floor(Number(runLimitInput.value) || 0)));
    if (!/\/web\/geek\/jobs/u.test(location.pathname)) return setNotice("请先由你打开并选好 BOSS 求职列表。", "error");
    if (!collectCards().length || !findDetailRoot()) return setNotice("没有读到左侧岗位列表和右侧详情，请先关闭遮挡弹窗。", "error");
    const sourcePlan = currentPlan();
    if (!sourcePlan) return setNotice("没有识别到顶部当前求职方向。请先点选“测试开发（上海）”等目标方向，确认文字变成青色后再开始。", "error");
    const resumeNote = state.settings?.attachResumeImage ? "每条招呼语成功后还会发送设置页保存的简历图片。" : "当前未开启自动附带简历图片。";
    const hrActivityFilter=normalizeHrActivityFilter(hrActivitySelect.value);
    if (!window.confirm(`本轮锁定求职方向：${sourcePlan.label}\n最多成功投递：${limit} 条。\nHR 活跃筛选：${HR_ACTIVITY_FILTERS[hrActivityFilter]}（开始后本轮不变）。\n\n原列表保持不动；后台临时标签页发送。主列表标签页被隐藏时暂停读取，返回后继续。\n\n${resumeNote}\n\n单个岗位读取、话术或投递失败：记录并跳过，继续下一条，不占成功上限。发送结果未知的岗位不自动重发。\n每次成功后等待 1–3 秒，每 10 条额外等待 10–30 秒。仅平台验证/账号限制、原列表离开或无法保存运行记录等全局问题暂停。\n\n确认开始吗？`)) return;
    const departureSequence = state.departureSequence;
    const response = await sendRuntimeMessage({ type: "START_AUTOMATION", runLimit: limit, sourceUrl: location.href, sourcePlan, sourceDocumentToken, hrActivityFilter });
    if (!response?.ok) return setNotice(response?.error || "启动失败", "error");
    state.automation = response.publicSession;
    if (state.departureSequence !== departureSequence) {
      await sendRuntimeMessage({type:'SOURCE_PAGE_LIFECYCLE',event:'left',sourceDocumentToken,sessionId:state.automation?.id});
      await loadState();render();return;
    }
    state.pageDeparted = false;
    render();
    await runLoop();
  }

  async function copyGreeting() {
    const text = $("#greeting")?.value.trim();
    if (!text) return;
    try { await navigator.clipboard.writeText(text); }
    catch { const area = $("#greeting"); area.focus(); area.select(); document.execCommand("copy"); }
    setNotice("招呼语已复制。", "ok");
  }

  async function runDeliveryWorker(pending, workerRole = null) {
    state.engineBusy = true;
    panel.classList.add("collapsed");
    $("#collapse").textContent = "展开";
    setNotice("临时投递页已接管，正在核对目标并发送文字与简历图片…", "ok");
    state.job = pending.job;
    state.analysis = analyzeJob(state.job);
    state.modelResult = { decision: "recommend", greeting: pending.message, reason: "正在执行临时投递任务" };
    state.round = pending.round;
    render();
    if (workerRole === "chat" || isChatPage()) return deliver(pending);

    // 页面切换（同岗位详情中间页、页面重载）后恢复同一任务：不重新点击立即沟通。
    const resumingTransition = ["opening_chat", "continuing_chat"].includes(pending.stage) && pending.communicationActions?.length;
    let button = null;
    let buttonDisabled = false;
    const clickStarted=Date.now(),beforePath=location.pathname;
    const entryLog=async(result,code,latest=null)=>logEvent('沟通入口诊断',result,
      `沟通按钮${buttonDisabled ? '禁用' : '可用'}；页面${location.pathname===beforePath ? '仍停留在原详情' : '路径已变化'}；聊天子标签${latest?.pending?.chatTabId ? '已绑定' : '未绑定'}；立即沟通/继续沟通各最多一次，不刷新或重试`,pending.job,
      {details:{code,pageUrl:location.href,pageType:isChatPage() ? 'chat' : 'detail',visibility:document.visibilityState,
        readyState:document.readyState,elapsedMs:Date.now()-clickStarted,inputFound:Boolean(messageInput()),
        buttonDisabled,buttonTag:button?.tagName || '',buttonHrefKind:/^javascript:/iu.test(button?.getAttribute?.('href') || '') ? 'javascript' : button?.getAttribute?.('href') ? 'link' : 'none',
        dialogPresent:visible("[role='dialog'],.dialog-wrap,.dialog-container").length>0,chatTabBound:Boolean(latest?.pending?.chatTabId),
        communicationActions:(latest?.pending || pending).communicationActions?.map(action=>action.kind) || []}});
    if (!resumingTransition) {
      await updateDeliveryStage(pending, "opening_job");
      const detailStarted=Date.now();
      const detailDeadline = Date.now() + DELIVERY_TIMEOUTS.detail;
      let readAttempts=0;
      while (Date.now() < detailDeadline) {
        const blocker = blockerText();
        if (blocker) throw new Error(`[platform_blocked] 临时岗位页出现安全验证或限制：${blocker.slice(0, 120)}`);
        if (isChatPage()) return deliver(pending);
        const latest = await getPendingForCurrentPage();
        if (!latest?.pending || latest.pending.id !== pending.id || latest.delegated) return true;
        button = communicationButton(findDetailRoot());
        const report=inspectDestination(pending);
        readAttempts++;
        if (readAttempts===1) await logDestination(pending,'临时详情身份核对','loading',report,
          {elapsedMs:Date.now()-detailStarted,attempts:readAttempts,communicationButtonFound:Boolean(button)});
        if (button && report.matched) break;
        await sleep(300);
      }
      const finalReport=inspectDestination(pending);
      if (finalReport.matched && !button) {finalReport.code='communication_button_missing';finalReport.reason='身份核对通过，但未找到可见的沟通按钮';}
      await logDestination(pending,'临时详情身份核对',finalReport.matched && button ? 'ready' : 'read_error',finalReport,
        {elapsedMs:Date.now()-detailStarted,attempts:readAttempts,communicationButtonFound:Boolean(button)});
      if (!finalReport.matched) throw new Error(`[${finalReport.code}] ${finalReport.reason}；临时详情页校验未通过，未点击沟通`);
      if (!button) throw new Error('[communication_button_missing] 临时岗位页没有找到与待投岗位一致的立即沟通/继续沟通按钮');
      await updateDeliveryStage(pending, "opening_chat");
      buttonDisabled=!controlEnabled(button);
      await entryLog('before_click','communication_click_ready');
      if(buttonDisabled) throw new Error('[communication_button_disabled] 沟通按钮当前禁用，未点击，本条跳过');
      await clickCommunication(pending, button);
    } else {
      await logEvent('沟通中间页','resumed','页面切换后恢复同一个投递任务，继续处理继续沟通或聊天输入框，不重置为新岗位',pending.job,
        {runId:pending.automationRunId || ''});
    }
    // 点击后：关闭订阅/二维码弹层、处理“继续沟通”中间状态，直到出现真实聊天输入框。
    const buttonTextBefore = pending.communicationActions?.[0]?.buttonText || normalizeText(button?.textContent || '');
    const pathBefore = `${location.pathname}${location.search || ''}`.slice(0, 240);
    const chatDeadline = Date.now() + DELIVERY_TIMEOUTS.chat;
    let nextEntryLog=Date.now()+5000;
    while (Date.now() < chatDeadline) {
      const blocker = blockerText();
      if (blocker) throw new Error(`[platform_blocked] 进入沟通页时出现安全验证或限制：${blocker.slice(0, 120)}`);
      const latest = await getPendingForCurrentPage();
      if (!latest?.pending || latest.pending.id !== pending.id || latest.delegated) return true;
      Object.assign(pending, latest.pending);
      if (await dismissSubscriptionReplyDialog(pending)) { await sleep(300); continue; }
      if (messageInput()) return deliver(pending);
      await continueCommunication(pending);
      if(Date.now()>=nextEntryLog) {await entryLog('waiting','communication_entry_wait',latest);nextEntryLog=Date.now()+5000;}
      await sleep(300);
    }
    await entryLog('timeout','communication_entry_timeout',await getPendingForCurrentPage());
    const buttonAfter = communicationButton(findDetailRoot());
    const buttonTextAfter = normalizeText(buttonAfter?.textContent || buttonAfter?.getAttribute?.('aria-label') || '');
    const pathAfter = `${location.pathname}${location.search || ''}`.slice(0, 240);
    const seconds = Math.round(DELIVERY_TIMEOUTS.chat / 1000);
    if (!/继续沟通|已沟通/u.test(buttonTextBefore) && /继续沟通|已沟通/u.test(buttonTextAfter)) {
      throw uncertainError(`[communication_state_changed] 点击前按钮“${buttonTextBefore || '未读到'}”，点击后变成“${buttonTextAfter}”，但 ${seconds} 秒内没有出现聊天输入框。BOSS 可能仍开启自动默认打招呼，或已经直接建立沟通；插件没有再次发送，本岗位待人工核对，继续后续岗位；${chatSurfaceDiagnostics()}`);
    }
    throw new Error(`[communication_entry_timeout] 已点击沟通，但 ${seconds} 秒内没有识别到输入框或任务聊天页；点击前按钮“${buttonTextBefore || '未读到'}”，点击后按钮“${buttonTextAfter || '未读到'}”，页面路径由“${pathBefore}”变为“${pathAfter}”；${chatSurfaceDiagnostics()}；详见沟通入口诊断，本条跳过，不重复点击`);
  }

  $("#refresh").addEventListener("click", () => refreshJob(true));
  hrActivitySelect.addEventListener('change',async()=>{
    if (state.engineBusy || state.automation?.status==='running') return;
    hrActivitySelect.dataset.ready='1';
    try {
      const response=await sendRuntimeMessage({type:'SAVE_HR_ACTIVITY_FILTER',value:hrActivitySelect.value});
      setNotice(response?.ok ? `已保存 HR 活跃筛选：${HR_ACTIVITY_FILTERS[response.value]}。下次点击开始时生效。` : response?.error || '保存 HR 活跃筛选失败',response?.ok ? 'ok' : 'error');
    } catch(error) {setNotice(`保存 HR 活跃筛选失败：${error.message}`,'error');}
  });
  $('#read-logs').addEventListener('click', () => readDiagnostics().catch(error=>setNotice(error.message,'error')));
  $('#capture-page').addEventListener('click', () => capturePageDiagnostics().catch(error=>setNotice(error.message,'error')));
  $('#diagnostics').addEventListener('toggle', () => { if ($('#diagnostics').open) readDiagnostics().catch(error=>setNotice(error.message,'error')); });
  $('#export-logs').addEventListener('click', async () => {
    await capturePageDiagnostics();
    if (!state.diagnostics) return;
    const blob = new Blob([JSON.stringify(state.diagnostics,null,2)],{type:'application/json'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `boss-diagnostics-${new Date().toISOString().slice(0,10)}.json`;
    shadow.appendChild(link); link.click(); link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),10000);
    setNotice('诊断日志已导出，不包含API Key、简历图片和聊天正文。','ok');
  });
  document.addEventListener('click', event => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const card = rawCards().find(item=>item.root.contains(event.target));
    if (!card) return;
    state.selectionBefore = state.lastVerifiedJob || (state.job ? {...state.job,jobKey:stableJobKey(state.job)} : null);
    state.clickedJobKey = card.jobKey;
    state.lastFingerprint = '';
    if (state.engineBusy) { stopRun('用户手动切换了岗位，本轮暂停以避免错配',true); return; }
    setTimeout(()=>refreshJob(true).catch(error=>setNotice(error.message,'error')),600);
  },true);
  $("#collapse").addEventListener("click", () => { panel.classList.toggle("collapsed"); $("#collapse").textContent = panel.classList.contains("collapsed") ? "展开" : "收起"; });
  startButton.addEventListener("click", startRun);
  stopButton.addEventListener("click", () => stopRun("用户手动停止本轮自动投放"));
  generateButton.addEventListener("click", () => generateGreeting(false).catch((error) => setNotice(error.message, "error")));
  copyButton.addEventListener("click", copyGreeting);
  sendButton.addEventListener("click", () => openDelivery("manual").catch((error) => setNotice(error.message, "error")));
  $("#mark-existing").addEventListener("click", async () => {
    if (!state.job?.title) return;
    const response = await sendRuntimeMessage({ type: "MARK_EXISTING", job: state.job });
    if (!response?.ok) return setNotice(response?.error || "登记失败", "error");
    await loadState();
    await refreshJob(true);
    await logEvent('手动标记','imported','登记已有沟通（已有记录时不重复添加）');
    setNotice(`已有沟通记录已保存；${state.contact?.reason || ''}`, "ok");
  });
  $("#mark-replied").addEventListener("click", async () => {
    if (!state.job?.title) return;
    const response = await sendRuntimeMessage({ type: "MARK_REPLIED", job: state.job });
    if (response?.ok) { await refreshJob(true); await logEvent('手动标记','replied','用户手动标记招聘者已回复'); }
    setNotice(response?.ok ? "已标记招聘者回复，不再继续激活。" : (response?.error || "标记失败"), response?.ok ? "ok" : "error");
  });

  let refreshTimer;
  new MutationObserver((records) => {
    if (state.engineBusy || state.pageDeparted) return;
    // 仅补标记不触发岗位重读；真实网站卡片新增/替换仍按既有逻辑处理。
    const ownMarker=node=>Boolean((node?.nodeType===1 ? node : node?.parentElement)?.closest?.("[data-bja-contact-marker='1'],[data-bja-result-marker='1']"));
    if (records.length && records.every(record=>ownMarker(record.target) ||
      (record.type==='childList' && [...record.addedNodes,...record.removedNodes].length>0 && [...record.addedNodes,...record.removedNodes].every(ownMarker)))) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refreshJob(false), 500);
  }).observe(document.body, { subtree: true, childList: true, characterData: true });

  // 隐藏/切换标签不等于离开文档，不能用 visibilitychange 停止后台运行。
  window.addEventListener('pagehide', () => {
    state.pageDeparted = true;
    state.departureSequence += 1;
    state.stopRequested = true;
    clearTimeout(refreshTimer);
    sendRuntimeMessage({type:'SOURCE_PAGE_LIFECYCLE',event:'left',
      sourceDocumentToken,sessionId:state.automation?.id}).catch(() => {});
  });
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    // BFCache 恢复也只读取状态，不恢复分类、不重新启动循环。
    state.stopRequested = true;
    sendRuntimeMessage({type:'SOURCE_PAGE_LIFECYCLE',event:'restored',sourceDocumentToken})
      .then(() => loadState()).then(() => {render();setNotice('页面从历史记录恢复，请核对后重新点击开始；未自动续投','error');})
      .catch(error => setNotice(error.message,'error'));
  });

  // 后台创建的核对页只调用此读取入口，不复用“立即沟通”或发送入口。
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if (message?.type!=='READ_ONLY_JOB_IDENTITY' || sender.id!==chrome.runtime.id) return;
    const key=stableJobKey({url:location.href});
    if (!/^\/job_detail\//u.test(location.pathname) || key!==message.jobKey) {respond({error:'独立详情URL与目标岗位不一致'});return;}
    const blocker=blockerText();
    if (blocker) {respond({error:`独立核对页出现平台限制：${blocker.slice(0,120)}`});return;}
    const trace={pageType:'detail',pageUrl:location.href,readyState:document.readyState,visibility:document.visibilityState};
    const job=extractCurrentJob(null,trace);
    trace.descriptionLength=normalizeText(job.description).length;
    respond({ready:Boolean(job.description?.length>=20 && job.title && job.recruiterName),jobKey:key,url:location.href,
      title:job.title,description:job.description,recruiterName:job.recruiterName,trace});
  });

  // 本页属于原列表且文档已更换时暂停旧运行；其他标签、临时详情/聊天页不会误停它。
  await sendRuntimeMessage({type:'SOURCE_PAGE_LIFECYCLE',event:'ready',sourceDocumentToken});
  await loadState();
  const pending = await getPendingForCurrentPage(isChatPage() ? 15000 : 0);
  if (pending?.pending && pending.isWorker) {
    if (pending.delegated) return;
    try {
      await runDeliveryWorker(pending.pending, pending.workerRole);
    } catch (error) {
      const latest = await getPendingForCurrentPage();
      const delegatedToChat = latest?.pending?.id === pending.pending.id && latest.delegated;
      if (delegatedToChat) return;
      if (latest?.pending?.id!==pending.pending.id) return; // 已取消/已替换，旧页不能停止新一轮。
      const reason = `临时投递页执行失败：${error.message}`;
      await logEvent('临时投递异常','error',reason,pending.pending.job,{runId:pending.pending.automationRunId || '',
        expected:{...pending.pending.job,jobKey:pending.pending.jobKey},
        details:{code:'delivery_exception',pageType:isChatPage() ? 'chat' : 'detail',pageUrl:location.href,
          visibility:document.visibilityState,readyState:document.readyState,errorName:String(error.name || 'Error'),
          errorSite:String(error.stack || '').match(/content\.js:\d+:\d+/u)?.[0] || '',deliveryStage:latest?.pending?.stage || pending.pending.stage}});
      if (pending.pending.mode === "auto") await continueAfterJobError({id:pending.pending.automationRunId},pending.pending.job,error,{deliveryId:pending.pending.id});
      else await sendRuntimeMessage({ type: "CLEAR_PENDING_DELIVERY" });
    }
    return;
  }
  if (pending?.pending && pending.pending.mode === "manual" && isChatPage()) {
    state.job = pending.pending.job;
    state.analysis = analyzeJob(state.job);
    state.modelResult = { decision: "recommend", greeting: pending.pending.message, reason: "已恢复待发送任务" };
    state.round = pending.pending.round;
    render();
    try { await deliver(pending.pending); }
    catch (error) { pending.pending.mode === "auto" ? await stopRun(error.message, true) : setNotice(error.message, "error"); }
  } else {
    if (pending?.pending && isChatPage()) {
      setNotice("当前聊天页不是这次临时投递任务打开的目标页，已保持不发送。", "error");
    } else {
      await refreshJob(true);
    }
  }
})();
