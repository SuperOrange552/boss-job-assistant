const response = await chrome.runtime.sendMessage({ type: "GET_STATE" });
if (response?.ok) {
  document.getElementById("today-count").textContent = response.dailyStats.successfulContacts;
  document.getElementById("history-count").textContent = Object.keys(response.histories).length;
  const remaining = response.cooldownUntil - Date.now();
  document.getElementById("cooldown").textContent = remaining > 0
    ? `正在休息，还剩 ${Math.ceil(remaining / 1000)} 秒`
    : "当前可以处理岗位";
  const automation = response.automationSession;
  document.getElementById("automation").textContent = automation?.status === "running"
    ? `自动投放运行中：${automation.successCount || 0}/${automation.runLimit || 0}`
    : `自动投放：${automation?.statusLabel || "未开始"}`;
} else {
  document.getElementById("cooldown").textContent = response?.error || "状态读取失败";
  document.getElementById("automation").textContent = "自动投放状态读取失败";
}

document.getElementById("open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());
