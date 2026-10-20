(async()=>{
  if(window.__BOSS_GENERAL_ACTIVATION__)return;
  window.__BOSS_GENERAL_ACTIVATION__=true;
  const {chatCards,chatSnapshot,chatEditor,writeChatInput,chatInputText,sentTextVisible,chatBlocker}=await import(chrome.runtime.getURL('shared/chat-dom.js'));
  const {activationEligibility,ACTIVATION_GROUPS}=await import(chrome.runtime.getURL('shared/activation.js'));
  const {pacingLabel}=await import(chrome.runtime.getURL('shared/config.js'));
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  let host,shadow,cfg,rows=[],stop=false,busy=false,session=null,histories={},aiConfirmed=false,confirming=false,mounting=false;
  const send=async message=>{const r=await chrome.runtime.sendMessage(message);if(!r?.ok)throw new Error(r?.error||'扩展请求失败');return r;};
  const $=selector=>shadow.querySelector(selector);
  const status=message=>{$('#act-status').textContent=message;};
  const log=message=>{const line=document.createElement('div');line.textContent=new Date().toLocaleTimeString()+' '+message;$('#act-log').prepend(line);};
  const isChat=()=>/\/web\/geek\/(chat|message|im)(?:\/|$)/u.test(location.pathname);
  async function askConfirmation(message){
    if(confirming)return false;
    confirming=true;
    const dialog=document.createElement('dialog');
    dialog.setAttribute('aria-label','批量激活确认');
    dialog.style.cssText='max-width:560px;border:1px solid #b9dcd8;border-radius:14px;padding:24px;font:14px/1.7 -apple-system,sans-serif;color:#193b3b';
    const text=document.createElement('p'),cancel=document.createElement('button'),accept=document.createElement('button');
    text.style.whiteSpace='pre-wrap';text.textContent=message;
    cancel.textContent='取消';accept.textContent='确认继续';accept.className='primary';
    dialog.append(text,cancel,accept);shadow.append(dialog);
    return new Promise(resolve=>{
      let settled=false;
      const finish=value=>{if(settled)return;settled=true;dialog.close();dialog.remove();confirming=false;resolve(value);};
      cancel.addEventListener('click',()=>finish(false));accept.addEventListener('click',()=>finish(true));
      dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false);});
      dialog.showModal();cancel.focus();
    });
  }
  async function guard(){
    if(stop||!isChat())throw new Error('已停止或离开消息页');
    while(document.visibilityState==='hidden'){if(stop)throw new Error('用户停止');await sleep(300);}
    const blocker=chatBlocker();if(blocker)throw new Error('页面出现限制：'+blocker);
  }
  function settingsFromPanel(){
    return {...cfg,activationReadFilter:$('#act-read').value,activationReplyFilter:$('#act-reply').value,activationSentFilter:$('#act-sent').value,
      activationMode:$('#act-mode').value,activationTemplate:$('#act-text').value,activationRunLimit:Number($('#act-limit').value),
      activationUseCategories:$('#act-groups').checked,
      activationTemplates:Object.fromEntries(Object.keys(ACTIVATION_GROUPS).map(k=>[k,$('#act-text-'+k).value]))};
  }
  function renderRows(){
    const body=$('#act-rows');body.replaceChildren();
    for(const row of rows){
      row.check=activationEligibility(row.facts,settingsFromPanel(),histories[row.key]);
      const label=document.createElement('label'),checkbox=document.createElement('input'),span=document.createElement('span');
      checkbox.type='checkbox';checkbox.checked=row.check.eligible&&row.selected!==false;checkbox.disabled=!row.check.eligible;
      checkbox.addEventListener('change',()=>row.selected=checkbox.checked);
      row.selected=checkbox.checked;
      const f=row.facts;span.textContent=row.name+' · '+row.company+'\n'+(f.ourSent===null?'我方发送未知':f.ourSent?'我方已发':'我方未发')+' / '+({read:'对方已读',unread:'对方未读',unknown:'阅读未知'}[f.readState])+' / '+(f.theirReplied===null?'回复未知':f.theirReplied?'对方回复过':'未发现回复')+'\n'+row.check.reason;
      label.append(checkbox,span);body.append(label);
    }
  }
  async function openCard(card){
    await guard();
    const matches=chatCards().filter(c=>c.key===card.key&&c.name===card.name&&c.company===card.company);
    if(matches.length!==1)throw new Error('联系人不能唯一定位：'+card.name);
    const current=chatSnapshot(card);
    if(!current.identityVerified){matches[0].element.scrollIntoView({block:'nearest'});matches[0].element.click();}
    let previous='',stable=0;
    for(let i=0;i<40;i++){
      await guard();const facts=chatSnapshot(card);
      if(facts.identityVerified&&facts.signature===previous)stable++;else stable=0;
      previous=facts.signature;
      if(stable>=2)return facts;
      await sleep(250);
    }
    throw new Error('消息头部姓名/公司未对应或内容未稳定：'+card.name);
  }
  function lock(value){
    busy=value;
    for(const el of shadow.querySelectorAll('input,select,textarea,button'))el.disabled=value&&el.id!=='act-stop';
    $('#act-stop').disabled=!value;
    if(!value)renderRows();
  }
  async function scan(){
    if(busy)return;
    if(!await askConfirmation('扫描会逐个打开当前列表已加载的会话，可能改变你自己的未读状态，但不会发送消息。最多读取100个联系人，继续吗？'))return;
    stop=false;rows=[];lock(true);
    try{
      const cards=chatCards();
      if(!cards.length)throw new Error('未识别到包含姓名和公司的联系人列表；请保留当前页面并反馈结构，不会盲点');
      const counts=new Map();for(const c of cards)counts.set(c.key,(counts.get(c.key)||0)+1);
      for(const card of cards.slice(0,100)){
        await guard();if(counts.get(card.key)!==1){log('身份重复，跳过 '+card.name);continue;}
        status('读取 '+card.name+'（不发送）');
        try {const facts=await openCard(card);rows.push({...card,facts,selected:true});}
        catch(error){if(stop)throw error;log(error.message);rows.push({...card,facts:{...card,identityVerified:false,ourSent:null,theirReplied:null,readState:'unknown'},selected:false});}
        renderRows();await sleep(300);
      }
      status('扫描完成：'+rows.length+'个。请核对状态、文案和勾选名单；只处理本次已加载的联系人，不自动拉取全部历史。');
    }catch(error){status(error.message);log(error.message);}finally{lock(false);}
  }
  async function generate(){
    if(busy)return;lock(true);
    try{
      status('正在生成统一激活话术；不读取或上传聊天正文…');
      const r=await send({type:'ACTIVATION_GENERATE',useCategories:$('#act-groups').checked});
      if(r.texts.common)$('#act-text').value=r.texts.common;
      for(const k of Object.keys(ACTIVATION_GROUPS))if(r.texts[k])$('#act-text-'+k).value=r.texts[k];
      aiConfirmed=true;status('已生成，请检查或修改。确认开始后本批文字固定，不再调用AI。');
    }catch(error){status(error.message);}finally{lock(false);}
  }
  async function run(){
    if(busy)return;
    const config=settingsFromPanel(),selected=rows.filter(r=>r.selected&&r.check.eligible);
    if(!selected.length)return status('请先扫描并勾选符合条件的联系人');
    if(config.activationMode==='ai'&&!aiConfirmed)return status('请先点击“AI生成统一文案”，检查后再开始');
    if(!Number.isInteger(config.activationRunLimit)||config.activationRunLimit<1||config.activationRunLimit>100)return status('单轮上限必须为1至100');
    const preview=config.activationUseCategories?Object.entries(ACTIVATION_GROUPS).map(([k,name])=>name+'：'+config.activationTemplates[k]).join('\n'):config.activationTemplate;
    if(!await askConfirmation('将向勾选的 '+selected.length+' 个联系人发送激活文字，最多成功 '+config.activationRunLimit+' 条。\n'+pacingLabel(config)+'\n不会发送图片或重新投简历。\n\n'+preview+'\n\n确认开始？'))return;
    stop=false;lock(true);
    try{
      session=(await send({type:'ACTIVATION_START',confirmed:true,config,candidates:selected.map(r=>r.facts)})).session;
      for(const row of selected){
        await guard();
        let facts=await openCard(row);
        const check=activationEligibility(facts,config,histories[row.key]);
        if(!check.eligible){log(row.name+' 跳过：'+check.reason);continue;}
        const editor=chatEditor();if(!editor)throw new Error('没有唯一的输入框/发送按钮，未发送');
        if(chatInputText(editor.input))throw new Error('聊天输入框已有草稿，保留原文并停止');
        let reservation;
        do{
          await guard();reservation=await send({type:'ACTIVATION_RESERVE',sessionId:session.id,facts});
          if(reservation.waitingUntil){status('按设置休息中…');await sleep(Math.min(1000,Math.max(50,reservation.waitingUntil-Date.now())));}
        }while(reservation.waitingUntil);
        if(reservation.blocked){log(row.name+' 跳过：'+reservation.reason);continue;}
        let confirmed=false;
        try{
          await guard();
          const fresh=chatSnapshot(row);
          if(!fresh.identityVerified||fresh.signature!==facts.signature)throw new Error('会话在发送前发生变化，停止以免错发');
          writeChatInput(editor.input,reservation.text);
          await sleep(180);await guard();
          if(chatInputText(editor.input)!==reservation.text.replace(/\s+/gu,' ').trim())throw new Error('输入内容未完整写入');
          if(!chatSnapshot(row).identityVerified)throw new Error('会话在输入后切换，停止');
          const freshEditor=chatEditor();
          if(!freshEditor||freshEditor.input!==editor.input||freshEditor.send.disabled)throw new Error('发送控件不可用');
          freshEditor.send.addEventListener('click',e=>{if(/^javascript:/iu.test(freshEditor.send.getAttribute('href')||''))e.preventDefault();},{capture:true,once:true});
          freshEditor.send.click();
          for(let i=0;i<24;i++){
            await sleep(250);
            if(!chatSnapshot(row).identityVerified)break;
            if(!chatInputText(editor.input)&&sentTextVisible(reservation.text)&&chatSnapshot(row).outgoingCount>facts.outgoingCount){confirmed=true;break;}
          }
        }finally{
          const result=await send({type:'ACTIVATION_RECORD',sessionId:session.id,key:row.key,confirmedSent:confirmed});
          session=result.session;
          histories[row.key]={status:confirmed?'sent':'uncertain',at:new Date().toISOString()};
        }
        if(!confirmed)throw new Error('没有取得新文字的发送证据，停止且禁止自动重发，请人工核实');
        log(row.name+' · 已确认发送');status('成功 '+session.successCount+'/'+config.activationRunLimit);
        if(session.status!=='running')break;
      }
      if(session.status==='running')await send({type:'ACTIVATION_STOP',reason:'本次勾选名单已处理完'});
      status('本轮结束。已确认成功 '+session.successCount+' 条；不会自动启动下一轮。');
    }catch(error){
      status(error.message);log(error.message);
      await send({type:'ACTIVATION_STOP',reason:error.message}).catch(()=>{});
    }finally{lock(false);}
  }
  async function mount(){
    if(host||mounting||!isChat())return;
    mounting=true;
    try{
    const pending=await chrome.runtime.sendMessage({type:'GET_PENDING_DELIVERY'});
    if(pending?.pending)return;
    const setup=await send({type:'ACTIVATION_SETUP'});cfg=setup.settings;histories=setup.histories;
    host=document.createElement('div');host.id='boss-general-activation-host';shadow=host.attachShadow({mode:'open'});document.documentElement.append(host);
    shadow.innerHTML=`<style>:host{all:initial}.panel{position:fixed;right:16px;bottom:16px;width:420px;max-height:85vh;overflow:auto;z-index:2147483646;background:white;color:#193b3b;border:1px solid #b9dcd8;border-radius:14px;box-shadow:0 10px 35px #1234;font:13px/1.6 -apple-system,sans-serif}header{background:#009f97;color:white;padding:12px 16px;font-size:17px;font-weight:700}.body{padding:14px}.community{padding:8px 9px;border:1px solid #5ccbc5;border-radius:8px;background:#e9fbf9;color:#006f6b;font-size:12px;font-weight:650}label{display:block;margin:8px 0}input,textarea,select{font:inherit;padding:7px;box-sizing:border-box}textarea,select{width:100%}button{padding:9px;border:0;border-radius:7px;background:#e5f5f2;color:#006a63;margin:4px;cursor:pointer}button:disabled{opacity:.45}.primary{background:#009f97;color:white}#act-rows{max-height:260px;overflow:auto}#act-rows label{display:flex;gap:8px;white-space:pre-wrap;border-bottom:1px solid #ddd;padding:8px}#act-status{background:#f0f8f6;padding:9px;white-space:pre-wrap}#act-log{max-height:160px;overflow:auto;font-size:12px}p{margin:7px 0;color:#627977}[hidden]{display:none!important}</style>
      <style>.panel{width:min(420px,calc(100vw - 32px))}header{position:sticky;top:0;z-index:1}</style>
      <section class="panel"><header>消息 · 批量激活 <button id="act-collapse">收起</button></header><div class="body"><p class="community">如果遇到使用上的问题或有优化建议，在抖音找：<strong>superorange7</strong>。欢迎大家提出建议，授权大家做二次开发和传播。</p><p>独立于岗位投递。扫描不发送；只读取当前已加载记录。阅读状态未知不猜测。</p>
      <label>对方阅读<select id="act-read"><option value="all">已读、未读均可</option><option value="read">只选已读</option><option value="unread">只选未读</option></select></label>
      <label>对方回复<select id="act-reply"><option value="all">不限</option><option value="replied">可见记录中回复过</option><option value="unreplied">未发现回复</option></select></label>
      <label>我方发送<select id="act-sent"><option value="sent">发过消息</option><option value="unsent">可确认未发过</option><option value="all">不限</option></select></label>
      <label>文案来源<select id="act-mode"><option value="template">自定义模板</option><option value="ai">AI生成统一文案</option></select></label>
      <label><input id="act-groups" type="checkbox">按沟通状态分组使用文案</label>
      <textarea id="act-text" rows="3"></textarea><div id="act-category-texts">${Object.entries(ACTIVATION_GROUPS).map(([k,v])=>'<label>'+v+'<textarea rows="2" id="act-text-'+k+'"></textarea></label>').join('')}</div>
      <button id="act-generate">AI生成统一文案</button><label>最多成功条数 <input id="act-limit" type="number" min="1" max="100"></label>
      <button id="act-scan">扫描与预览（不发送）</button><button id="act-start" class="primary">确认名单并开始激活</button><button id="act-stop" disabled>停止</button><div id="act-status">尚未扫描</div><div id="act-rows"></div><details><summary>本页日志</summary><div id="act-log"></div></details></div></section>`;
    $('#act-read').value=cfg.activationReadFilter;$('#act-reply').value=cfg.activationReplyFilter;$('#act-sent').value=cfg.activationSentFilter;
    $('#act-mode').value=cfg.activationMode;$('#act-text').value=cfg.activationTemplate;$('#act-limit').value=cfg.activationRunLimit;$('#act-groups').checked=cfg.activationUseCategories;
    for(const k of Object.keys(ACTIVATION_GROUPS))$('#act-text-'+k).value=cfg.activationTemplates[k];
    const update=()=>{$('#act-category-texts').hidden=!$('#act-groups').checked;$('#act-text').hidden=$('#act-groups').checked;renderRows();};
    for(const id of ['act-read','act-reply','act-sent','act-groups'])$('#'+id).addEventListener('change',update);
    $('#act-mode').addEventListener('change',()=>{aiConfirmed=false;});
    $('#act-scan').addEventListener('click',scan);$('#act-start').addEventListener('click',run);$('#act-generate').addEventListener('click',generate);
    $('#act-stop').addEventListener('click',async()=>{
      stop=true;
      if(!busy){await send({type:'ACTIVATION_STOP',reason:'用户结束旧任务'});$('#act-stop').disabled=true;status('旧任务已停止，可重新扫描；待核实的发送记录仍保留防重');return;}
      status('正在停止；若刚点击发送，先核实这条的结果再结束');
    });
    $('#act-collapse').addEventListener('click',()=>{$('.body').hidden=!$('.body').hidden;$('#act-collapse').textContent=$('.body').hidden?'展开':'收起';});
    if(setup.session?.status==='running'){$('#act-stop').disabled=false;status('有尚未结束的激活任务。刷新不会自动续发，请点击停止并核实记录。');}
    update();
    }finally{mounting=false;}
  }
  await mount().catch(error=>console.warn('通用版批量激活：'+error.message));
  setInterval(()=>{if(isChat())mount().catch(()=>{});else if(host&&!busy){host.remove();host=null;rows=[];}},1500);
})();
