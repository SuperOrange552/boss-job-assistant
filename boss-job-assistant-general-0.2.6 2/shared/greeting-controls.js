import {renderGreetingTemplate} from './core.js';

// 同一套前台控件用于真实岗位面板和纯本地预览，接口只读写话术方式/模板。
export function createGreetingControls(container,{send,onChange=()=>{},onNotice=()=>{}}){
  container.innerHTML=`<style>
    .greeting-settings{margin:10px 0;padding:10px;border:1px solid #cde4df;border-radius:10px;background:#fff}
    .greeting-settings label{display:block;margin:7px 0;color:#264844}.greeting-settings select,.greeting-settings textarea{display:block;width:100%;box-sizing:border-box;font:inherit;border:1px solid #c4d7d3;border-radius:7px;padding:8px;color:#193b35;background:white}
    .greeting-settings small{display:block;line-height:1.6;color:#5d7872;font-size:12px;margin:6px 0}.greeting-settings button{font:inherit;border:1px solid #00a08e;border-radius:7px;padding:6px 9px;color:#007d6f;background:#eefaf7;cursor:pointer}
    .greeting-settings [hidden]{display:none!important}.greeting-settings .template-example{white-space:pre-wrap;background:#f1f8f6;padding:8px;border-radius:6px;margin-top:6px}.greeting-settings :disabled{opacity:.6}
  </style><section class="greeting-settings"><strong>打招呼内容</strong>
  <small>指主动发给当前岗位招聘者的开场消息，不是自动回复聊天。</small>
  <label>本轮话术方式<select id="run-mode"><option value="template">自定义模板（不调用AI）</option><option value="ai">AI按岗位生成</option></select></label>
  <div id="front-template-block"><label>自定义打招呼模板<textarea id="front-template" rows="4" placeholder="直接粘贴自己的文字，也可使用 {称呼}、{岗位} 等变量"></textarea></label>
  <small>支持 {称呼}、{招聘者}、{公司}、{岗位}、{城市}、{沟通次数}。固定文字也可。只替换变量，不改写原文。</small>
  <strong>当前岗位替换预览（不会发送）</strong><div class="template-example" id="front-template-preview"></div></div>
  <small id="front-ai-note" hidden>AI按当前岗位生成开场消息；个人总结、写作要求、字数上限和接口在后台设置。不会自动回复HR后续消息。</small>
  <button type="button" id="save-front-greeting">保存方式与模板</button><small id="front-greeting-status" role="status">在这里选择方式和编辑模板，开始或生成本条时也会保存。运行中锁定，下一轮可修改。</small></section>`;
  const $=s=>container.querySelector(s),mode=$('#run-mode'),template=$('#front-template');
  let loaded=false,job=null,maxChars=200,locked=false;
  function render(){
    $('#front-template-block').hidden=mode.value!=='template';$('#front-ai-note').hidden=mode.value!=='ai';
    try{
      const text=job?.title?renderGreetingTemplate(template.value,job):'';
      $('#front-template-preview').textContent=text?(text+'\n'+Array.from(text).length+'/'+maxChars+' 字符（含标点）'):'选择岗位后显示替换结果。';
    }catch(error){$('#front-template-preview').textContent=error.message;}
  }
  const draft=()=>({greetingMode:mode.value,greetingTemplate:template.value});
  async function save(){
    if(locked)throw new Error('本轮正在运行，话术已锁定，请停止后再修改');
    const r=await send({type:'SAVE_GREETING_PREFERENCES',...draft()});
    if(!r?.ok)throw new Error(r?.error||'保存话术失败');
    $('#front-greeting-status').textContent='方式与模板已保存；仅保存，不发送消息。';return draft();
  }
  mode.addEventListener('change',()=>{render();onChange();});
  template.addEventListener('input',()=>{render();onChange();});
  $('#save-front-greeting').addEventListener('click',()=>save().catch(error=>{ $('#front-greeting-status').textContent=error.message;onNotice(error.message,'error');}));
  return {mode,template,draft,save,
    async load(){if(loaded)return;const r=await send({type:'GET_GREETING_PREFERENCES'});if(!r?.ok)throw new Error(r?.error||'读取前台话术失败');mode.value=r.preferences.greetingMode;template.value=r.preferences.greetingTemplate;maxChars=r.preferences.greetingMaxChars;loaded=true;render();},
    setJob(value,limit){job=value;if(limit)maxChars=limit;render();},
    lock(value){locked=value;for(const input of container.querySelectorAll('input,select,textarea,button'))input.disabled=value;},
  };
}
