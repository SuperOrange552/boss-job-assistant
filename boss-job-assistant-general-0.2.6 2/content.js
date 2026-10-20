(async () => {
  if (window.__BOSS_JOB_ASSISTANT_LOADED__) return;
  window.__BOSS_JOB_ASSISTANT_LOADED__ = true;

  const core = await import(chrome.runtime.getURL("shared/core.js"));
  const { analyzeJob, normalizeCompanyKey, normalizeText, recruiterSalutation, stableJobKey } = core;
  const { visibleText, resolveCard, detailReady, detailReadiness, detailFingerprint } = await import(chrome.runtime.getURL("shared/page.js"));
  const { modeLabel, pacingLabel } = await import(chrome.runtime.getURL("shared/config.js"));
  const {createGreetingControls}=await import(chrome.runtime.getURL('shared/greeting-controls.js'));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

  const host = document.createElement("div");
  host.id = "boss-job-assistant-host";
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host{all:initial}.panel{position:fixed;right:18px;bottom:18px;z-index:2147483646;width:390px;max-height:calc(100vh - 36px);overflow:auto;box-sizing:border-box;border:1px solid #dfe7e8;border-radius:14px;background:#fff;color:#1f2d2f;box-shadow:0 12px 38px rgba(15,46,49,.18);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;font-size:13px;line-height:1.55}.panel.collapsed{width:230px}.panel.collapsed .body{display:none}.header{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#00bebd;color:#fff}.header strong{flex:1;font-size:15px}.icon-button{border:0;background:rgba(255,255,255,.18);color:#fff;border-radius:7px;padding:4px 8px;cursor:pointer}.body{padding:13px 14px 15px}.critical{margin-bottom:9px;padding:8px 9px;border:1px solid #f04438;border-radius:8px;background:#fff1f0;color:#9f1c16;font-weight:700}.community{margin-bottom:10px;padding:8px 9px;border:1px solid #5ccbc5;border-radius:8px;background:#e9fbf9;color:#006f6b;font-size:12px;font-weight:650}.run-box{margin-bottom:12px;padding:10px;border:1px solid #d8e7e8;border-radius:10px;background:#f7fbfb}.run-title{display:flex;justify-content:space-between;gap:8px;font-weight:700}.run-controls{display:grid;grid-template-columns:92px 1fr 1fr;gap:7px;margin-top:8px}.run-controls input{width:100%;box-sizing:border-box;border:1px solid #bfcfd1;border-radius:8px;padding:7px;font:inherit}.progress{margin-top:7px;color:#536b6e;white-space:pre-wrap}.status{display:inline-flex;border-radius:999px;padding:3px 9px;font-weight:700}.recommend{color:#067647;background:#ecfdf3}.review{color:#9a6700;background:#fff7d6}.postpone,.exclude{color:#b42318;background:#fef3f2}.muted{color:#6b7c7e}.job{margin:10px 0;padding-bottom:10px;border-bottom:1px solid #edf1f2}.job-title{font-size:15px;font-weight:700}.meta{margin-top:3px;color:#56696c;word-break:break-word}.reasons{margin:9px 0;padding-left:18px}.reasons li{margin:3px 0}.greeting{width:100%;min-height:92px;resize:vertical;box-sizing:border-box;border:1px solid #cad7d8;border-radius:9px;padding:9px;color:#1f2d2f;font:inherit}.buttons{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}button.action{border:1px solid #00aead;border-radius:8px;padding:8px 9px;cursor:pointer;background:#fff;color:#007c7b;font:inherit;font-weight:600}button.action.primary{background:#00bdbc;color:#fff}button.action.stop{border-color:#e8a09b;color:#b42318}button.action:disabled{cursor:not-allowed;opacity:.48}.notice{margin-top:9px;padding:8px 9px;border-radius:8px;background:#f4f7f7;color:#526669;white-space:pre-wrap}.error{background:#fff1f0;color:#b42318}.ok{background:#ecfdf3;color:#067647}.privacy{margin-top:8px;font-size:12px;color:#748487}
    </style>
    <section class="panel">
      <div class="header"><strong>BOSS 通用岗位助手</strong><button class="icon-button" id="refresh">识别</button><button class="icon-button" id="collapse">收起</button></div>
      <div class="body">
        <div class="critical">发送前请先关掉 BOSS 的自动默认打招呼设置，否则消息可能发送不过去。</div>
        <div class="community">如果遇到使用上的问题或有优化建议，在抖音找：<strong>superorange7</strong>。欢迎大家提出建议，授权大家做二次开发和传播。</div>
        <div class="run-box">
          <div class="run-title"><span>自动逐条投放（成功数上限）</span><span id="run-state">未开始</span></div>
          <div id="front-greeting-controls"></div><div class="run-controls"><input id="run-limit" type="number" min="1" max="500" value="20" title="本轮最多成功投递数"><button class="action primary" id="start">开始</button><button class="action stop" id="stop" disabled>停止</button></div>
          <div class="progress" id="progress">成功 0/0 · 已识别 0 · 已跳过 0</div>
        </div>
        <details id="diagnostics"><summary>运行日志 / 具体未发送原因</summary><button class="action" id="read-logs">刷新日志</button> <button class="action" id="export-logs">导出日志</button><div id="log-summary" class="notice">点击刷新查看，读取日志不会投递。</div><div id="log-entries" style="max-height:260px;overflow:auto;font-size:12px;white-space:pre-wrap"></div></details>
        <div id="summary"><span class="muted">正在读取当前岗位…</span></div>
        <div class="buttons"><button class="action primary" id="generate">生成本条话术</button><button class="action" id="copy" disabled>复制话术</button><button class="action primary" id="send" disabled>确认并发送</button><button class="action" id="mark-existing">登记已有沟通</button><button class="action" id="mark-replied">招聘者已回复</button></div>
        <div class="notice" id="notice">请先由你选择好求职列表，再设置本轮上限并点击“开始”。</div>
        <div class="privacy">原职位列表保持不动；发送间隔在设置页修改，每轮开始时锁定。列表标签页被隐藏时暂停识别，返回后继续。</div>
      </div>
    </section>`;

  const $ = (selector) => shadow.querySelector(selector);
  const panel = $(".panel");
  const summary = $("#summary");
  const notice = $("#notice");
  const startButton = $("#start");
  const stopButton = $("#stop");
  const runLimitInput = $("#run-limit");
  const greetingControls=createGreetingControls($('#front-greeting-controls'),{send:sendRuntimeMessage,onNotice:setNotice,onChange:()=>{state.modelResult=null;render();}});
  const runModeInput = greetingControls.mode;
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
    const labels = {sent:'已发送',read_error:'读取失败',generation_error:'话术/模型问题',contact_hold:'沟通防重',filtered:'筛选不符',other_skip:'其他未发送'};
    $('#log-summary').textContent = response.current
      ? Object.entries(response.current.counts).map(([key,count])=>`${labels[key] || key} ${count}`).join(' · ')
      : '尚无运行记录';
    const rows = response.current?.rows || [];
    const rowLines = rows.map(row=>`${row.at || ''}｜${row.company} / ${row.title}\n${labels[row.category] || row.status}：${row.reason}`);
    const events = (response.events || []).filter(event=>event.runId === response.current?.id).slice(-100);
    const eventLines = events.map(event=>`${event.at}｜${event.stage}｜${event.company} / ${event.title}\n${event.reason}${event.expected ? `\n目标：${event.expected.company} / ${event.expected.title} / ${event.expected.jobKey}\n读到：${event.observed?.detailCompany || event.observed?.company || '?'} / ${event.observed?.title || '?'} / ${event.observed?.jobKey || '?'}` : ''}`);
    $('#log-entries').textContent = [...rowLines,'—— 最近处理阶段 ——',...eventLines].join('\n\n');
  }

  async function waitSourceVisible() {
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
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) !== 0 && rect.width > 0 && rect.height > 0;
  }

  function visible(selector, root = document) {
    return [...root.querySelectorAll(selector)].filter(isVisible);
  }

  function safeElementClick(element) {
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
      if (!label || label.length > 50 || /^(?:首页|职位|公司|消息|简历|搜索|城市|清空)$/u.test(label)) continue;
      if (!(label==='推荐' || /[（(][^（）()]{1,20}[)）]$/u.test(label) || element.matches("[role='tab'],[class*='expect'],[class*='tab']") || element.closest("[class*='expect'],[class*='tab-list']"))) continue;
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

  async function restoreSourcePlan(session) {
    const target = session?.sourcePlan;
    if (!target?.key) throw new Error("本轮没有保存顶部求职方向，为避免进入推荐列表已停止");
    const deadline = Date.now() + 12000;
    let clicked = false;
    let fingerprintBeforeSwitch = "";
    while (Date.now() < deadline) {
      const active = currentPlan();
      if (active?.key === target.key) {
        await waitForListReady(12000, clicked ? fingerprintBeforeSwitch : "");
        return active;
      }
      const targetTab = planTabs().find((tab) => tab.key === target.key);
      if (targetTab && !clicked) {
        setNotice(`正在恢复启动时锁定的求职方向：${target.label}…`, "ok");
        fingerprintBeforeSwitch = collectCards().map((card) => card.jobKey).join("|");
        safeElementClick(targetTab.element);
        clicked = true;
      }
      await sleep(300);
    }
    throw new Error(`没有成功恢复求职方向“${target.label}”，为避免在推荐列表误投已停止`);
  }

  function firstText(selectors, root = document) {
    for (const selector of selectors) {
      const element = [...root.querySelectorAll(selector)].find(isVisible);
      const text = element ? renderedText(element) : "";
      if (text) return text;
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

  function findDetailRoot() {
    const heading = exactText(/^职位描述$/u);
    if (heading) {
      let current = heading.parentElement;
      while (current && current !== document.body) {
        const text = renderedText(current);
        if (current.querySelectorAll("a[href*='/job_detail/']").length > 1) break;
        const hasCommunicationButton = visible('button,a',current).some(element=>/^(?:立即沟通|继续沟通|沟通)$/u.test(renderedText(element)));
        if (hasCommunicationButton && text.length > 100 && text.length < 30000) return current;
        current = current.parentElement;
      }
    }
    for (const selector of [".job-detail-box", ".job-detail-container", ".job-detail-content", ".job-detail-wrapper", ".job-detail-section", ".job-detail"]) {
      const root = visible(selector).filter((element) => /职位描述/u.test(renderedText(element)))
        .sort((a, b) => renderedText(a).length - renderedText(b).length)[0];
      if (root) return root;
    }
    return null;
  }

  function detailTitle(root = findDetailRoot()) {
    if (!root) return "";
    const selected = firstText([".job-detail-info .name h1", ".job-detail-info .name", ".job-detail-header .name", ".job-primary .name", ".job-detail-box h1", ".job-name", "[class*='job-name']"], root);
    if (selected) return selected;
    const heading = exactText(/^职位描述$/u, root);
    let current = heading?.parentElement;
    for (let depth = 0; depth < 5 && current; depth += 1, current = current.parentElement) {
      const candidate = visible("h1,h2,[class*='name']", current)
        .map(renderedText)
        .find((text) => text && text !== "职位描述" && !/在线|活跃/u.test(text) && text.length <= 80);
      if (candidate) return candidate;
    }
    return "";
  }

  function cardRoot(link) {
    const direct = link.closest(".job-card-wrapper,.job-card-box,.job-list-box li,.job-list li,li");
    if (direct && direct.querySelectorAll("a[href*='/job_detail/']").length === 1) return direct;
    let current = link.parentElement;
    for (let depth = 0; depth < 7 && current && current !== document.body; depth += 1, current = current.parentElement) {
      const text = normalizeText(current.textContent);
      if (current.querySelectorAll("a[href*='/job_detail/']").length === 1 && text.length <= 1200) return current;
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
      const location = firstText([".job-area",".job-location",".area-district","[class*='job-area']"],root)
        || texts.find(text=>/^[^·\s]{2,15}·[^\s]{1,40}$/u.test(text)) || "";
      const companyLink = visible("a", root).find((element) => element !== link && !String(element.getAttribute("href") || "").includes("/job_detail/"));
      found.push({
        link,
        root,
        href,
        jobKey,
        title: renderedText(link),
        company: companyLink ? renderedText(companyLink) : "",
        selected: cardIsSelected(link, root),
        location,
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
    for (const card of collectCards()) {
      const jobMarker = state.contactMarkers.jobs?.[card.jobKey];
      const companyKey = normalizeCompanyKey(card.company);
      const companyMarker = companyKey ? state.contactMarkers.companies?.[companyKey] : null;
      const text = jobMarker
        ? `助手：本岗位已沟通 ${jobMarker.attempts} 次`
        : companyMarker
          ? "助手：同公司已有沟通"
          : "";
      let marker = card.root.querySelector(":scope > [data-bja-contact-marker='1']");
      if (!text) {
        marker?.remove();
      } else {
        if (!marker) {
          marker = document.createElement("span");
          marker.dataset.bjaContactMarker = "1";
          marker.style.cssText = "display:inline-block;margin:6px 8px 6px 0;padding:2px 7px;border-radius:999px;background:#e8f8f7;color:#087f7e;font:12px/1.5 -apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;";
          card.root.appendChild(marker);
        }
        if (marker.textContent !== text) marker.textContent = text;
      }

      const runResult = state.automation?.results?.find((row) => row.jobKey === card.jobKey);
      const runText = runResult && !["sent", "queued", "delivering"].includes(runResult.status)
        ? `助手：本轮未发送｜${String(runResult.reason || runResult.status || "原因未记录").slice(0, 140)}`
        : "";
      let runMarker = card.root.querySelector(":scope > [data-bja-run-marker='1']");
      if (!runText) {
        runMarker?.remove();
        continue;
      }
      if (!runMarker) {
        runMarker = document.createElement("span");
        runMarker.dataset.bjaRunMarker = "1";
        runMarker.style.cssText = "display:block;margin:6px 8px;padding:4px 7px;border-radius:7px;background:#fff1f0;color:#b42318;font:12px/1.5 -apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;white-space:normal;word-break:break-word;";
        card.root.appendChild(runMarker);
      }
      if (runMarker.textContent !== runText) runMarker.textContent = runText;
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
    const explicit=firstText([".job-location",".job-area",".job-detail-header .city",".job-primary .city","[class*='job-location']"],root || document);
    if(explicit)return explicit;
    if(root) {
      const city=visible("a[href*='/c10']",root).map(renderedText).find(text=>text&&text.length<=30&&!/职位|招聘/u.test(text));
      if(city)return city;
    }
    const activeCard=rawCards().find(item=>item.link===activeLink);
    return activeCard?.location || hint?.location || '';
  }

  function extractDetailCompany(root) {
    if (!root || root.querySelectorAll("a[href*='/job_detail/']").length > 1) return "";
    const direct = firstText([".job-detail-company .name", ".company-info .name", ".company-name", "[class*='company-info'] a"], root);
    if (direct) return direct;
    const recruiter = visible(".boss-info,.job-boss-info,.recruiter-info,[class*='boss-info']", root)[0];
    const companyLine = recruiter && visible("div,p,span", recruiter).map(renderedText)
      .filter(text => /[·｜|]/u.test(text) && text.length < 160 && !/去App|随时沟通|在线|活跃/u.test(text))
      .sort((a,b) => a.length-b.length)[0];
    return companyLine?.split(/[·｜|]/u)[0].trim() || "";
  }

  function extractCompany(root, activeLink, hint) {
    // The selected card is the company source. Independent detail company is checked separately.
    const card = activeLink ? cardRoot(activeLink) : null;
    const company = card && visible("a", card).find((element) => element !== activeLink && !String(element.getAttribute("href") || "").includes("/job_detail/"));
    return (company ? renderedText(company) : "") || hint?.company || extractDetailCompany(root);
  }

  function extractRecruiter(root) {
    const container = visible(".boss-info,.job-boss-info,.recruiter-info,[class*='boss-info']")
      .find((element) => !root || root.contains(element) || element.contains(root));
    let name = firstText([".boss-name", ".job-boss-info .name", ".recruiter-name", "[class*='boss-name']"], container || root || document);
    // 优先读取招聘者区域内独立的活跃标签，避免把“在线教育”等公司描述当成在线。
    let activityText = container ? firstText(['.boss-online','.active-time','.boss-active-time','.active-text','.boss-status','.online','[class*="active-time"]'],container) : '';
    if(!activityText&&container){
      activityText=visible('span,em,i',container).map(renderedText).find(text=>/^(?:在线|当前在线|刚刚活跃|今日活跃|今天活跃|昨天活跃|昨日活跃|本周活跃|本月活跃|长期未活跃|\d+\s*(?:分钟|小时)前活跃|(?:\d+|三|七)(?:日|天)(?:以内|内|前|以外|外|以上)(?:活跃|在线))$/u.test(text))||'';
    }
    if (!name) {
      const candidate = visible("h1,h2,h3,h4,div,span", root || document)
        .map((element) => normalizeText(element.textContent))
        .filter((text) => /^[\u3400-\u9fff·]{1,8}\s*(?:在线|刚刚活跃|今日活跃|今天活跃|[123](?:日|天)内活跃)$/u.test(text))
        .sort((a, b) => a.length - b.length)[0];
      if (candidate) {
        name = candidate.replace(/\s*(?:在线|刚刚活跃|今日活跃|今天活跃|[123](?:日|天)内活跃)$/u, "");
        activityText = candidate.replace(name,'').trim();
      }
    }
    name = normalizeText(name).replace(/\s*(?:在线|刚刚活跃|今日活跃|今天活跃|[123](?:日|天)内活跃).*$/u, "");
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

  async function clickCommunication(pending, button) {
    if (!controlEnabled(button)) throw new Error("当前沟通按钮尚未就绪，未点击");
    const buttonText = normalizeText(button.textContent || button.getAttribute('aria-label') || '');
    const kind = buttonText === "继续沟通" ? "continue" : "initial";
    const reserved = await sendRuntimeMessage({type:'RESERVE_COMMUNICATION_ACTION',deliveryId:pending.id,kind,
      buttonText,path:`${location.pathname}${location.search}`});
    if (!reserved?.ok) throw new Error(reserved?.error || "登记沟通动作失败");
    if (reserved.pending) Object.assign(pending, reserved.pending);
    if (!reserved.claimed) return false;
    const targetUrl = communicationTargetUrl(button);
    if (targetUrl) {
      await logEvent('沟通跳转','direct_navigation',`当前任务从“${buttonText}”进入按钮提供的站内聊天地址`,pending.job);
      location.assign(targetUrl);
    } else {
      safeElementClick(button);
      await logEvent('沟通跳转','clicked',`已点击“${buttonText}”；系统=${pending.platformOs || 'unknown'}，路径=${location.pathname}；继续等待聊天页`,pending.job);
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

  function extractCurrentJob(hint = null) {
    const root = findDetailRoot();
    if (!root) return { title: "", company: "", description: "", location: "", recruiterName: "", recruiterSalutation: "您好", activityText: "", replyText: "", tags: [], buttonText: "", url: window.location.href };
    const activeLink = hint?.link || findActiveJobLink() || null;
    const recruiter = extractRecruiter(root);
    const button = communicationButton(root);
    const tags = [...new Set(visible(".job-tags li,.job-tags span,.tag-list li,[class*='job-tag'] li", root).map((element) => normalizeText(element.textContent)).filter(Boolean))].slice(0, 20);
    const pageText = renderedText(root);
    return {
      title: detailTitle(root) || normalizeText(activeLink?.textContent) || hint?.title || "",
      company: extractCompany(root, activeLink, hint),
      detailCompany: extractDetailCompany(root),
      description: extractDescription(root),
      location: extractLocation(root, activeLink, hint),
      recruiterName: recruiter.name,
      recruiterSalutation: recruiterSalutation(recruiter.name),
      activityText: recruiter.activityText,
      replyText: pageText.match(/(?:今日|今天)回复(?:过求职者|过候选人|活跃)?[^\s，。；]{0,12}/u)?.[0] || "",
      tags: tags.length ? tags : (hint?.tags || []),
      buttonText: normalizeText(button?.textContent),
      url: activeLink ? new URL(activeLink.getAttribute("href"), window.location.href).href : (hint?.href || window.location.href),
      identityReady: !/\/web\/geek\/jobs/u.test(location.pathname) || Boolean(activeLink)
    };
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" })[char]);
  }

  function label(decision) {
    return ({ recommend: "推荐", review: "需要核对", postpone: "当前暂缓", exclude: "不符合" })[decision] || "待判断";
  }

  function renderAutomation() {
    const run = state.automation;
    const running = run?.status === "running";
    greetingControls.lock(running || state.engineBusy || state.busy);
    if(running)runModeInput.value=run.greetingMode;
    if(!state.busy)generateButton.textContent=modeLabel(runModeInput.value)+"本条话术";
    $("#run-state").textContent = run?.statusLabel || "未开始";
    $("#progress").textContent = run
      ? `成功 ${run.successCount || 0}/${run.runLimit || 0} · 已识别 ${run.scannedCount || 0} · 已跳过 ${run.skippedCount || 0}\n读取失败 ${run.readErrorCount || 0} · 话术问题 ${run.generationErrorCount || 0}${run.sourcePlan?.label ? `\n锁定方向：${run.sourcePlan.label}\n本轮方式：${modeLabel(run.greetingMode)}` : ""}${run.reason ? `\n${run.reason}` : ""}`
      : "成功 0/0 · 已识别 0 · 已跳过 0";
    startButton.disabled = running || state.engineBusy;
    stopButton.disabled = !running;
    runLimitInput.disabled = running;
  }

  function renderJob() {
    greetingControls.setJob(state.job,state.settings?.greetingMaxChars);
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
    summary.innerHTML = `<span class="status ${escapeHtml(result.decision)}">${label(result.decision)}</span><div class="job"><div class="job-title">${escapeHtml(state.job.title)}</div><div class="meta">${escapeHtml(state.job.company || "公司未识别")} · ${escapeHtml(state.job.location || "地点未识别")}</div><div class="meta">${escapeHtml(state.job.recruiterSalutation)} · ${escapeHtml(state.job.activityText || "活跃状态未识别")} · 第 ${state.round} 次沟通</div></div><ul class="reasons">${reasons.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul><textarea class="greeting" id="greeting" placeholder="自动模式会直接生成；也可点击生成本条话术">${escapeHtml(greeting)}</textarea>`;
    const contactLine = document.createElement('div');
    contactLine.className = 'notice';
    const previous = state.automation?.results?.find(row=>row.jobKey === stableJobKey(state.job));
    const statusName = {sent:'已发送',skipped:'未发送',read_error:'读取失败',generation_error:'话术问题',queued:'等待生成',delivering:'发送中'};
    contactLine.textContent = `发送资格：${state.contact?.reason || '正在核对'}${previous ? `\n本轮记录：${statusName[previous.status] || previous.status} · ${previous.reason}` : ''}`;
    summary.prepend(contactLine);
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
  }

  async function loadState() {
    await greetingControls.load();
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
    }
    if (automation?.ok) {
      state.automation = automation.publicSession;
      if (automation.publicSession?.status === "running") runLimitInput.value = String(automation.publicSession.runLimit || runLimitInput.value);
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
      job.identityReady = Boolean(expected && job.identityReady && detailReady(expected,job,before));
      if (job.identityReady) { state.selectionBefore = null; state.lastVerifiedJob = {...job,jobKey:stableJobKey(job)}; }
    }
    state.lastFingerprint = job.identityReady ? fingerprint : '';
    state.job = job;
    state.modelResult = null;
    await loadState();
    state.analysis = analyzeJob(job,state.settings);
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
    if(!automatic)await greetingControls.save();
    state.busy = true;
    generateButton.textContent = "生成中…";
    render();
    setNotice(`正在为“${state.job.title}”生成招呼语…`);
    try {
      const expectedJob = state.job;
      const response = await sendRuntimeMessage({ type: "GENERATE_GREETING", job: expectedJob, ...greetingControls.draft() });
      if (stableJobKey(state.job) !== stableJobKey(expectedJob)) throw new Error('生成过程中岗位已变化，已丢弃上一岗位话术');
      if (!response?.ok) throw new Error(response?.error || "生成失败");
      if (response.blocked) throw new Error(response.reason || "当前岗位不能沟通");
      state.modelResult = response.modelResult;
      state.round = response.round || state.round;
      await logEvent('生成话术','ready',response.mode==='template' ? '自定义模板已替换变量，未调用AI' : 'AI话术已生成');
      if (!state.modelResult?.greeting) throw new Error("没有生成可发送的招呼语");
      setNotice(automatic ? "招呼语已生成，准备进入沟通页面。" : "话术已生成。", "ok");
      return state.modelResult;
    } finally {
      state.busy = false;
      generateButton.textContent = "生成本条话术";
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
    const inputs = visible([
      "textarea[placeholder*='输入']", "textarea[placeholder*='消息']",
      ".chat-input textarea", ".message-input textarea",
      "[contenteditable='true'][data-placeholder*='输入']",
      "[contenteditable='true'][aria-label*='输入']", "[contenteditable='true']"
    ].join(","));
    return inputs.map((element) => {
      const descriptor = normalizeText(`${element.getAttribute("placeholder")} ${element.getAttribute("data-placeholder")} ${element.getAttribute("aria-label")} ${element.className}`);
      let score = /消息|沟通|回复|输入|chat|message/iu.test(descriptor) ? 120 : 10;
      if (element.closest("[role='dialog'],.dialog-wrap,[class*='dialog'],[class*='modal']")) score += 50;
      if (sendButtonFor(element)) score += 60;
      return { element, score };
    }).sort((a, b) => b.score - a.score)[0]?.element || null;
  }

  function isChatPage() {
    const input = messageInput();
    return /\/web\/geek\/(?:chat|message|im)(?:\/|$)/u.test(location.pathname) || Boolean(input && sendButtonFor(input));
  }

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
          .map((item) => `${item.getAttribute("alt") || ""} ${item.getAttribute("title") || ""} ${item.getAttribute("class") || ""} ${item.id || ""} ${item.getAttribute("src") || ""}`);
        return { element, reason: subscriptionPopupReason(element.textContent, qrHints) };
      })
      .find(({ element, reason }) => reason && subscriptionDialogCloseButton(element)) || null;
  }

  function subscriptionDialogCloseButton(dialog) {
    if (!dialog) return null;
    const candidates = visible("button,a,[role='button'],[class*='close']", dialog).filter((element) => {
      const descriptor = normalizeText(`${element.textContent} ${element.getAttribute("aria-label")} ${element.getAttribute("title")} ${element.className}`);
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

  function deliveryTimeoutMs(pending, key, fallbackMs) {
    const seconds = Number(pending?.timings?.[key] ?? state.settings?.[key]);
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : fallbackMs;
  }

  function chatSurfaceDiagnostics() {
    const dialogs = visible("[role='dialog'],.dialog-wrap,[class*='dialog'],[class*='modal']");
    const placeholders = visible("textarea,input,[contenteditable='true']")
      .map((element) => normalizeText(element.getAttribute("placeholder") || element.getAttribute("data-placeholder") || element.getAttribute("aria-label") || ""))
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
    while (response?.pending && !response.isWorker && /\/job_detail\/|\/web\/geek\/(?:chat|message|im)(?:\/|$)/u.test(location.pathname) && Date.now() < deadline) {
      await sleep(300);
      response = await sendRuntimeMessage(pendingPageContext());
    }
    return response;
  }

  async function waitForInput(pending = null, timeout = deliveryTimeoutMs(pending, "chatReadyTimeoutSeconds", 60000)) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const blocker = blockerText();
      if (blocker) throw new Error(`页面出现安全验证或限制：${blocker.slice(0, 120)}`);
      if (await dismissSubscriptionReplyDialog(pending)) { await sleep(300); continue; }
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

  function sendButtonFor(input) {
    let root = input.parentElement;
    const selectors = "button,a,[role='button'],input[type='submit'],input[type='button'],.btn-send,.send-btn,.send-button,[class*='btn-send'],[class*='send-btn'],[data-action='send'],[data-action='send-message']";
    for (let depth = 0; depth < 8 && root && root !== document.body && root !== document.documentElement; depth += 1, root = root.parentElement) {
      const candidates = visible(selectors, root).filter(element => /^发送$/u.test(normalizeText(element.value || element.textContent)));
      const controls = candidates.filter(element => !candidates.some(other => other !== element && element.contains(other)));
      if (controls.length === 1) return controls[0];
      if (controls.length > 1) return null;
    }
    return null;
  }

  function controlEnabled(element) {
    return Boolean(element && !element.disabled && element.getAttribute("aria-disabled") !== "true"
      && !element.closest("[disabled],[aria-disabled='true'],.disabled,.is-disabled")
      && getComputedStyle(element).pointerEvents !== "none");
  }

  function controlDescription(element) {
    return element ? `${element.tagName.toLowerCase()}#${element.id || '-'} class=${String(element.className || '').slice(0,100)} 可点击=${controlEnabled(element) ? '是' : '否'}` : "未找到发送控件";
  }

  async function waitForSendControl(input, text, pending) {
    const expected = normalizeText(text);
    const end = Date.now() + deliveryTimeoutMs(pending, "sendEvidenceTimeoutSeconds", 15000);
    let current = input;
    let stableSend = null;
    let stableCount = 0;
    while (Date.now() < end) {
      const blocker = blockerText();
      if (blocker) throw new Error(`填写招呼语时页面出现限制：${blocker.slice(0, 120)}`);
      const fresh = messageInput();
      if (fresh && fresh !== current) {
        current = fresh;
        const existing = inputText(current);
        if (existing && existing !== expected) throw new Error("沟通输入框出现其他草稿，未覆盖也未发送");
        if (!existing) setInput(current, text);
        stableSend = null;
        stableCount = 0;
      }
      if (inputText(current) === expected) {
        const send = sendButtonFor(current);
        if (controlEnabled(send)) {
          stableCount = send === stableSend ? stableCount + 1 : 1;
          stableSend = send;
          if (stableCount >= 2) return { input: current, send };
        } else { stableSend = null; stableCount = 0; }
      } else {
        stableSend = null;
        stableCount = 0;
      }
      await sleep(250);
    }
    return null;
  }

  function sentMessageNodes(text, input) {
    const expected = normalizeText(text);
    return new Set(visible("div,p,span").filter(element => {
      if (element === input || input?.contains(element) || element.contains(input)) return false;
      if (element.closest("[role='dialog'],.dialog-wrap,[class*='modal'],.user-list,.chat-user-list,.conversation-list,[data-conversation-list],.user-item,.chat-user")) return false;
      return normalizeText(element.innerText || element.textContent) === expected;
    }));
  }

  async function waitForSendEvidence(input, text, pending, baseline = new Set()) {
    const end = Date.now() + deliveryTimeoutMs(pending, "sendEvidenceTimeoutSeconds", 15000);
    let stableEvidence = 0;
    while (Date.now() < end) {
      const blocker = blockerText();
      if (blocker) throw new Error(`发送后页面出现限制：${blocker.slice(0, 120)}`);
      const current = messageInput() || (input.isConnected !== false ? input : null);
      const newMessage = [...sentMessageNodes(text, current || input)].some(element => !baseline.has(element));
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

  async function waitForResumeFileInput(messageField, pending = null, timeout = deliveryTimeoutMs(pending, "chatReadyTimeoutSeconds", 60000)) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const input = resumeFileInputFor(messageField);
      if (input) return input;
      const blocker = blockerText();
      if (blocker) throw new Error(`读取简历图片入口时页面出现限制：${blocker.slice(0, 120)}`);
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

  async function sendResumeImage(image, messageField, fileInput, pending) {
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

    const resumeTimeout = deliveryTimeoutMs(pending, "resumeSendTimeoutSeconds", 45000);
    const previewDeadline = Date.now() + Math.min(15000, resumeTimeout);
    let confirmation = null;
    while (Date.now() < previewDeadline) {
      const blocker = blockerText();
      if (blocker) throw new Error(`上传简历图片时页面出现限制：${blocker.slice(0, 120)}`);
      confirmation = imageConfirmationButton();
      const current = chatImageSignatures(messageField);
      if (confirmation || [...current].some((signature) => !baseline.has(signature))) break;
      await sleep(250);
    }
    if (confirmation) {
      if (confirmation.disabled || confirmation.getAttribute("aria-disabled") === "true") throw new Error("简历图片确认发送按钮不可用");
      safeElementClick(confirmation);
    }

    const sentDeadline = Date.now() + resumeTimeout;
    let stableEvidence = 0;
    while (Date.now() < sentDeadline) {
      const blocker = blockerText();
      if (blocker) throw new Error(`发送简历图片后页面出现限制：${blocker.slice(0, 120)}`);
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
    const response = await sendRuntimeMessage({ type: "STOP_AUTOMATION", reason, status: blocked ? "blocked" : "stopped" });
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
    const page = normalizeText(document.body.innerText);
    const signals = [pending.job.recruiterName, pending.job.company, pending.job.title].map(normalizeText).filter((value) => value.length >= 2);
    return !signals.length || signals.some((value) => page.includes(value));
  }

  async function updateDeliveryStage(pending, stage) {
    const response = await sendRuntimeMessage({ type: "UPDATE_PENDING_DELIVERY", deliveryId: pending.id, stage });
    if (!response?.ok) throw new Error(response?.error || "更新临时投递状态失败");
    if (response.pending) Object.assign(pending, response.pending);
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
    if (pending.mode === "auto") {
      const run = await sendRuntimeMessage({ type: "GET_AUTOMATION" });
      if (!run?.session || run.session.id !== pending.automationRunId || run.session.status !== "running") {
        await sendRuntimeMessage({ type: "CLEAR_PENDING_DELIVERY" });
        return false;
      }
    }
    if (pending.textSendRequestedAt || ["sending_text", "sending_resume", "recording"].includes(pending.stage)) {
      const error = new Error("当前任务已有发送请求，页面恢复后不重复发送；结果待人工核对");
      error.deliveryUncertain = true;
      throw error;
    }
    const input = await waitForInput(pending);
    if (!input) {
      throw new Error(`进入沟通页后等待 ${Math.round(deliveryTimeoutMs(pending, "chatReadyTimeoutSeconds", 60000) / 1000)} 秒仍未识别到聊天输入框；${chatSurfaceDiagnostics()}`);
    }
    if (!destinationMatches(pending)) throw new Error("消息页面与待投岗位不一致，已跳过当前岗位，整轮继续");
    const resumeResponse = await sendRuntimeMessage({ type: "GET_RESUME_IMAGE_FOR_DELIVERY", deliveryId: pending.id });
    if (!resumeResponse?.ok) throw new Error(resumeResponse?.error || "读取简历图片配置失败");
    if (resumeResponse.enabled && !resumeResponse.configured) throw new Error("已开启自动附带简历图片，但设置页中没有已保存的图片");
    const resumeFileInput = resumeResponse.enabled ? await waitForResumeFileInput(input, pending) : null;
    if (resumeResponse.enabled && !resumeFileInput) throw new Error("聊天页已打开，但没有唯一识别到图片上传控件；为避免只发文字，本条尚未发送，已跳过当前岗位");
    const existing = inputText(input);
    if (existing && existing !== normalizeText(pending.message)) throw new Error("当前输入框已有其他草稿，未覆盖也未发送");
    await updateDeliveryStage(pending, "preparing_text");
    if (!existing) setInput(input, pending.message);
    await logEvent('消息草稿',existing ? 'reused' : 'filled',`当前任务招呼语${existing ? '已在输入框中，直接沿用' : '已填写'}，字数=${Array.from(pending.message).length}；等待发送控件就绪`,pending.job);
    const ready = await waitForSendControl(input, pending.message, pending);
    if (!ready) {
      throw new Error(`等待 ${Math.round(deliveryTimeoutMs(pending, "sendEvidenceTimeoutSeconds", 15000) / 1000)} 秒后草稿或发送按钮未就绪；草稿匹配=${inputText(messageInput() || input) === normalizeText(pending.message) ? '是' : '否'}；${controlDescription(sendButtonFor(messageInput() || input))}；消息未发送；${chatSurfaceDiagnostics()}`);
    }
    const activeInput = ready.input;
    const send = ready.send;
    if (pending.mode === "auto") {
      const latestRun = await sendRuntimeMessage({ type: "GET_AUTOMATION" });
      if (state.stopRequested || latestRun?.session?.status !== "running" || latestRun.session.id !== pending.automationRunId) {
        throw new Error("本轮已停止，消息没有发送");
      }
    }
    if (!destinationMatches(pending)) throw new Error("发送前当前会话已变化，本条未发送，整轮继续");
    const baseline = sentMessageNodes(pending.message, activeInput);
    const reserved = await sendRuntimeMessage({type:'RESERVE_TEXT_SEND',deliveryId:pending.id});
    if (!reserved?.ok) throw new Error(reserved?.error || "登记发送请求失败");
    if (!reserved.claimed) {
      const error = new Error(reserved.reason || "当前任务已请求发送，不重复点击");
      error.deliveryUncertain = true;
      throw error;
    }
    Object.assign(pending, reserved.pending);
    await logEvent('消息发送','clicking',`草稿和发送按钮连续就绪，点击${controlDescription(send)}`,pending.job);
    safeElementClick(send);
    if (!(await waitForSendEvidence(activeInput, pending.message, pending, baseline))) throw new Error("已点击发送，但没有同时确认输入框清空和新增聊天消息；本岗位待人工核对，整轮继续");
    await logEvent('消息发送','confirmed','已确认输入框清空且当前任务文字新增到聊天记录',pending.job);
    let resumeImageStatus = resumeResponse.enabled ? "failed" : "not_requested";
    if (resumeResponse.enabled) {
      await updateDeliveryStage(pending, "sending_resume");
      try {
        const imageField = messageInput() || activeInput;
        const currentFileInput = await waitForResumeFileInput(imageField, pending);
        if (!currentFileInput) throw new Error("文字已发送，但页面重绘后图片上传入口尚未就绪");
        if (!(await sendResumeImage(resumeResponse.image, imageField, currentFileInput, pending))) throw new Error("没有取得简历图片已进入聊天记录的明确证据");
        resumeImageStatus = "sent";
      } catch (error) {
        const recordedText = await recordDeliveredText(pending, "failed", resumeResponse.image?.name || "");
        if (!recordedText?.ok) throw new Error(`招呼语可能已发出，简历图片失败，同时防重记录失败：${recordedText?.error || error.message}`);
        const reason = `招呼语已发送并已记入防重，但简历图片未确认成功：${error.message}；当前岗位结束，整轮继续`;
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

  async function waitForWorkerOutcome(pending, timeout = null) {
    const chatBudget = deliveryTimeoutMs(pending, "chatReadyTimeoutSeconds", 60000);
    const imageBudget = deliveryTimeoutMs(pending, "resumeSendTimeoutSeconds", 45000);
    const configuredTimeout = timeout ?? (
      deliveryTimeoutMs(pending, "detailLoadTimeoutSeconds", 30000)
      + chatBudget
      + 2 * deliveryTimeoutMs(pending, "sendEvidenceTimeoutSeconds", 15000)
      + (pending.resumeRequested ? 2 * chatBudget + imageBudget + Math.min(15000, imageBudget) : 0)
      + 30000
    );
    const deadline = Date.now() + configuredTimeout;
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
        if (outcome.status === 'failed' || outcome.status === 'uncertain') {
          const prefix = outcome.status === 'uncertain' ? '本岗位结果待人工核对' : '本岗位临时投递失败';
          throw new Error(`${prefix}：${outcome.error || '临时页面没有返回具体原因'}`);
        }
        if (outcome.resumeImageStatus === "failed") {
          if (state.automation?.status === "running") await waitCooldown();
          setNotice("招呼语已发送并已防重，但简历图片未确认成功；已记录图片失败，继续下一条。", "error");
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
    throw new Error(`临时投递页超过 ${Math.ceil(configuredTimeout / 1000)} 秒没有完成；当前岗位将隔离并记录，整轮继续`);
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
    const response = await sendRuntimeMessage({ type: "SET_PENDING_DELIVERY", delivery: { mode, automationRunId: runId, job: state.job, message, round: state.round, sourceUrl: state.automation?.sourceUrl || location.href } });
    if (!response?.ok) throw new Error(response?.error || "保存待发送消息失败");
    if (mode === "auto") {
      const opened = await sendRuntimeMessage({ type: "OPEN_DELIVERY_WORKER" });
      if (!opened?.ok) {
        await sendRuntimeMessage({ type: "CLEAR_PENDING_DELIVERY" });
        throw new Error(opened?.error || "创建临时投递页失败");
      }
      setNotice("已打开后台临时投递页；当前职位列表不会离开或重新排序。", "ok");
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
    let remaining = deliveryTimeoutMs(null, "detailLoadTimeoutSeconds", 30000);
    let lastFingerprint = '', stableSince = 0, observed = null;
    let lastReadiness = {ready:false,reason:'尚未读到右侧岗位详情'};
    while (remaining > 0) {
      await waitSourceVisible();
      if (state.stopRequested) throw new Error('用户已停止');
      const tick = Date.now();
      const blocker = blockerText();
      if (blocker) throw new Error(`BOSS 页面出现限制：${blocker.slice(0, 120)}`);
      const liveCard = rawCards().find(item => item.jobKey === card.jobKey);
      if (!liveCard) throw new Error('目标岗位已从当前列表移除，未读取其他岗位替代');
      const job = extractCurrentJob(liveCard);
      // List-selected IDs are not independent proof of right-side identity.
      observed = {title:job.title,company:job.detailCompany,detailCompany:job.detailCompany,jobKey:''};
      const fingerprint = detailFingerprint(job);
      lastReadiness = detailReadiness(liveCard,job,before);
      if (lastReadiness.ready) {
        if (fingerprint !== lastFingerprint) { lastFingerprint = fingerprint; stableSince = Date.now(); }
        if (Date.now() - stableSince >= 600) {
          job.identityReady = true;
          state.lastVerifiedJob = {...job,jobKey:stableJobKey(job)};
          await logEvent('详情读取','ready',`${lastReadiness.reason}；内容已稳定`,job,
            lastReadiness.code === 'ready_benefit_suffix' ? {expected:card,observed} : {});
          return job;
        }
      } else { lastFingerprint = ''; stableSince = 0; }
      await sleep(250);
      if (document.visibilityState !== 'hidden') remaining -= Date.now() - tick;
    }
    const failureReason = lastReadiness.ready ? '右侧岗位内容持续变化，尚未稳定' : lastReadiness.reason;
    await logEvent('详情读取','read_error',`${failureReason}；记录并跳过本条，整轮继续`,
      {...card,url:card.href},{expected:card,observed});
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
        if(runtimeState?.ok)state.settings=runtimeState.settings;
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
              const abandoned = await sendRuntimeMessage({ type: "ABANDON_PENDING_DELIVERY", deliveryId: pending.pending.id, reason: error.message });
              await sendRuntimeMessage({ type: "MARK_AUTOMATION_CANDIDATE", sessionId: session.id, jobKey: pending.pending.jobKey, status: "read_error", reason: `${abandoned?.uncertain ? '发送结果待核对' : '临时投递失败'}：${error.message}` });
              setNotice(`${pending.pending.job?.title || '当前岗位'}：${abandoned?.uncertain ? '发送结果未知，已隔离防重' : '临时投递失败'}，继续下一条。`, "error");
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
        setNotice(`正在识别：${card.title}…`);
        let job;
        try {
          job = await selectAndWait(card);
        } catch (error) {
          const quick = { title: card.title, company: card.company, description: "", location: card.location, recruiterName: "", activityText: "", replyText: "", tags: card.tags, url: card.href };
          if (state.stopRequested) return;
          await registerJob(session, quick, {decision:'review',category:'unread',reasons:['尚未取得可靠详情，不作岗位适配判断']}, "read_error", error.message);
          setNotice(`${card.title}：详情读取失败，已记录并跳过本条。${error.message}`, "error");
          continue;
        }
        state.job = job;
        state.analysis = analyzeJob(job,state.settings);
        state.modelResult = null;
        state.contact = {allowed:false,reason:'详情已核对，正在检查沟通记录'};
        render();
        if (["postpone", "exclude"].includes(state.analysis.decision)) {
          await registerJob(session, job, state.analysis, "skipped", state.analysis.reasons.join("；"));
          setNotice(`${job.title}：${state.analysis.reasons.join("；")}，继续下一条。`);
          await sleep(500);
          continue;
        }
        let contact = await sendRuntimeMessage({ type: "CHECK_CONTACT", job });
        if (["继续沟通", "已沟通"].includes(job.buttonText) && contact?.eligibility?.round === 1) {
          const imported = await sendRuntimeMessage({ type: "MARK_EXISTING", job });
          if (!imported?.ok) {
            await registerJob(session, job, state.analysis, "read_error", imported?.error || "登记已有沟通失败");
            setNotice(`${job.title}：沟通记录核对失败，已记录并跳过本条。`, "error");
            continue;
          }
          contact = await sendRuntimeMessage({ type: "CHECK_CONTACT", job });
        }
        state.round = contact?.eligibility?.round || 1;
        state.contact = contact;
        if (!contact?.allowed) {
          await registerJob(session, job, state.analysis, "skipped", contact?.reason || "当前不能沟通");
          continue;
        }
        await registerJob(session, job, state.analysis, "queued", `本地规则通过，准备${modeLabel(session.runConfig.greetingMode)}话术`);
        let model;
        try {
          model = await generateGreeting(true);
        } catch (error) {
          await sendRuntimeMessage({ type: "MARK_AUTOMATION_CANDIDATE", sessionId: session.id, jobKey: stableJobKey(job), status: "generation_error", reason: error.message });
          setNotice(`${job.title}：话术生成失败，已单独记录为话术问题，不是岗位不符合。${error.message}`, "error");
          continue;
        }
        if (model.decision !== "recommend") {
          await sendRuntimeMessage({ type: "MARK_AUTOMATION_CANDIDATE", sessionId: session.id, jobKey: stableJobKey(job), status: "skipped", reason: model.reason || "模型未推荐" });
          setNotice(`${job.title}：模型判断为${label(model.decision)}，继续下一条。`);
          continue;
        }
        await waitSourceVisible();
        const current = extractCurrentJob();
        if (stableJobKey(current) !== stableJobKey(job) || detailFingerprint(current) !== detailFingerprint(job)) {
          await logEvent('发送前核对','read_error','生成话术期间页面岗位发生变化，未发送',job,{expected:{...job,jobKey:stableJobKey(job)},observed:{...current,jobKey:stableJobKey(current)}});
          await sendRuntimeMessage({ type: "MARK_AUTOMATION_CANDIDATE", sessionId: session.id, jobKey: stableJobKey(job), status: "read_error", reason: "生成话术期间页面岗位发生变化，未发送" });
          setNotice(`${job.title}：发送前岗位已变化，已记录并跳过本条。`, "error");
          continue;
        }
        try {
          await openDelivery("auto", session.id, true);
        } catch (error) {
          const pendingResponse = await sendRuntimeMessage({ type: "GET_PENDING_DELIVERY" });
          if (pendingResponse?.pending) await sendRuntimeMessage({ type: "ABANDON_PENDING_DELIVERY", deliveryId: pendingResponse.pending.id, reason: error.message });
          await sendRuntimeMessage({ type: "MARK_AUTOMATION_CANDIDATE", sessionId: session.id, jobKey: stableJobKey(job), status: "read_error", reason: `临时投递页失败：${error.message}` });
          setNotice(`${job.title}：临时投递页失败，已记录并跳过本条。${error.message}`, "error");
          continue;
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
    if (!sourcePlan) return setNotice("没有识别到顶部当前求职方向。请先点选你需要的求职方向，确认文字变成青色后再开始。", "error");
    await greetingControls.save();
    await loadState();
    const resumeNote = state.settings?.attachResumeImage ? "每条招呼语成功后还会发送设置页保存的简历图片。" : "当前未开启自动附带简历图片。";
    if (!window.confirm(`本轮锁定求职方向：${sourcePlan.label}\n话术方式：${modeLabel(runModeInput.value)}（本轮不变）\n最多成功投递：${limit} 条。\n\n原列表保持不动；后台临时标签页发送。主列表标签页被隐藏时暂停读取，返回后继续。\n\n${resumeNote}\n\n${pacingLabel(state.settings)}；读取不一致和单岗位失败会记录并跳过，只有安全验证、登录失效或无法保存运行状态等全局问题才停止。\n\n确认开始吗？`)) return;
    const response = await sendRuntimeMessage({ type: "START_AUTOMATION", runLimit: limit, sourceUrl: location.href, sourcePlan, ...greetingControls.draft() });
    if (!response?.ok) return setNotice(response?.error || "启动失败", "error");
    state.automation = response.publicSession;
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
    state.analysis = analyzeJob(state.job,state.settings);
    state.modelResult = { decision: "recommend", greeting: pending.message, reason: "正在执行临时投递任务" };
    state.round = pending.round;
    render();
    if (workerRole === "chat" || (/\/web\/geek\/(?:chat|message|im)(?:\/|$)/u.test(location.pathname) && ["opening_chat", "continuing_chat", "preparing_text"].includes(pending.stage))) return deliver(pending);

    const detailTimeout = deliveryTimeoutMs(pending, "detailLoadTimeoutSeconds", 30000);
    let button = null;
    const resumingTransition = ["opening_chat", "continuing_chat"].includes(pending.stage) && pending.communicationActions?.length;
    if (!resumingTransition) {
      await updateDeliveryStage(pending, "opening_job");
      const detailDeadline = Date.now() + detailTimeout;
      while (Date.now() < detailDeadline) {
        const blocker = blockerText();
        if (blocker) throw new Error(`临时岗位页出现安全验证或限制：${blocker.slice(0, 120)}`);
        const latest = await getPendingForCurrentPage();
        if (!latest?.pending || latest.pending.id !== pending.id || latest.delegated) return true;
        button = communicationButton(findDetailRoot());
        if (button && controlEnabled(button) && destinationMatches(pending)) break;
        await sleep(300);
      }
      if (!destinationMatches(pending)) throw new Error(`临时标签页等待 ${Math.round(detailTimeout / 1000)} 秒后仍无法核对待投岗位；已跳过当前岗位，整轮继续`);
      if (!button || !controlEnabled(button)) throw new Error("临时岗位页没有找到已就绪且与待投岗位一致的立即沟通/继续沟通按钮");
      await updateDeliveryStage(pending, "opening_chat");
      await clickCommunication(pending, button);
    } else {
      await logEvent('沟通中间页','resumed','页面切换后恢复同一个投递任务，继续处理继续沟通或聊天输入框，不重置为新岗位',pending.job);
    }
    const buttonTextBefore = pending.communicationActions?.[0]?.buttonText || normalizeText(button?.textContent || '');
    const pathBefore = `${location.pathname}${location.search}`.slice(0, 240);
    const chatTimeout = deliveryTimeoutMs(pending, "chatReadyTimeoutSeconds", 60000);
    const chatDeadline = Date.now() + chatTimeout;
    while (Date.now() < chatDeadline) {
      const blocker = blockerText();
      if (blocker) throw new Error(`进入沟通页时出现安全验证或限制：${blocker.slice(0, 120)}`);
      const latest = await getPendingForCurrentPage();
      if (!latest?.pending || latest.pending.id !== pending.id) return true;
      if (latest.delegated) return true;
      Object.assign(pending, latest.pending);
      if (await dismissSubscriptionReplyDialog(pending)) { await sleep(300); continue; }
      if (messageInput()) return deliver(pending);
      await continueCommunication(pending);
      await sleep(300);
    }
    const buttonAfter = communicationButton(findDetailRoot());
    const buttonTextAfter = normalizeText(buttonAfter?.textContent || buttonAfter?.getAttribute?.('aria-label') || '');
    const pathAfter = `${location.pathname}${location.search}`.slice(0, 240);
    const contactStateChanged = !/继续沟通|已沟通/u.test(buttonTextBefore) && /继续沟通|已沟通/u.test(buttonTextAfter);
    if (contactStateChanged) {
      const error = new Error(`点击前按钮“${buttonTextBefore || '未读到'}”，点击后变成“${buttonTextAfter}”，但 ${Math.round(chatTimeout / 1000)} 秒内没有出现聊天输入框。BOSS 可能仍开启自动默认打招呼，或已经直接建立沟通；插件没有再次发送，已将本岗位标记为待人工核对并继续后续岗位；${chatSurfaceDiagnostics()}`);
      error.deliveryUncertain = true;
      throw error;
    }
    throw new Error(`已点击沟通，但 ${Math.round(chatTimeout / 1000)} 秒内没有识别到输入框或任务聊天页；点击前按钮“${buttonTextBefore || '未读到'}”，点击后按钮“${buttonTextAfter || '未读到'}”，页面路径由“${pathBefore}”变为“${pathAfter}”。可能是后台标签页点击未被站点接受、聊天页未通过目标核对，或页面结构已经变化；${chatSurfaceDiagnostics()}；当前岗位已记录，整轮继续`);
  }

  $("#refresh").addEventListener("click", () => refreshJob(true));
  $('#read-logs').addEventListener('click', () => readDiagnostics().catch(error=>setNotice(error.message,'error')));
  $('#diagnostics').addEventListener('toggle', () => { if ($('#diagnostics').open) readDiagnostics().catch(error=>setNotice(error.message,'error')); });
  $('#export-logs').addEventListener('click', async () => {
    await readDiagnostics();
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
  runModeInput.addEventListener("change",()=>{state.modelResult=null;render();});
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
  new MutationObserver(() => {
    if (state.engineBusy) return;
    if(isChatPage()){host.hidden=true;return;}
    host.hidden=false;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refreshJob(false), 500);
  }).observe(document.body, { subtree: true, childList: true, characterData: true });

  await loadState();
  const pending = await getPendingForCurrentPage(/\/job_detail\/|\/web\/geek\/(?:chat|message|im)(?:\/|$)/u.test(location.pathname) ? 15000 : 0);
  if (pending?.pending && pending.isWorker) {
    if (pending.delegated) return;
    try {
      await runDeliveryWorker(pending.pending, pending.workerRole);
    } catch (error) {
      const latest = await getPendingForCurrentPage();
      const delegatedToChat = latest?.pending?.id === pending.pending.id
        && latest.delegated;
      if (delegatedToChat) return;
      const reason = `临时投递页执行失败：${error.message}`;
      if (pending.pending.mode === "auto") {
        await sendRuntimeMessage({ type: "FAIL_PENDING_DELIVERY", deliveryId: pending.pending.id, reason, uncertain: Boolean(error.deliveryUncertain) });
      } else await sendRuntimeMessage({ type: "CLEAR_PENDING_DELIVERY" });
    }
    return;
  }
  if (!pending?.pending && isChatPage()) { host.remove(); return; }
  if (pending?.pending && pending.pending.mode === "manual" && isChatPage()) {
    state.job = pending.pending.job;
    state.analysis = analyzeJob(state.job,state.settings);
    state.modelResult = { decision: "recommend", greeting: pending.pending.message, reason: "已恢复待发送任务" };
    state.round = pending.pending.round;
    render();
    try { await deliver(pending.pending); }
    catch (error) { pending.pending.mode === "auto" ? await stopRun(error.message, true) : setNotice(error.message, "error"); }
  } else {
    const runResponse = await sendRuntimeMessage({ type: "GET_AUTOMATION" });
    if (runResponse?.session?.status === "running" && /\/web\/geek\/jobs/u.test(location.pathname)) {
      try {
        await restoreSourcePlan(runResponse.session);
        await refreshJob(true);
        runLoop();
      } catch (error) {
        await stopRun(error.message, true);
      }
    } else if (pending?.pending && isChatPage()) {
      setNotice("当前聊天页不是这次临时投递任务打开的目标页，已保持不发送。", "error");
    } else {
      await refreshJob(true);
    }
  }
})();
