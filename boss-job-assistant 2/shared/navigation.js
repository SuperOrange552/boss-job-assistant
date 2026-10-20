// 纯状态判断，不读取浏览器，不建立调试连接，也不修改网站历史/检测逻辑。
export function sourceDocumentKey(sender = {}, token = '') {
  if (sender.documentId) return `chrome:${String(sender.documentId).slice(0,128)}`;
  return token ? `content:${String(token).slice(0,128)}` : '';
}

export function sourcePageAction(session, sender = {}, event = 'ready', token = '', runId = '') {
  if (!session || session.status !== 'running') return 'ignore';
  if (!Number.isInteger(session.sourceTabId) || sender.tab?.id !== session.sourceTabId) return 'ignore';
  if (sender.frameId != null && sender.frameId !== 0) return 'ignore';
  if (runId && runId !== session.id) return 'ignore';
  const key = sourceDocumentKey(sender, token);
  const sameDocument = Boolean(session.sourceDocumentKey && key === session.sourceDocumentKey);
  // 旧文档延迟到达的 pagehide 不得停止用户后来手动开始的新运行。
  if (event === 'left') return sameDocument ? 'pause' : 'ignore';
  if (event === 'ready') return sameDocument ? 'stay' : 'pause';
  if (event === 'restored') return 'pause';
  return 'ignore';
}
