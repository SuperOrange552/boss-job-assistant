import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {DEFAULT_SETTINGS} from '../settings.js';
import {analyzeJob,renderGreetingTemplate,randomRestSeconds,buildModelPayload,parseHrSignals,contactEligibility,conversationalJobTitle} from '../shared/core.js';
import {FILTER_FIELD_DEFINITIONS,KEYWORD_GROUPS,validateSettings,parseKeywords} from '../shared/config.js';
import {activationEligibility,activationText,activationCategory} from '../shared/activation.js';
const role={title:'品牌运营专员',company:'示例品牌',location:'杭州·滨江',recruiterName:'李女士',description:'负责内容策划、社群运营和活动执行，结合数据分析跟进活动效果。',tags:[]};
const filter=f=>({...DEFAULT_SETTINGS,filters:{...DEFAULT_SETTINGS.filters,...f}});

test('空白规则不限行业、城市、岗位，不预置个人总结或Key',()=>{
  assert.equal(DEFAULT_SETTINGS.candidateSummary,'');assert.equal(DEFAULT_SETTINGS.apiKey,'');
  for(const title of ['品牌运营','会计','设备硬件工程师','汽车销售','设计师'])assert.equal(analyzeJob({...role,title,description:'一般工作职责'},DEFAULT_SETTINGS).decision,'recommend');
});
test('标题负面词不会读取职责；公司负面词不会读取标题',()=>{
  assert.equal(analyzeJob({...role,description:'偶尔支持兼职团队'},filter({titleExclude:'兼职'})).decision,'recommend');
  assert.equal(analyzeJob({...role,title:'兼职运营'},filter({titleExclude:'兼职'})).decision,'exclude');
  assert.equal(analyzeJob({...role,title:'示例品牌运营'},filter({companyExclude:'其他'})).decision,'recommend');
  assert.match(analyzeJob(role,filter({companyExclude:'示例'})).reasons.join(''),/公司名称排除词/u);
});
test('职位正文和岗位标签独立筛选，纯字面匹配且不语义推测',()=>{
  assert.equal(analyzeJob({...role,tags:['长期驻外']},filter({descriptionExclude:'长期驻外'})).decision,'recommend');
  assert.equal(analyzeJob({...role,tags:['长期驻外']},filter({tagsExclude:'长期驻外'})).decision,'exclude');
  assert.equal(analyzeJob({...role,description:'无需出差'},filter({descriptionExclude:'出差'})).decision,'exclude');
});
test('包含词任一/全部、字段之间为且，留空不限制',()=>{
  assert.equal(analyzeJob(role,filter({titleInclude:'运营\n会计'})).decision,'recommend');
  assert.equal(analyzeJob(role,filter({titleInclude:'运营\n会计',titleIncludeMode:'all'})).decision,'exclude');
  assert.equal(analyzeJob(role,filter({titleInclude:'运营',descriptionInclude:'财务'})).decision,'exclude');
});
test('旧城市和今日回复设置迁移为可配置字段',()=>{
  const old={cities:['北京'],requireRepliedToday:true};
  assert.equal(analyzeJob({...role,location:'杭州',replyText:''},filter(old)).decision,'exclude');
  const migrated=validateSettings({...DEFAULT_SETTINGS,filters:{...old,titleInclude:'运营',includeMode:'all'}});
  assert.equal('cities' in migrated.filters,false);assert.equal('requireRepliedToday' in migrated.filters,false);
  assert.equal(migrated.filters.locationInclude,'北京');assert.match(migrated.filters.replyInclude,/今日回复/u);
  assert.equal(migrated.filters.titleIncludeMode,'all');assert.equal(migrated.filters.descriptionIncludeMode,'all');
});
test('所有已说明的分隔符等价，可混用，空格保留且重复词不计数',()=>{
  for(const separator of ['\n','\r\n',',','，',';','；'])assert.deepEqual(parseKeywords('运营'+separator+'策划'),['运营','策划']);
  assert.deepEqual(parseKeywords('运营,策划；活动\n运营;SQL，sql'),['运营','策划','活动','sql']);
  assert.deepEqual(parseKeywords('User Research,品牌 运营'),['User Research','品牌 运营']);
});
test('每个包含/排除组独立阈值，两个负面词才触发，不要求全部',()=>{
  const s=filter({titleInclude:'运营,财务',titleIncludeMode:'any',descriptionExclude:'驻外,夜班,外派',descriptionExcludeMode:'count',descriptionExcludeCount:2});
  const a=analyzeJob({...role,description:'需要驻外，驻外，驻外'},s);assert.equal(a.decision,'recommend');assert.match(a.reasons.join(''),/实际命中 1\/3/u);
  const b=analyzeJob({...role,description:'需要驻外和夜班'},s);assert.equal(b.decision,'exclude');assert.match(b.reasons.join(''),/至少命中2个不同词/u);
  assert.equal(analyzeJob({...role,title:'实习运营'},filter({titleExclude:'实习,兼职',titleExcludeMode:'all'})).decision,'recommend');
  assert.equal(analyzeJob({...role,title:'实习兼职运营'},filter({titleExclude:'实习,兼职',titleExcludeMode:'all'})).decision,'exclude');
  assert.equal(analyzeJob(role,filter({descriptionInclude:'策划,运营,财务',descriptionIncludeMode:'count',descriptionIncludeCount:2})).decision,'recommend');
  assert.equal(analyzeJob({...role,description:''},filter({titleInclude:'运营',descriptionInclude:'',descriptionExclude:''})).decision,'recommend');
});
test('命中N不可超过不同词数，空白组不强制填写词',()=>{
  assert.throws(()=>validateSettings(filter({titleExclude:'外派,外派',titleExcludeMode:'count',titleExcludeCount:2})),/超过/u);
  assert.doesNotThrow(()=>validateSettings(filter({descriptionInclude:'',descriptionIncludeMode:'count',descriptionIncludeCount:2})));
});
test('公司名称按任意片段屏蔽，包括中文单字和英文词片段',()=>{
  assert.equal(analyzeJob({...role,company:'AcmeGroup'},filter({companyExclude:'ME'})).decision,'exclude');
  assert.equal(analyzeJob({...role,company:'甲乙科技'},filter({companyExclude:'甲'})).decision,'exclude');
});
test('八类页面字段都可以独立设置包含和排除规则',()=>{
  const job={...role,tags:['行政管理'],recruiterName:'李女士',activityText:'刚刚活跃',replyText:'今日回复'};
  const positive={titleInclude:'品牌',descriptionInclude:'社群',tagsInclude:'行政',companyInclude:'示例',locationInclude:'杭州',recruiterInclude:'李',activityInclude:'刚刚',replyInclude:'今日'};
  assert.equal(analyzeJob(job,filter(positive)).decision,'recommend');
  for(const definition of FILTER_FIELD_DEFINITIONS){
    const key=`${definition.key}Exclude`;
    const term={title:'运营',description:'社群',tags:'行政',company:'示例',location:'杭州',recruiter:'李',activity:'刚刚',reply:'今日'}[definition.key];
    assert.equal(analyzeJob(job,filter({[key]:term})).decision,'exclude',key);
  }
  assert.equal(KEYWORD_GROUPS.length,FILTER_FIELD_DEFINITIONS.length*2);
});
test('三天范围包括在线、当天和一至三天，而不是互斥标签',()=>{
  for(const activityText of ['在线','刚刚活跃','今日活跃','当天活跃','1日内活跃','2天内活跃','3日内活跃','三天内活跃','3天前活跃','2小时前活跃','20分钟前活跃','昨日活跃']){
    assert.equal(analyzeJob({...role,activityText},filter({hrActiveDays:3})).decision,'recommend',activityText);
  }
  for(const activityText of ['4天前活跃','3天以外活跃','7日内活跃','本周活跃','本月活跃','长期未活跃'])assert.equal(analyzeJob({...role,activityText},filter({hrActiveDays:3})).decision,'exclude',activityText);
  assert.equal(analyzeJob({...role,activityText:'本周活跃'},filter({hrActiveDays:7})).decision,'recommend');
  assert.match(analyzeJob({...role,activityText:'本周活跃'},filter({hrActiveDays:3})).reasons.join(''),/无法确认/u);
});
test('未知活跃有独立处理，不把今日回复、在线教育和不在线当作在线',()=>{
  for(const activityText of ['','未在线','不在线','在线教育 · 人事','今日回复','招聘经理'])assert.equal(parseHrSignals(activityText).activeDays,null,activityText);
  const s=filter({hrActiveDays:3,hrUnknownPolicy:'skip'});
  assert.equal(analyzeJob(role,s).decision,'exclude');assert.match(analyzeJob(role,s).reasons.join(''),/未知/u);
  assert.equal(analyzeJob(role,filter({hrActiveDays:3,hrUnknownPolicy:'allow'})).decision,'recommend');
  assert.equal(analyzeJob(role,filter({hrActiveDays:0})).decision,'recommend');
});
test('模板只替换白名单变量，不请求AI、不改写原文',()=>{
  assert.equal(renderGreetingTemplate('{称呼}，想了解{公司}的{岗位}。',role),'李老师您好，想了解示例品牌的品牌运营专员。');
  assert.equal(renderGreetingTemplate('原封不动的统一文案',role),'原封不动的统一文案');
  assert.throws(()=>renderGreetingTemplate('{薪资}',role),/不支持/u);
  assert.throws(()=>renderGreetingTemplate('{公司}',{title:'岗位'}),/没有读到/u);
  assert.throws(()=>renderGreetingTemplate('{{岗位}}',role),/单层/u);
});
test('话术岗位简称去掉地点说明、招聘修饰和福利尾巴，但不改原始岗位身份',()=>{
  assert.equal(conversationalJobTitle('徐汇区漕河泾商圈/诚聘顾问（无需电销）'),'顾问');
  assert.equal(conversationalJobTitle('高提成股票投资顾问＋员工宿舍'),'高提成股票投资顾问');
  assert.equal(conversationalJobTitle('商务代表（上海办事处）'),'商务代表');
  assert.equal(conversationalJobTitle('奢侈品销售'),'奢侈品销售');
  assert.equal(conversationalJobTitle('产品+运营'),'产品+运营');
  assert.equal(renderGreetingTemplate('{称呼}，想了解贵公司的{岗位}岗位。',{...role,title:'徐汇区漕河泾商圈/诚聘顾问（无需电销）'}),'李老师您好，想了解贵公司的顾问岗位。');
  const payload=buildModelPayload({...role,title:'高提成股票投资顾问＋员工宿舍'},analyzeJob(role),DEFAULT_SETTINGS);
  assert.equal(payload.job.jobTitle,'高提成股票投资顾问');
});
test('自定义两组间隔保持不变，非法范围和NaN不能保存',()=>{
  const s=validateSettings({...DEFAULT_SETTINGS,perSendRestMinSeconds:8,perSendRestMaxSeconds:12,restMinSeconds:40,restMaxSeconds:60});
  assert.equal(s.perSendRestMinSeconds,8);
  assert.equal(randomRestSeconds({restMinSeconds:8,restMaxSeconds:12},0),8);
  assert.equal(randomRestSeconds({restMinSeconds:8,restMaxSeconds:12},0.9999),12);
  assert.throws(()=>validateSettings({...DEFAULT_SETTINGS,perSendRestMinSeconds:12,perSendRestMaxSeconds:8}),/最长/u);
  assert.throws(()=>validateSettings({...DEFAULT_SETTINGS,batchSize:NaN}),/整数/u);
});
test('同岗位沟通次数和后续间隔不再写死为三次',()=>{
  const base=Date.parse('2026-09-18T01:00:00Z');
  const attempts=[0,1,2].map((offset)=>({status:'sent',sentAt:new Date(base+offset*86400000).toISOString()}));
  const settings={...DEFAULT_SETTINGS,maxContactsPerJob:5,laterContactMinHours:0,laterContactsRequireNextDay:false};
  assert.equal(contactEligibility(attempts,settings,base+2*86400000+1000).eligible,true);
  assert.equal(contactEligibility(attempts,settings,base+2*86400000+1000).round,4);
  assert.equal(contactEligibility([...attempts,{status:'sent',sentAt:new Date(base+3*86400000).toISOString()},{status:'sent',sentAt:new Date(base+4*86400000).toISOString()}],settings,base+5*86400000).eligible,false);
});
test('AI输入使用当前用户简介，不包含预置技能或工作年限',()=>{
  const payload=buildModelPayload(role,analyzeJob(role),{...DEFAULT_SETTINGS,candidateSummary:'我做过社区活动运营'});
  assert.equal(payload.candidateSummary,'我做过社区活动运营');
  assert.equal('matchedProfilePoints' in payload.localAnalysis,false);
});
const facts={key:'chat-a',name:'李女士',company:'示例品牌',identityVerified:true,ourSent:true,theirReplied:false,readState:'read',refused:false};
test('阅读、对方回复、我方发送三个条件分别筛选',()=>{
  assert.equal(activationEligibility(facts,{...DEFAULT_SETTINGS,activationReadFilter:'read'}).eligible,true);
  assert.equal(activationEligibility(facts,{...DEFAULT_SETTINGS,activationReadFilter:'unread'}).eligible,false);
  assert.equal(activationEligibility({...facts,theirReplied:true},DEFAULT_SETTINGS).eligible,true);
  assert.equal(activationEligibility({...facts,theirReplied:true},{...DEFAULT_SETTINGS,activationReplyFilter:'unreplied'}).eligible,false);
  assert.equal(activationEligibility({...facts,ourSent:false},{...DEFAULT_SETTINGS,activationSentFilter:'unsent'}).eligible,true);
});
test('未读不是未发送；分组优先区分未发过与有回复',()=>{
  assert.equal(activationCategory({...facts,readState:'unread'}),'unread');
  assert.equal(activationCategory({...facts,theirReplied:true,readState:'unread'}),'replied');
  assert.equal(activationCategory({...facts,ourSent:false,theirReplied:true}),'never_sent');
});
test('拒绝、未知身份/消息状态、待核实意图、冷却期均不发送',()=>{
  for(const f of [{...facts,refused:true},{...facts,identityVerified:false},{...facts,ourSent:null}])assert.equal(activationEligibility(f,DEFAULT_SETTINGS).eligible,false);
  for(const status of ['reserved','uncertain'])assert.equal(activationEligibility(facts,DEFAULT_SETTINGS,{status}).eligible,false);
  assert.equal(activationEligibility(facts,DEFAULT_SETTINGS,{status:'sent',at:new Date().toISOString()}).eligible,false);
});
test('激活统一文案不插值或逐人改写，分组文案按已确认状态选择',()=>{
  assert.equal(activationText({...DEFAULT_SETTINGS,activationTemplate:'统一原文'},facts),'统一原文');
  assert.equal(activationText({...DEFAULT_SETTINGS,activationUseCategories:true,activationTemplates:{read:'已读跟进'}},facts),'已读跟进');
});
test('运行时文件不包含原用户项目和定制经验，不自动预置API Key',async()=>{
  const files=['settings.js','shared/core.js','background.js','content.js','options.html','options.js','manifest.json'];
  for(const file of files){
    const source=await readFile(new URL('../'+file,import.meta.url),'utf8');
    assert.doesNotMatch(source,/掌门|特定用户私有经历|POSTPONE_GROUPS|SOFTWARE_TEST_KEYWORDS|isShanghaiLocation/u,file);
  }
  const manifest=JSON.parse(await readFile(new URL('../manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.version,'0.2.6');
  assert.match(manifest.name,/通用/u);
  assert.ok(manifest.content_scripts[0].js.includes('chat-activation.js'));
});
test('四组页面等待时间有安全默认值并进行范围校验',()=>{
  assert.equal(DEFAULT_SETTINGS.detailLoadTimeoutSeconds,30);
  assert.equal(DEFAULT_SETTINGS.chatReadyTimeoutSeconds,60);
  assert.equal(DEFAULT_SETTINGS.sendEvidenceTimeoutSeconds,15);
  assert.equal(DEFAULT_SETTINGS.resumeSendTimeoutSeconds,45);
  assert.doesNotThrow(()=>validateSettings(DEFAULT_SETTINGS));
  assert.throws(()=>validateSettings({...DEFAULT_SETTINGS,chatReadyTimeoutSeconds:9}),/10至300/u);
  assert.throws(()=>validateSettings({...DEFAULT_SETTINGS,resumeSendTimeoutSeconds:181}),/10至180/u);
});
test('设置页、弹窗和两个注入面板都显示联系与二次开发提示',async()=>{
  for(const file of ['options.html','popup.html','content.js','chat-activation.js']){
    const source=await readFile(new URL('../'+file,import.meta.url),'utf8');
    assert.match(source,/superorange7/u,file);
    assert.match(source,/二次开发和传播/u,file);
  }
  const options=await readFile(new URL('../options.html',import.meta.url),'utf8');
  assert.match(options,/关掉自动默认打招呼/u);
  assert.match(options,/不要泄漏你的 API Key/u);
});
test('设置页按统一字段定义生成全部可配置筛选组，前台使用共享组件',async()=>{
  const html=await readFile(new URL('../options.html',import.meta.url),'utf8');
  assert.match(html,/id="filter-groups"/u);assert.match(html,/id="filter-hr-days" type="number"/u);
  assert.match(html,/id="max-contacts-per-job"/u);assert.match(html,/id="later-contact-hours"/u);
  const content=await readFile(new URL('../content.js',import.meta.url),'utf8');
  assert.match(content,/createGreetingControls/u);assert.match(content,/greetingControls\.draft\(\)/u);
  const options=await readFile(new URL('../options.js',import.meta.url),'utf8');
  assert.match(options,/FILTER_FIELD_DEFINITIONS\.flatMap/u);assert.match(options,/KEYWORD_GROUPS/u);
  assert.match(options,/delete validated\.greetingMode;delete validated\.greetingTemplate/u);
  const manifest=JSON.parse(await readFile(new URL('../manifest.json',import.meta.url),'utf8'));
  assert.ok(manifest.web_accessible_resources[0].resources.includes('shared/greeting-controls.js'));
});
