import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const content=await readFile(new URL('../content.js',import.meta.url),'utf8');
const options=await readFile(new URL('../options.html',import.meta.url),'utf8');
const settings=await readFile(new URL('../settings.js',import.meta.url),'utf8');

test('订阅弹层支持任意词序和二维码线索，并且只关闭弹层继续当前岗位',()=>{
  const messageInput=content.slice(content.indexOf('  function messageInput()'),content.indexOf('  function isChatPage()'));
  const popupHandler=content.slice(content.indexOf('  function subscriptionPopupReason('),content.indexOf('  function deliveryTimeoutMs'));
  assert.doesNotMatch(messageInput,/简短描述|订阅回复消息/u);
  const pureMatcher=content.slice(content.indexOf('  function subscriptionPopupReason('),content.indexOf('  function subscriptionReplyDialog()'));
  const context={normalizeText:(value)=>String(value||'').trim()};
  vm.runInNewContext(`${pureMatcher}\nthis.match=subscriptionPopupReason;`,context);
  assert.ok(context.match('订阅回复消息'));
  assert.ok(context.match('已开启消息订阅'));
  assert.ok(context.match('使用微信扫码订阅'));
  assert.ok(context.match('', ['class=qrcode']));
  assert.equal(context.match('安全验证：请扫描二维码'), '');
  assert.equal(context.match('普通岗位描述，没有弹窗'),'');
  assert.match(popupHandler,/subscriptionDialogCloseButton\(element\)/u);
  assert.match(popupHandler,/safeElementClick\(close\)/u);
  assert.match(popupHandler,/closed_and_continued/u);
  assert.match(popupHandler,/继续等待真实聊天输入框/u);
  assert.doesNotMatch(popupHandler,/throw error|当前岗位跳过|closed_and_skipped/u);
});

test('只有点击沟通后才会检查订阅弹层，职位识别和发送后阶段均不关闭',()=>{
  for(const functionName of ['waitForSendControl','waitForSendEvidence','waitForResumeFileInput','sendResumeImage','deliver']){
    const start=content.indexOf(`  async function ${functionName}`);
    assert.notEqual(start,-1,functionName);
    const next=content.indexOf('\n  async function ',start+20);
    const body=content.slice(start,next<0?content.length:next);
    assert.doesNotMatch(body,/dismissSubscriptionReplyDialog\(pending\)/u,functionName);
  }
  const waitInput=content.slice(content.indexOf('  async function waitForInput('),content.indexOf('  function setInput('));
  assert.match(waitInput,/dismissSubscriptionReplyDialog\(pending\)/u);
  const worker=content.slice(content.indexOf('  async function runDeliveryWorker('),content.indexOf('  $("#refresh")'));
  const click=worker.indexOf('await clickCommunication(pending, button)');
  assert.ok(click>0);
  assert.doesNotMatch(worker.slice(0,click),/dismissSubscriptionReplyDialog\(pending\)/u);
  assert.match(worker.slice(click),/dismissSubscriptionReplyDialog\(pending\)/u);
  const manual=content.slice(content.indexOf('  async function openDelivery('),content.indexOf('  async function selectAndWait('));
  assert.ok(manual.indexOf('await clickCommunication(response.pending, button)') < manual.indexOf('waitForInput(response.pending)'));
  assert.match(content,/FAIL_PENDING_DELIVERY/u);
});

test('Windows慢加载等待可以在设置页配置并锁入单次投递快照',async()=>{
  for(const id of ['detail-load-timeout','chat-ready-timeout','send-evidence-timeout','resume-send-timeout']) assert.match(options,new RegExp(`id="${id}"`),id);
  for(const key of ['detailLoadTimeoutSeconds','chatReadyTimeoutSeconds','sendEvidenceTimeoutSeconds','resumeSendTimeoutSeconds']) assert.match(settings,new RegExp(`${key}:`),key);
  const background=await readFile(new URL('../background.js',import.meta.url),'utf8');
  assert.match(background,/timings:\s*\{/u);
  assert.match(background,/chatReadyTimeoutSeconds: config\.chatReadyTimeoutSeconds/u);
});

test('图片失败不会再停止整轮，文字已发时只做防重并继续',()=>{
  const deliver=content.slice(content.indexOf('  async function deliver(pending)'),content.indexOf('  async function waitForWorkerOutcome'));
  assert.match(deliver,/recordDeliveredText\(pending, "failed"/u);
  assert.doesNotMatch(deliver,/STOP_AUTOMATION/u);
  assert.match(deliver,/整轮继续/u);
  assert.doesNotMatch(content,/简历图片未确认成功；本轮已停止/u);
});

test('单岗位未发送原因会显示在对应卡片下方',()=>{
  const marker=content.slice(content.indexOf('  function applyContactMarkers()'),content.indexOf('  function extractDescription'));
  assert.match(marker,/data-bja-run-marker/u);
  assert.match(marker,/助手：本轮未发送/u);
  assert.match(marker,/runResult\.reason/u);
});
