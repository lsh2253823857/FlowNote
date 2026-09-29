/* Real MV3 extension test using shipped permissions and an isolated profile. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.WRR_PLAYWRIGHT || 'playwright');
const core = require('../extension/core.js');
assert.equal(core.blacklistHost('https://Example.com/path'),'example.com');
assert(core.isBlocked('https://a.example.com/path',['example.com']));
assert(!core.isBlocked('https://notexample.com',['example.com']));
assert(core.blockedFrame({frameId:2,parentFrameId:1,url:'https://allowed.com'},[{frameId:1,parentFrameId:0,url:'https://example.com'}],['example.com']));
assert.throws(()=>core.blacklistHost('javascript://bad'));
const forkFixture={steps:[1,2,3,4,5].map(id=>({id,action:'click'})),branches:[{id:'alternate',parentBranchId:'main',afterStepId:3,steps:[6,7,8].map(id=>({id,action:'click'}))}],selectedRouteId:'alternate'};
assert.deepEqual(core.routePath(forkFixture).map(s=>s.id),[1,2,3,6,7,8]);
assert.throws(()=>core.routeSteps(forkFixture,'missing'));
const anchoredInput={steps:[{id:1,action:'fill',url:'https://example.test',target:{},parameter:true}],branches:[{id:'alt',parentBranchId:'main',afterStepId:1,steps:[]}]};
core.appendToRoute(anchoredInput,{action:'fill',url:'https://example.test',target:{},parameter:true});
assert.deepEqual(anchoredInput.steps.map(s=>s.id),[1,2],'coalescing must never replace a fork anchor');
const waitFixture={steps:[{id:1,action:'click'},{id:4,action:'click'}],branches:[{id:'alt',parentBranchId:'main',afterStepId:1,steps:[{id:7,action:'click'}]}],selectedRouteId:'main',nextStepId:8};
core.insertAfter(waitFixture,1,{action:'wait',seconds:5,url:'https://example.test/',target:{}});
assert.deepEqual(waitFixture.steps.map(s=>s.id),[1,8,4],'inserted waits receive a new global ID without renumbering');
assert.equal(waitFixture.steps[1].seconds,5);
assert.equal(core.normalizeEvent({action:'wait',seconds:30,url:'https://example.test/'},false).seconds,30);
assert.equal(core.normalizeEvent({action:'wait',seconds:0,url:'https://example.test/'},false),null);
const root = path.resolve(__dirname,'..');
const output = path.resolve(process.env.WRR_TEST_OUTPUT || path.join(os.tmpdir(),'wrr-test-results'));
fs.mkdirSync(output,{recursive:true});
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'wrr-browser-test-'));
const extension=path.join(tmp,'extension');
fs.cpSync(path.join(root,'extension'),extension,{recursive:true});
const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'),'utf8'));
assert.deepEqual(manifest.permissions,['activeTab','scripting','storage','webNavigation']);
assert.deepEqual(manifest.host_permissions,['https://*/*','http://*/*']);
assert.equal(manifest.optional_host_permissions,undefined);
const html=`<!doctype html><meta charset="utf-8"><title>WRR isolated fixture</title>
<style>body{font:16px sans-serif;padding:36px}label{display:block;margin:16px}input,select,button{padding:8px}#result{color:green}</style>
<h1>经营日报 · 本地测试</h1><form id="report"><label>日期<input id="date" name="report-date"></label>
<label>密码<input id="password" type="password" name="password"></label>
<label>验证码<input id="otp" name="otp" autocomplete="one-time-code"></label>
<label>分类<select id="category"><option value="daily">日报</option><option value="monthly">月报</option></select></label>
<label><input type="checkbox" id="include" name="include">包含退款</label>
<button type="submit" id="download">生成报表</button></form>
<button id="route" onclick="history.pushState({},'', '/route?token=URL-SECRET#private')">切换页面</button>
<div id="result"></div><script>document.querySelector('form').onsubmit=e=>{e.preventDefault();document.getElementById('result').textContent='报表生成成功'};</script>`;
const frameHtml=`<!doctype html><meta charset="utf-8"><label>标题<input id="frame-title"></label><label>密码<input type="password" id="frame-password"></label><button id="frame-save">保存草稿</button><div contenteditable="true" id="editor"></div>`;
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end(req.url.startsWith('/frame') ? frameHtml : html);});
async function poll(fn, predicate, label, timeout=6000) {
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline) {const v=await fn();if(predicate(v))return v;await new Promise(r=>setTimeout(r,100));}
  throw new Error('Timed out: '+label);
}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  let context;
  try {
    context=await chromium.launchPersistentContext(path.join(tmp,'profile'),{
      headless:true, channel:'chromium', executablePath:process.env.WRR_CHROMIUM || undefined,
      args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]
    });
    const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id=new URL(worker.url()).hostname;
    const page=await context.newPage();await page.goto(base+'/fixture');
    const popup=await context.newPage();await popup.setViewportSize({width:440,height:600});await popup.goto(`chrome-extension://${id}/popup.html`);
    const pageErrors=[];popup.on('pageerror',error=>pageErrors.push(error.message));
    await popup.locator('#setup').waitFor();
    await popup.locator('#capture').check();assert.equal(await popup.locator('#capture').isChecked(),true);await popup.locator('#capture').uncheck();
    await popup.screenshot({path:path.join(output,'ui-ready.png')});
    assert(await popup.locator('#start').isVisible());
    assert(await popup.evaluate(()=>document.documentElement.scrollWidth<=440),'popup horizontal overflow');
    assert((await popup.locator('#start').boundingBox()).y<550,'start action must fit the popup');
    const tabId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,base+'/fixture');
    const command=(type,args={})=>popup.evaluate(async({type,args})=>chrome.runtime.sendMessage({type,...args}),{type,args});
    const get=()=>command('STATE');
    let response=await command('START',{tabId,title:'下载经营日报',goal:'选择日期并生成日报',captureValues:false});
    assert.equal(response.ok,true,JSON.stringify(response));
    await page.locator('[data-wrr-indicator]').waitFor();
    await popup.reload();await popup.locator('#stop').waitFor();
    await popup.screenshot({path:path.join(output,'ui-recording.png')});
    await page.locator('#date').fill('PRIVATE-EXAMPLE');
    await page.locator('#password').fill('PASSWORD-SECRET');
    await page.locator('#otp').fill('123456');
    await page.locator('#category').focus();
    await page.locator('#category').press('ArrowDown');
    await page.locator('#category').press('Tab');
    await page.locator('#include').check();
    await page.locator('#download').click();
    await page.locator('#route').click();
    let state=await poll(get,s=>s.draft.steps.some(x=>x.action==='navigate' && x.url.includes('/route')),'SPA navigation');
    let encoded=JSON.stringify(state.draft);
    for(const secret of ['PRIVATE-EXAMPLE','PASSWORD-SECRET','123456','URL-SECRET','#private'])assert(!encoded.includes(secret),secret+' leaked');
    assert(state.draft.steps.some(s=>s.action==='fill' && s.parameter===true));
    assert.equal(state.draft.steps.filter(s=>s.action==='fill' && s.target.selector==='#date').length,1,'input and change should coalesce');
    assert(state.draft.steps.some(s=>s.action==='select'),'trusted native select should be recorded');
    assert(state.draft.steps.some(s=>s.action==='check' && s.checked===true));
    assert(state.draft.steps.some(s=>s.action==='submit'));
    assert(state.draft.steps.filter(s=>s.action==='manual').length>=2);
    // A dynamically created same-origin drawer and nested child must both record.
    await page.evaluate(()=>{const f=document.createElement('iframe');f.id='drawer';f.src='/frame';document.body.appendChild(f);});
    await poll(get,s=>Object.keys(s.active?.covered || {}).length>=2,'dynamic iframe injection');
    const drawer=page.frameLocator('#drawer');
    await drawer.locator('#frame-title').fill('FRAME-PRIVATE');
    await drawer.locator('#frame-save').click();
    state=await poll(get,s=>s.draft.steps.some(x=>x.action==='click' && x.frame?.id>0 && x.target.selector==='#frame-save'),'iframe click');
    assert(state.draft.steps.some(x=>x.action==='fill' && x.frame?.id>0 && x.parameter===true));
    assert(!JSON.stringify(state).includes('FRAME-PRIVATE'));
    await page.locator('#drawer').evaluate(f=>{const c=f.contentDocument.createElement('iframe');c.id='nested';c.src='/frame/nested';f.contentDocument.body.appendChild(c);});
    await poll(get,s=>Object.keys(s.active?.covered || {}).length>=3,'nested iframe injection');
    await drawer.frameLocator('#nested').locator('#frame-title').fill('NESTED-PRIVATE');
    await poll(get,s=>s.draft.steps.some(x=>x.action==='fill' && x.frame?.parentId>0),'nested frame context');
    const beforeReload=(await get()).active.covered;
    await page.locator('#drawer').evaluate(f=>{f.src='/frame/reloaded';});
    state=await poll(get,s=>Object.values(s.active?.covered || {}).some(f=>f.url.includes('/frame/reloaded')),'iframe navigation reinjection');
    const changed=Object.values(state.active.covered).find(f=>f.url.includes('/frame/reloaded'));
    assert.notEqual(changed.documentId,beforeReload[changed.id]?.documentId);
    await drawer.locator('#frame-title').fill('RELOADED-FRAME');
    await poll(get,s=>s.draft.steps.some(x=>x.action==='fill' && x.frame?.documentId===changed.documentId),'reloaded frame input');
    // Cross-site drawers record by default, and blacklist changes take effect immediately.
    await page.evaluate(url=>{const f=document.createElement('iframe');f.id='cross';f.src=url;document.body.appendChild(f);},base.replace('127.0.0.1','localhost')+'/frame');
    await poll(get,s=>Object.values(s.active?.covered || {}).some(f=>f.url.includes('localhost')),'default cross-site access');
    await page.frameLocator('#cross').locator('#frame-title').fill('DEFAULT-CROSS');
    await poll(get,s=>s.draft.steps.some(x=>x.action==='fill' && x.url.includes('localhost')),'default cross-site capture');
    await popup.reload();await popup.locator('#settingsToggle').click();
    assert(await popup.locator('#settingsView').isVisible());assert(!await popup.locator('.action-bar').isVisible());
    await popup.locator('#blockHost').fill('http://localhost:'+server.address().port+'/frame');await popup.locator('#blockHost').press('Enter');
    await poll(get,s=>s.blacklist.includes('localhost') && s.active.pending.some(f=>f.reason.includes('黑名单')),'UI add blacklist');
    await popup.screenshot({path:path.join(output,'ui-blacklist.png')});
    const blockedCount=(await get()).draft.steps.length;
    const blockedEvents=(await get()).draft.steps.filter(s=>s.url.includes('localhost'));
    await page.frameLocator('#cross').locator('#frame-title').fill('BLOCKED-INPUT');
    await page.frameLocator('#cross').locator('#frame-save').click();
    // Other live frames can finish queued change events; only this origin is blocked.
    assert.deepEqual((await get()).draft.steps.filter(s=>s.url.includes('localhost')),blockedEvents,'existing injected frame must stop recording');
    await popup.getByRole('button',{name:'移除 localhost',exact:true}).click();
    await poll(get,s=>!s.blacklist.length && Object.values(s.active.covered).some(f=>f.url.includes('localhost')),'remove blacklist');
    await page.frameLocator('#cross').locator('#frame-save').click();
    await poll(get,s=>s.draft.steps.length>blockedCount && s.draft.steps.at(-1).url.includes('localhost') && s.draft.steps.at(-1).action==='click','frame resumes after removal');
    await popup.keyboard.press('Escape');assert(await popup.locator('#review').isVisible());
    assert(await popup.locator('#clear').isDisabled());
    await command('STOP');
    await page.locator('[data-wrr-indicator]').waitFor({state:'detached'});
    const count=(await get()).draft.steps.length;
    await page.locator('#date').fill('PAUSED-INPUT');
    assert.equal((await get()).draft.steps.length,count);
    await command('CONTINUE',{tabId});
    await page.reload();
    await page.locator('[data-wrr-indicator]').waitFor();
    await page.locator('#date').fill('AFTER-RELOAD');
    await poll(get,s=>s.draft.steps.at(-1).action==='fill','record after reload');
    await command('STOP');
    await popup.reload();
    await popup.locator('#review').waitFor();
    await popup.locator('#notePanel > summary').click();
    await popup.locator('#note').fill('UI 测试补充说明');await popup.locator('#note').press('Enter');
    await poll(get,s=>s.draft.steps.at(-1).note==='UI 测试补充说明','add note with Enter');
    const noteId=(await get()).draft.steps.at(-1).id;
    await popup.getByRole('button',{name:`删除第 ${noteId} 步`,exact:true}).click();
    await poll(get,s=>!s.draft.steps.some(x=>x.note==='UI 测试补充说明'),'delete step from UI');
    const waitAnchor=(await get()).draft.steps[0].id;
    await popup.getByRole('button',{name:`在第 ${waitAnchor} 步后添加等待`,exact:true}).click();
    await popup.locator('#waitSeconds').fill('7');await popup.locator('#saveWait').click();
    state=await poll(get,s=>s.draft.steps.some(x=>x.action==='wait' && x.seconds===7),'insert wait from UI');
    const waitIndex=state.draft.steps.findIndex(x=>x.action==='wait' && x.seconds===7);
    assert.equal(state.draft.steps[waitIndex-1].id,waitAnchor,'wait is inserted immediately after the selected step');
    assert.equal((await command('INSERT_WAIT',{afterStepId:waitAnchor,seconds:0})).ok,false,'zero-second wait rejected');
    assert.equal((await command('INSERT_WAIT',{afterStepId:waitAnchor,seconds:1.5})).ok,false,'fractional wait rejected');
    assert.equal((await command('INSERT_WAIT',{afterStepId:999999,seconds:5})).ok,false,'missing insertion point rejected');
    await popup.evaluate(()=>document.getElementById('main').scrollTop=0);
    await popup.screenshot({path:path.join(output,'recorder-review.png')});
    const clearBox=await popup.locator('#clear').boundingBox();
    assert(clearBox.height>=44 && clearBox.y+clearBox.height<600,'clear button must remain in the footer');
    await popup.locator('.step-details summary').first().click();
    await popup.locator('#settingsToggle').click();await popup.locator('#settingsToggle').click();
    assert.notEqual(await popup.locator('.step-details').first().getAttribute('open'),null,'settings must preserve expanded steps');
    await popup.locator('.step-details summary').first().click();
    popup.once('dialog',dialog=>dialog.dismiss());await popup.locator('#clear').click();
    assert((await get()).draft,'cancel clear must preserve the recording');
    const downloadPromise=popup.waitForEvent('download');await popup.locator('#export').click();
    const download=await downloadPromise;await download.saveAs(path.join(output,'recording.json'));
    assert.equal(await popup.locator('#statusText').textContent(),'已导出');
    await popup.screenshot({path:path.join(output,'ui-exported.png')});
    assert.deepEqual(pageErrors,[]);
    assert.equal(JSON.parse(fs.readFileSync(path.join(output,'recording.json'),'utf8')).producer,'windows-record-replay');
    // Fork from a recorded step without overwriting the original route.
    const mainSnapshot=JSON.stringify((await get()).draft.steps),anchor=(await get()).draft.steps[2].id;
    await popup.getByRole('button',{name:`从第 ${anchor} 步创建分支`,exact:true}).click();
    await popup.locator('#branchName').fill('查询无数据');await popup.locator('#branchRule').fill('页面显示暂无数据');
    await popup.locator('#saveBranch').click();
    state=await poll(get,s=>s.draft.branches?.length===1,'create branch from UI');
    const branchId=state.draft.selectedRouteId;
    assert.equal(JSON.stringify(state.draft.steps),mainSnapshot,'fork must preserve the main route');
    assert.equal(state.draft.schemaVersion,2);assert.equal(state.draft.branches[0].afterStepId,anchor);
    assert(await popup.locator('#sharedPrefix').isVisible());
    assert((await command('CONTINUE',{tabId})).ok);
    const oldCapture=(await get()).active.captureId;
    assert.equal((await command('SELECT_ROUTE',{routeId:'main'})).ok,false,'cannot switch route while recording');
    await page.locator('#date').fill('BRANCH-PARAMETER');await page.locator('#download').click();
    await poll(get,s=>s.draft.branches[0].steps.some(x=>x.action==='submit'),'real actions recorded into branch');
    await command('STOP');await popup.reload();await popup.locator('#branchInfo').waitFor();
    assert.equal(await popup.locator('#routeSelect').inputValue(),branchId,'selected route persists');
    state=await get();assert.equal(JSON.stringify(state.draft.steps),mainSnapshot);
    const ownLast=state.draft.branches[0].steps.at(-1).id;
    await popup.locator('#editBranch').click();await popup.locator('#branchRule').fill('页面显示暂无数据，改查前一天');await popup.locator('#saveBranch').click();
    await poll(get,s=>s.draft.branches[0].condition.includes('前一天'),'edit branch condition');
    await popup.locator('#routeMap > summary').click();
    await popup.screenshot({path:path.join(output,'ui-branch.png')});
    // Nested branches, sibling alternatives, stable anchors, and stale event rejection.
    assert((await command('CREATE_BRANCH',{afterStepId:ownLast,name:'再次重试',condition:'仍无数据'})).ok);
    const nestedId=(await get()).draft.selectedRouteId;
    await command('CONTINUE',{tabId});
    const stale=await worker.evaluate(async({tabId,recordingId})=>(await chrome.scripting.executeScript({target:{tabId},func:async recordingId=>chrome.runtime.sendMessage({type:'EVENT',recordingId,event:{action:'click',url:location.href,target:{name:'STALE-BRANCH-EVENT'}}}),args:[recordingId]}))[0].result,{tabId,recordingId:oldCapture});
    assert.equal(stale.ignored,true,'old capture session cannot write to a new route');
    await page.locator('#date').fill('NESTED-BRANCH');await page.locator('#download').click();
    await poll(get,s=>s.draft.branches.find(b=>b.id===nestedId).steps.some(x=>x.action==='submit'),'nested branch actions');
    await command('STOP');await command('SELECT_ROUTE',{routeId:'main'});
    assert.equal((await command('REMOVE_STEP',{id:anchor})).ok,false,'cannot remove a fork anchor');
    const firstId=(await get()).draft.steps[0].id;await command('REMOVE_STEP',{id:firstId});
    assert.equal((await get()).draft.branches[0].afterStepId,anchor,'deleting earlier steps preserves anchor IDs');
    assert((await command('CREATE_BRANCH',{afterStepId:anchor,name:'权限不足',condition:'页面显示无权限'})).ok);
    const siblingId=(await get()).draft.selectedRouteId;
    await command('NOTE',{note:'联系管理员后再执行'});
    await command('SELECT_ROUTE',{routeId:branchId});await popup.reload();
    const branchDownload=popup.waitForEvent('download');await popup.locator('#export').click();
    await (await branchDownload).saveAs(path.join(output,'branch-recording.json'));
    const exported=JSON.parse(fs.readFileSync(path.join(output,'branch-recording.json'),'utf8'));
    assert.equal(exported.branches.length,3);assert.equal(exported.schemaVersion,2);
    const ids=[...exported.steps,...exported.branches.flatMap(b=>b.steps)].map(s=>s.id);
    assert.equal(new Set(ids).size,ids.length,'IDs must be globally unique');
    assert(!JSON.stringify(exported).includes('STALE-BRANCH-EVENT'));
    popup.once('dialog',dialog=>dialog.dismiss());await popup.locator('#removeBranch').click();assert.equal((await get()).draft.branches.length,3);
    popup.once('dialog',dialog=>dialog.accept());await popup.locator('#removeBranch').click();
    state=await poll(get,s=>s.draft.branches.length===1,'delete branch and descendants');
    assert.equal(state.draft.branches[0].id,siblingId,'sibling route survives');
    assert.equal(state.draft.selectedRouteId,'main');
    // Popup actions are not callable from page content scripts.
    const denied=await worker.evaluate(async tabId=>(await chrome.scripting.executeScript({target:{tabId},func:async()=>chrome.runtime.sendMessage({type:'CLEAR'})}))[0].result,tabId);
    assert.equal(denied.ok,false);
    popup.once('dialog',dialog=>dialog.accept());await popup.locator('#clear').click();
    await popup.locator('#setup').waitFor();assert.equal((await get()).draft,null);
    await command('START',{tabId,title:'普通值采集',captureValues:true});
    await page.locator('[data-wrr-indicator]').waitFor();
    await page.locator('#date').fill('2026-09-23');
    await page.locator('#password').fill('SECOND-SECRET');
    state=await poll(get,s=>s.draft.steps.some(x=>x.value==='2026-09-23'),'opt-in value capture');
    assert(!JSON.stringify(state).includes('SECOND-SECRET'));
    const other=await context.newPage();await other.goto(base+'/other');
    await other.locator('#date').fill('OTHER-TAB-NOT-RECORDED');
    assert(!JSON.stringify(await get()).includes('OTHER-TAB-NOT-RECORDED'));
    // localhost differs from the fixture's granted 127.0.0.1 origin.
    await page.goto(base.replace('127.0.0.1','localhost')+'/other-origin');
    await poll(get,s=>Object.values(s.active?.covered || {}).some(f=>f.id===0 && f.url.includes('localhost')),'cross-origin navigation continues');
    await command('ADD_BLOCK',{host:'localhost'});
    assert.equal((await get()).active,null,'blacklisted root stops recording');
    assert.equal((await command('CONTINUE',{tabId})).ok,false,'blacklisted root cannot start');
    await command('CLEAR');assert.deepEqual((await get()).blacklist,['localhost'],'clear preserves blacklist');
    await popup.reload();assert.deepEqual((await get()).blacklist,['localhost'],'blacklist persists across popup reload');
    await command('REMOVE_BLOCK',{host:'localhost'});
    await command('STOP');
    const redacted=core.normalizeEvent({action:'fill',url:base,target:{fieldName:'api_key'},value:'x'},true);
    assert.equal(redacted.action,'manual');assert.equal(redacted.value,undefined);
    // A second isolated profile emulates a site permission already granted by the user.
    await context.close();context=null;
    // Both profiles use the shipped default host permissions.
    fs.writeFileSync(path.join(extension,'manifest.json'),JSON.stringify(manifest));
    context=await chromium.launchPersistentContext(path.join(tmp,'granted-profile'),{
      headless:true,channel:'chromium',executablePath:process.env.WRR_CHROMIUM || undefined,
      args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]
    });
    const grantedWorker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const grantedPage=await context.newPage();await grantedPage.goto(base+'/fixture');
    await grantedPage.evaluate(url=>{const f=document.createElement('iframe');f.id='cross';f.src=url;document.body.appendChild(f);},base.replace('127.0.0.1','localhost')+'/frame');
    await grantedPage.frameLocator('#cross').locator('#frame-title').waitFor();
    const grantedPopup=await context.newPage();await grantedPopup.goto(`chrome-extension://${new URL(grantedWorker.url()).hostname}/popup.html`);
    const grantedTabId=await grantedWorker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,base+'/fixture');
    const grantedCommand=(type,args={})=>grantedPopup.evaluate(async({type,args})=>chrome.runtime.sendMessage({type,...args}),{type,args});
    assert.equal((await grantedCommand('START',{tabId:grantedTabId,title:'已授权跨站弹层',captureValues:true})).ok,true);
    await poll(()=>grantedCommand('STATE'),s=>Object.keys(s.active?.covered || {}).length>=2,'authorized cross-origin injection');
    const cross=grantedPage.frameLocator('#cross');
    await cross.locator('#frame-title').fill('标题来自跨站弹层');
    await cross.locator('#frame-password').fill('CROSS-FRAME-SECRET');
    await cross.locator('#frame-save').click();
    const grantedState=await poll(()=>grantedCommand('STATE'),s=>s.draft.steps.some(x=>x.action==='click' && x.frame?.id>0),'authorized cross-origin capture');
    assert(grantedState.draft.steps.some(x=>x.value==='标题来自跨站弹层' && x.frame?.id>0 && x.pageUrl===base+'/fixture'));
    assert(!JSON.stringify(grantedState).includes('CROSS-FRAME-SECRET'));
    await grantedCommand('STOP');
    fs.writeFileSync(path.join(output,'frame-recording.json'),JSON.stringify(grantedState.draft,null,2));
    console.log(JSON.stringify({passed:true,checks:['branch UI and persistence','nested and sibling branches','route isolation','stable fork anchors','branch export','branch deletion','stale session rejection','MV3 startup','selected-tab isolation','field parameterization','input deduplication','password/OTP exclusion','trusted select/checkbox/submit','SPA routing','pause/resume','reload reinjection','popup rendering','JSON export','sender authorization','opt-in values','cross-origin navigation continues','blacklist immediate enforcement','blacklist persistence','blocked root rejected','dynamic iframe','nested iframe','iframe navigation reinjection','blacklist UI','authorized cross-origin frame','frame password exclusion'],output,temporaryProfile:tmp},null,2));
  } finally {if(context)await context.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
