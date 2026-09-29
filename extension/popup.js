const $ = id => document.getElementById(id);
let blacklistSignature = '';
let current, busy = false, stepSignature = '', coverageSignature = '', exportedId = null;
let workflowScroll = 0, routeSignature = '', branchEditor = null;
let waitAfterStepId = null;
function setSettings(open) {
  if (open) workflowScroll = $('main').scrollTop;
  document.body.dataset.view = open ? 'settings' : 'workflow';
  $('settingsView').hidden = !open;
  $('workView').hidden = open;
  $('settingsToggle').setAttribute('aria-expanded', String(open));
  $('settingsToggle').textContent = open ? '完成' : '设置';
  $('settingsToggle').title = open ? '返回录制' : '网站黑名单设置';
  $('main').scrollTop = open ? 0 : workflowScroll;
}
const labels = {navigate:'打开页面',click:'点击',fill:'填写',select:'选择',check:'勾选',submit:'提交表单',keypress:'按键',manual:'手动步骤',note:'补充说明',wait:'等待',drag:'拖动',scroll:'滚动'};
const reasons = {
  'Recording started':'开始录制',
  'Recording continued here; actions during pause were not captured':'从当前页继续；暂停期间的操作未记录',
  'Sensitive field: complete manually; value was not recorded.':'敏感字段，未记录输入内容，执行时手动完成',
  'File selection: supply a new local file at replay time.':'文件选择，执行时提供本地文件',
  'File drop: supply a new local file at replay time; file paths were not recorded.':'文件拖放，执行时重新选择本地文件；路径未记录',
  'Shadow DOM drag: inspect the live browser and complete manually.':'Shadow DOM 拖动，执行时检查实时页面并手动完成',
  'Multi-select: select the desired options at replay time.':'多选控件，执行时选择所需项目',
  'URL changed; query/fragment values are not retained':'页面地址发生变化，网址参数值未保存'
};
function showNotice(message, success=false) {
  if(message && $('notice').textContent!==message)$('main').scrollTop=0;
  $('notice').textContent=message || ''; $('notice').hidden=!message; $('notice').classList.toggle('success',success);
}
function displayUrl(raw) { try { const u=new URL(raw);return u.hostname+(u.pathname==='/'?'':u.pathname); } catch { return raw || ''; } }
function dragPoints(step) {
  const point=value=>value && Number.isFinite(value.x) && Number.isFinite(value.y) ? `(${Math.round(value.x*100)}%, ${Math.round(value.y*100)}%)` : '(未知)';
  return `起点 ${point(step.start)} → 终点 ${point(step.end)}`;
}
function stepDescription(step) {
  if(step.note || reasons[step.reason] || step.reason)return step.note || reasons[step.reason] || step.reason;
  if(step.action==='wait')return `等待 ${step.seconds} 秒`;
  if(step.action==='drag'){
    const destination=step.dropTarget?.name || step.dropTarget?.label || step.dropTarget?.selector || '目标位置';
    const points=dragPoints(step);
    if(step.dragType==='range'){
      const values=Object.hasOwn(step,'value') ? `滑块值：${Object.hasOwn(step,'startValue') ? step.startValue : '未知'} → ${step.value}` : '执行时提供滑块目标值';
      return `${values} · ${points}`;
    }
    if(step.dragType==='canvas')return `画布轨迹 · ${step.path?.length || 0} 个点 · ${points}`;
    if(step.dragType==='sort')return `排序到 ${destination}${step.position==='before'?'之前':step.position==='after'?'之后':''} · ${points}`;
    return `拖动到 ${destination} · ${points}`;
  }
  if(step.action==='scroll')return `${step.page?'页面':'区域'}滚动到横向 ${Math.round((step.xRatio || 0)*100)}% · 纵向 ${Math.round((step.yRatio || 0)*100)}%`;
  return Object.hasOwn(step,'value') ? `填写示例：${step.value}` : step.parameter ? '执行时提供这个字段的值' : step.key ? `按下 ${step.key}` : step.action==='check' ? (step.checked ? '设为已选中' : '取消选中') : displayUrl(step.url);
}
async function request(type, extra = {}) {
  const result = await chrome.runtime.sendMessage({type,...extra});
  if (!result.ok) throw new Error(result.error || '操作失败');
  return result;
}
function renderCoverage(active) {
  $('coverage').hidden=!active;
  const signature=JSON.stringify(active ? {covered:active.covered,pending:active.pending} : null);
  if(signature===coverageSignature)return;
  coverageSignature=signature;$('missingFrames').replaceChildren();
  if(!active)return;
  $('coverageCount').textContent=`已连接 ${Object.keys(active.covered || {}).length} 个页面框架`;
  const seen=new Set();
  for(const item of active.pending || []) {
    const key=item.pattern || item.url || item.reason;if(seen.has(key))continue;seen.add(key);
    const row=document.createElement('div');row.className='frameWarning';
    const hint=document.createElement('p');hint.textContent=item.reason+(item.url ? ' · '+displayUrl(item.url) : '');row.appendChild(hint);
    $('missingFrames').appendChild(row);
  }
}
function openBranchEditor(stepId, branch = null) {
  if (busy || current?.active) return;
  branchEditor = branch ? {branchId:branch.id} : {afterStepId:stepId};
  $('branchDialogTitle').textContent=branch ? '编辑分支' : `从第 ${stepId} 步之后分支`;
  $('branchDialogHint').textContent=branch ? '执行到分支起点时，根据这个条件选择路线。' : '原路线会保留。创建后，请在网页回到这一步完成时的状态，再继续录制分支。';
  $('branchName').value=branch?.name || '';$('branchRule').value=branch?.condition || '';
  $('branchError').hidden=true;$('saveBranch').textContent=branch ? '保存修改' : '创建分支';
  $('branchDialog').showModal();$('branchRule').focus();
}
function openWaitEditor(stepId) {
  if (busy || current?.active) return;
  waitAfterStepId=stepId;$('waitSeconds').value='5';$('waitError').hidden=true;
  $('waitDialogHint').textContent=`在第 ${stepId} 步完成后、下一步开始前等待。`;
  $('waitDialog').showModal();$('waitSeconds').focus();$('waitSeconds').select();
}
function selectRoute(routeId) {
  return run(async()=>{const result=await request('SELECT_ROUTE',{routeId});$('main').scrollTop=0;return result;});
}
function renderRoutes(draft, active) {
  const branches=draft.branches || [], routeId=draft.selectedRouteId || 'main';
  const signature=JSON.stringify([draft.id,routeId,!!active,draft.steps.map(s=>s.id),branches]);
  if(signature===routeSignature)return;routeSignature=signature;
  const branch=branches.find(b=>b.id===routeId);
  $('routeSelect').replaceChildren(new Option('主流程', 'main'));
  for(const b of branches)$('routeSelect').append(new Option(b.name,b.id));
  $('routeSelect').value=routeId;$('routeSelect').disabled=!!active;
  $('branchInfo').hidden=!branch;$('editBranch').disabled=!!active;$('removeBranch').disabled=!!active;
  if(branch){
    const parent=branches.find(b=>b.id===branch.parentBranchId)?.name || '主流程';
    $('branchOrigin').textContent=`${parent} · 第 ${branch.afterStepId} 步之后`;
    $('branchCondition').textContent='当 '+branch.condition;
  }
  $('routeMap').hidden=!branches.length;$('branchCount').textContent=branches.length+' 个分支';
  $('routeTree').replaceChildren();
  function node(id, name, container) {
    const row=document.createElement('div'),button=document.createElement('button'),sequence=document.createElement('p');
    row.className='route-node';button.textContent=name+(id===routeId?' · 当前':'');button.disabled=!!active;button.addEventListener('click',()=>selectRoute(id));
    const ids=WRR.routeSteps(draft,id).map(s=>s.id);
    sequence.className='route-sequence';sequence.textContent=ids.length>12 ? ids.slice(0,8).join(' → ')+' → … → '+ids.at(-1) : ids.join(' → ') || '尚未录制';
    row.append(button,sequence);
    for(const child of branches.filter(b=>b.parentBranchId===id)){
      const childRow=node(child.id,child.name,row),condition=document.createElement('p');
      condition.textContent=`第 ${child.afterStepId} 步后 · 当 ${child.condition}`;childRow.insertBefore(condition,childRow.children[1]);
    }
    container.append(row);return row;
  }
  node('main','主流程',$('routeTree'));
  const own=WRR.routeSteps(draft),full=WRR.routePath(draft),prefix=full.slice(0,full.length-own.length);
  $('sharedPrefix').hidden=!branch;
  const prefixText=prefix.length>12 ? prefix.slice(0,8).map(s=>s.id).join(' → ')+' → … → '+prefix.at(-1).id : prefix.map(s=>s.id).join(' → ');
  $('sharedPrefix').textContent='共用前置步骤：'+prefixText+'。以下是本分支的步骤。';
}
function renderSteps(draft,active) {
  const routeId=draft.selectedRouteId || 'main',steps=WRR.routeSteps(draft),branches=draft.branches || [];
  const signature=JSON.stringify([draft.id,routeId,!!active,steps,branches.map(b=>[b.id,b.name,b.afterStepId])]);
  if(signature===stepSignature)return;
  const sameRecording=current?.draft?.id===draft.id;
  const opened=sameRecording ? new Set([...$('steps').querySelectorAll('details[open]')].map(x=>x.dataset.key)) : new Set();
  stepSignature=signature;$('steps').replaceChildren();$('emptySteps').hidden=!!steps.length;
  $('emptySteps').textContent=routeId==='main'?'还没有操作步骤，回到网页开始演示吧。':'分支尚未录制。先在网页回到分支起点，再点击“继续录制此分支”。';
  const fragment=document.createDocumentFragment();
  for(const step of steps) {
    const li=document.createElement('li'),index=document.createElement('span'),main=document.createElement('div'),details=document.createElement('details'),summary=document.createElement('summary'),meta=document.createElement('div'),subtitle=document.createElement('div');
    index.className='step-index';index.textContent=step.id;index.setAttribute('aria-hidden','true');
    main.className='step-main';details.className='step-details';details.dataset.key=String(step.id);details.open=opened.has(details.dataset.key);
    const target=step.action==='wait' ? `${step.seconds} 秒` : step.target?.name || step.target?.label || step.target?.placeholder || step.target?.fieldName || (step.action==='navigate' ? displayUrl(step.url) : '');
    summary.textContent=`${labels[step.action] || step.action}${target ? ' · '+target : ''}`;
    if(step.frame?.id>0 || step.action==='manual') {const tag=document.createElement('span');tag.className='step-tag'+(step.action==='manual'?' manual':'');tag.textContent=step.action==='manual'?'需手动':'弹层';summary.appendChild(tag);}
    const description=stepDescription(step);subtitle.className='step-subtitle';subtitle.textContent=description;
    meta.className='step-meta';meta.textContent=description+(step.frame?.id>0 ? `\n嵌入页面：${step.frame.url}` : '')+(step.url ? `\n所在网页：${displayUrl(step.pageUrl || step.url)}` : '');
    details.append(summary,meta);main.appendChild(details);
    const children=branches.filter(b=>b.parentBranchId===routeId && b.afterStepId===step.id);
    if(!active) {
      const actions=document.createElement('div'),wait=document.createElement('button'),fork=document.createElement('button'),del=document.createElement('button');actions.className='step-actions';
      wait.textContent='等待';wait.className='wait-step';wait.setAttribute('aria-label',`在第 ${step.id} 步后添加等待`);wait.addEventListener('click',()=>openWaitEditor(step.id));
      fork.textContent='分支';fork.className='fork-step';fork.setAttribute('aria-label',`从第 ${step.id} 步创建分支`);fork.addEventListener('click',()=>openBranchEditor(step.id));
      del.textContent='删除';del.className='delete';del.setAttribute('aria-label',`删除第 ${step.id} 步`);del.disabled=!!children.length;if(children.length)del.title='先删除关联分支，才能删除起点';
      del.addEventListener('click',()=>run(async()=>{exportedId=null;return request('REMOVE_STEP',{id:step.id});}));actions.append(wait,fork,del);main.append(actions);
    }
    li.append(index,main,subtitle);
    for(const branch of children){const link=document.createElement('button');link.className='branch-link';link.textContent='↳ '+branch.name;link.disabled=!!active;link.addEventListener('click',()=>selectRoute(branch.id));li.append(link);}
    fragment.appendChild(li);
  }
  $('steps').appendChild(fragment);
}
function renderBlacklist(blacklist = []) {
  $('blacklistEmpty').hidden=!!blacklist.length;
  $('blacklistCount').textContent=blacklist.length ? `${blacklist.length} 个网站` : '默认允许所有网站';
  const signature=JSON.stringify(blacklist);if(signature===blacklistSignature)return;blacklistSignature=signature;
  $('blacklistItems').replaceChildren();
  for(const host of blacklist) {
    const row=document.createElement('li'),label=document.createElement('span'),button=document.createElement('button');
    label.textContent=host;button.textContent='移除';button.className='text-button';button.setAttribute('aria-label','移除 '+host);
    button.addEventListener('click',()=>run(()=>request('REMOVE_BLOCK',{host})));row.append(label,button);$('blacklistItems').append(row);
  }
}
function render(data) {
  renderBlacklist(data.blacklist);
  const {draft,active}=data;
  const state=active?'recording':draft?(exportedId===draft.id?'exported':'review'):'ready';
  document.body.dataset.state=state;
  $('statusText').textContent={recording:'录制中',review:'待导出',exported:'已导出',ready:'准备就绪'}[state];
  $('setup').hidden=!!draft;$('start').hidden=!!draft;$('stop').hidden=!active;
  $('resume').hidden=!draft;$('review').hidden=!draft;$('export').hidden=!draft || !!active;
  $('resume').textContent=active?'切换录制到当前页':draft?.selectedRouteId && draft.selectedRouteId!=='main'?'继续录制此分支':'继续录制当前页';
  $('export').disabled=!!active;$('clear').disabled=!!active;
  $('clear').hidden=!draft;
  $('clear').title=active?'停止录制后可以清除':'清除本机保存的本次录制';
  for (const id of ['flowRecord','flowReview','flowExport']) $(id).removeAttribute('aria-current');
  $(active || !draft ? 'flowRecord' : state==='exported' ? 'flowExport' : 'flowReview').setAttribute('aria-current','step');
  $('flowRecord').className=!draft || active?'current':'done';
  $('flowReview').className=state==='review'?'current':state==='exported'?'done':'';
  $('flowExport').className=state==='exported'?'current':'';
  $('footerHint').textContent=active?'回到网页操作，步骤会自动保存':draft?'导出后交给 Codex，生成可复用的 Skill':'只录制你选定的标签页';
  if(draft?.warning)showNotice(draft.warning);
  else if(state!=='exported')showNotice('');
  renderCoverage(active);
  if(draft) {
    $('recordTitle').textContent=draft.title || '未命名工作流';$('recordTitle').title=draft.title || '';
    $('count').textContent=`${WRR.allSteps(draft).length} 步`;
    $('reviewEyebrow').textContent=(active?'正在记录 · ':'本次录制 · ')+((draft.branches || []).find(b=>b.id===draft.selectedRouteId)?.name || '主流程');
    $('reviewHint').textContent=active?'操作会自动加入列表；停止后可以检查和删除。':'停止后可从任一步创建分支；导出包含全部路线。';
    renderRoutes(draft,active);
    renderSteps(draft,active);
  } else {stepSignature='';routeSignature='';exportedId=null;$('notePanel').open=false;$('note').value='';}
  current=data;
}
async function run(fn) {
  if(busy)return;busy=true;document.body.setAttribute('aria-busy','true');
  try {const result=await fn();if(result)render(result);} catch(error) {showNotice(error.message);} finally {busy=false;document.body.removeAttribute('aria-busy');}
}
async function selectedTab() {const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab)throw new Error('没有当前标签页');return tab.id;}
$('settingsToggle').addEventListener('click',()=>setSettings($('settingsView').hidden));
document.addEventListener('keydown',event=>{if(event.key==='Escape' && !$('settingsView').hidden){event.preventDefault();setSettings(false);$('settingsToggle').focus();}});
$('addBlock').addEventListener('click',()=>run(async()=>{const result=await request('ADD_BLOCK',{host:$('blockHost').value});$('blockHost').value='';return result;}));
$('blockHost').addEventListener('keydown',event=>{if(event.key==='Enter' && !event.isComposing){event.preventDefault();$('addBlock').click();}});
$('start').addEventListener('click',()=>run(async()=>request('START',{tabId:await selectedTab(),title:$('title').value,goal:$('goal').value,captureValues:$('capture').checked})));
$('resume').addEventListener('click',()=>run(async()=>{exportedId=null;return request('CONTINUE',{tabId:await selectedTab()});}));
$('stop').addEventListener('click',()=>run(()=>request('STOP')));
$('scan').addEventListener('click',()=>run(()=>request('SCAN_FRAMES')));
$('routeSelect').addEventListener('change',()=>selectRoute($('routeSelect').value));
$('editBranch').addEventListener('click',()=>openBranchEditor(null,(current.draft.branches || []).find(b=>b.id===current.draft.selectedRouteId)));
$('removeBranch').addEventListener('click',()=>run(async()=>{
  const id=current.draft.selectedRouteId,number=WRR.branchDescendants(current.draft,id).size;
  if(confirm(`删除这条分支及其 ${number-1} 条子分支？这些分支的录制步骤会一并删除，原路线保留。`)){exportedId=null;return request('REMOVE_BRANCH',{branchId:id});}
}));
$('cancelBranch').addEventListener('click',()=>$('branchDialog').close());
$('branchForm').addEventListener('submit',event=>{
  event.preventDefault();run(async()=>{
    $('saveBranch').disabled=true;
    try {
      const result=await request(branchEditor.branchId?'UPDATE_BRANCH':'CREATE_BRANCH',{...branchEditor,name:$('branchName').value,condition:$('branchRule').value});
      exportedId=null;$('branchDialog').close();$('main').scrollTop=0;return result;
    } catch(error){$('branchError').textContent=error.message;$('branchError').hidden=false;}
    finally{$('saveBranch').disabled=false;}
  });
});
$('cancelWait').addEventListener('click',()=>$('waitDialog').close());
$('waitForm').addEventListener('submit',event=>{
  event.preventDefault();run(async()=>{
    $('saveWait').disabled=true;
    try {
      const result=await request('INSERT_WAIT',{afterStepId:waitAfterStepId,seconds:Number($('waitSeconds').value)});
      exportedId=null;$('waitDialog').close();return result;
    } catch(error){$('waitError').textContent=error.message;$('waitError').hidden=false;}
    finally{$('saveWait').disabled=false;}
  });
});
$('clear').addEventListener('click',()=>run(async()=>{if(confirm('清除本次录制及所有分支？请先导出需要保留的内容。'))return request('CLEAR');}));
$('addNote').addEventListener('click',()=>run(async()=>{const result=await request('NOTE',{note:$('note').value});$('note').value='';exportedId=null;return result;}));
$('note').addEventListener('keydown',event=>{if(event.key==='Enter' && !event.isComposing){event.preventDefault();$('addNote').click();}});
$('export').addEventListener('click',()=>run(async()=>{
  const result=await request('STATE');if(result.active || !result.draft)throw new Error('请先停止录制');
  const blob=new Blob([JSON.stringify(result.draft,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');
  anchor.href=url;anchor.download=`wrr-${result.draft.startedAt.slice(0,10)}-${result.draft.id.slice(0,8)}.json`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  exportedId=result.draft.id;render(result);showNotice('已发起下载。将 JSON 文件交给 Codex，并说“把这份录制整理成 Skill”。',true);
}));
run(()=>request('STATE'));
setInterval(()=>{if(!busy && current?.active)run(()=>request('STATE'));},1500);
