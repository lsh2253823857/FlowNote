importScripts('core.js');
let tail = Promise.resolve();
function serialized(fn) { const result = tail.then(fn, fn); tail = result.catch(() => {}); return result; }
async function state() {
  const [{ draft, blacklist = [] }, { active }] = await Promise.all([chrome.storage.local.get(['draft','blacklist']), chrome.storage.session.get('active')]);
  return { draft: draft || null, active: active || null, blacklist };
}
async function badge(active, text) {
  await chrome.action.setBadgeText({ text: text || (active ? 'REC' : '') });
  await chrome.action.setBadgeBackgroundColor({ color: active ? '#c0392b' : '#566175' });
}
function isPopup(sender) { return sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('popup.html'); }
async function inject(tabId, force = false) {
  const { active, draft, blacklist } = await state();
  if (!active || active.tabId !== tabId) return;
  const frames = await chrome.webNavigation.getAllFrames({ tabId }) || [];
  const top = frames.find(f => f.frameId === 0);
  if (!top || !WRR.cleanUrl(top.url)) throw new Error('无法访问主页面');
  if (WRR.isBlocked(top.url, blacklist)) throw new Error('当前网站在黑名单中');
  const covered = {}, pending = [];
  for (const f of frames.slice(0, 200)) {
    const url = WRR.cleanUrl(f.url), parent = frames.find(p => p.frameId === f.parentFrameId);
    if (!url) { pending.push({ id:f.frameId, url:'', reason:'特殊嵌入页面暂不支持', pattern:null }); continue; }
    if (WRR.blockedFrame(f, frames, blacklist)) {
      pending.push({id:f.frameId,url,reason:'已按网站黑名单排除',pattern:null});continue;
    }
    const known = active.covered?.[f.frameId];
    try {
      // Frame IDs survive navigation. Document IDs prevent accepting a stale recorder.
      if (force || !known || known.documentId !== f.documentId) {
        await chrome.scripting.executeScript({ target: { tabId, documentIds:[f.documentId] }, files:['core.js','content.js'] });
      }
      covered[f.frameId] = { id:f.frameId, parentId:f.parentFrameId, documentId:f.documentId, url, parentUrl:WRR.cleanUrl(parent?.url), topUrl:WRR.cleanUrl(top.url) };
    } catch (_) {
      if (f.frameId === 0) throw new Error('主页面权限不可用，请继续录制当前页');
      pending.push({ id:f.frameId, url, reason:'嵌入页面不可访问，请重试扫描或手动补充步骤', pattern:null });
    }
  }
  if (frames.length > 200) pending.push({id:-1,url:'',reason:'页面超过 200 个框架，部分未扫描',pattern:null});
  active.covered = covered; active.pending = pending;
  await chrome.storage.session.set({ active });
  // Preserve detected omissions, including intentionally excluded frames.
  const gaps = draft.coverageGaps || [];
  for (const item of pending) {
    if (!gaps.some(g => g.url === item.url && g.reason === item.reason)) gaps.push({url:item.url,reason:item.reason,at:new Date().toISOString()});
  }
  if (gaps.length) { draft.coverageGaps=gaps.slice(0,200); await chrome.storage.local.set({draft}); }
  if (force) await chrome.tabs.sendMessage(tabId, { type:'REFRESH' }).catch(() => {});
}
async function stop(active) {
  await chrome.storage.session.remove('active'); await badge(null);
  if (active) await chrome.tabs.sendMessage(active.tabId, { type: 'REFRESH' }).catch(() => {});
}
async function handle(message, sender) {
  let { draft, active, blacklist } = await state();
  const fromPopup = isPopup(sender);
  const frame = active?.covered?.[sender.frameId];
  let fromTarget = sender.id === chrome.runtime.id && sender.tab && active && sender.tab.id === active.tabId && frame && sender.documentId === frame.documentId;
  if (fromTarget) {
    const frames = await chrome.webNavigation.getAllFrames({tabId:active.tabId}) || [];
    const live = frames.find(f => f.frameId === sender.frameId && f.documentId === sender.documentId);
    fromTarget = !!live && !WRR.blockedFrame(live, frames, blacklist) && !WRR.isBlocked(sender.url, blacklist);
  }
  if (message.type === 'CONTENT_STATE') {
    return { active: !!fromTarget, recordingId: fromTarget ? (active.captureId || draft.id) : null, captureValues: fromTarget && draft.captureValues };
  }
  if (message.type === 'EVENT') {
    if (!fromTarget || !draft || message.recordingId !== (active.captureId || draft.id)) return { ignored: true };
    if (WRR.allSteps(draft).length >= 1500 || JSON.stringify(draft).length > 3500000) {
      draft.warning='录制已达到容量上限，请导出后新建录制。';
      await stop(active);await chrome.storage.local.set({draft});return {ignored:true};
    }
    // The sender's document, rather than a supplied URL, determines the origin.
    try { if (new URL(message.event.url).origin !== new URL(sender.url).origin) return { ignored: true }; } catch (_) { return { ignored: true }; }
    if (WRR.isBlocked(message.event.url, blacklist)) return {ignored:true};
    const event = WRR.normalizeEvent(message.event, draft.captureValues);
    if (!event) return { ignored: true };
    WRR.appendToRoute(draft, { ...event, pageUrl:frame.topUrl, frame:{...frame,url:event.url}, at: new Date().toISOString() }, active.routeId || 'main');
    if (WRR.allSteps(draft).length >= 1500 || JSON.stringify(draft).length > 3500000) {
      draft.warning = 'Recording stopped at the size limit. Export this segment before continuing.';
      await stop(active);
    }
    await chrome.storage.local.set({ draft });
    return { ok: true };
  }
  if (!fromPopup) throw new Error('This action is only available from the extension popup.');
  if (message.type === 'ADD_BLOCK' || message.type === 'REMOVE_BLOCK') {
    const host = WRR.blacklistHost(message.host);
    if (message.type === 'ADD_BLOCK') {
      if (!blacklist.includes(host)) {
        if (blacklist.length >= 100) throw new Error('黑名单最多保存 100 个网站');
        blacklist.push(host);
      }
    } else blacklist = blacklist.filter(item => item !== host);
    await chrome.storage.local.set({blacklist});
    if (active) {
      try { await inject(active.tabId, true); } catch (error) {
        draft.warning=error.message+'，录制已暂停。';
        await chrome.storage.local.set({draft});await stop(active);
      }
    }
    return state();
  }
  if (message.type === 'STATE') {
    // Popup polling also removes stale coverage entries after a drawer is closed.
    if (active) {
      try { await inject(active.tabId); } catch (_) {
        draft.warning='页面已变化，录制暂停。请点击“继续录制当前页”。';
        await chrome.storage.local.set({draft}); await stop(active);
      }
      return state();
    }
    return state();
  }
  if (message.type === 'SCAN_FRAMES') {
    if (active) await inject(active.tabId, true);
    return state();
  }
  if (message.type === 'START' || message.type === 'CONTINUE') {
    const tab = await chrome.tabs.get(message.tabId);
    if (!WRR.cleanUrl(tab.url)) throw new Error('请在普通 HTTP/HTTPS 网页使用，浏览器设置页和 PDF 阅读器不支持。');
    if (WRR.isBlocked(tab.url, blacklist)) throw new Error('当前网站在黑名单中，请先移除再开始录制。');
    if (message.type === 'START') {
      if (draft) throw new Error('已有录制，请先导出或清除，避免覆盖。');
      draft = { schemaVersion: 3, recorderVersion:chrome.runtime.getManifest().version, producer: 'windows-record-replay', id: crypto.randomUUID(), title: WRR.short(message.title || 'Browser workflow'), goal: WRR.short(message.goal, 1000), startedAt: new Date().toISOString(), captureValues: message.captureValues === true, steps: [] };
    } else if (!draft) throw new Error('没有可继续的录制。');
    if (WRR.allSteps(draft).length >= 1500 || JSON.stringify(draft).length > 3500000) throw new Error('本次录制已达到容量上限，请导出后新建录制。');
    WRR.routeSteps(draft);
    delete draft.warning;
    const old = active;
    active = { tabId: tab.id, routeId:draft.selectedRouteId || 'main', captureId:crypto.randomUUID(), topOrigin:new URL(tab.url).origin, covered:{}, pending:[] };
    WRR.appendToRoute(draft, { action: 'navigate', url: WRR.cleanUrl(tab.url), target: {}, reason: message.type === 'START' ? 'Recording started' : 'Recording continued here; actions during pause were not captured', at: new Date().toISOString() });
    await chrome.storage.local.set({ draft });
    await chrome.storage.session.set({ active });
    try { await inject(tab.id, true); } catch (error) { await stop(active); throw new Error('无法录制此页面：' + error.message); }
    if (old && old.tabId !== tab.id) await chrome.tabs.sendMessage(old.tabId, { type: 'REFRESH' }).catch(() => {});
    await badge(active); return state();
  }
  if (message.type === 'STOP') {
    await stop(active);
    if (draft) { draft.stoppedAt = new Date().toISOString(); await chrome.storage.local.set({ draft }); }
    return state();
  }
  if (message.type === 'CLEAR') { await stop(active); await chrome.storage.local.remove('draft'); return state(); }
  if (['CREATE_BRANCH','SELECT_ROUTE','UPDATE_BRANCH','REMOVE_BRANCH','REMOVE_STEP','INSERT_WAIT'].includes(message.type)) {
    if (active) throw new Error('请先停止录制，再创建分支、切换路线或编辑。');
    if (!draft) throw new Error('请先创建录制。');
    const routeId = draft.selectedRouteId || 'main';
    const steps = WRR.routeSteps(draft, routeId);
    if (message.type === 'CREATE_BRANCH') {
      if ((draft.branches || []).length >= 20) throw new Error('每次录制最多创建 20 个分支');
      if (!steps.some(s => s.id === message.afterStepId)) throw new Error('请选择当前路线中的分支起点');
      const condition = WRR.short(message.condition, 500);
      if (!condition) throw new Error('请填写什么情况下走这条分支');
      const branch = {id:crypto.randomUUID(),name:WRR.short(message.name,80) || '分支 '+((draft.branches || []).length+1),condition,parentBranchId:routeId,afterStepId:message.afterStepId,steps:[]};
      if(draft.schemaVersion<2)draft.schemaVersion=2;draft.branches ||= [];draft.branches.push(branch);draft.selectedRouteId=branch.id;
    }
    if (message.type === 'SELECT_ROUTE') {
      WRR.routeSteps(draft, message.routeId);draft.selectedRouteId=message.routeId;
    }
    if (message.type === 'UPDATE_BRANCH') {
      const branch=(draft.branches || []).find(b => b.id===message.branchId);
      if (!branch) throw new Error('找不到分支');
      const condition=WRR.short(message.condition,500);
      if (!condition) throw new Error('请填写什么情况下走这条分支');
      branch.name=WRR.short(message.name,80) || branch.name;branch.condition=condition;
    }
    if (message.type === 'REMOVE_BRANCH') {
      const branch=(draft.branches || []).find(b => b.id===message.branchId);
      if (!branch) throw new Error('找不到分支');
      const ids=WRR.branchDescendants(draft,branch.id);
      draft.branches=draft.branches.filter(b=>!ids.has(b.id));
      if (ids.has(routeId)) draft.selectedRouteId=branch.parentBranchId;
    }
    if (message.type === 'REMOVE_STEP') {
      if ((draft.branches || []).some(b=>b.afterStepId===message.id)) throw new Error('这一步是分支起点，请先删除它关联的分支。');
      const index=steps.findIndex(s=>s.id===message.id);if(index>=0)steps.splice(index,1);
    }
    if (message.type === 'INSERT_WAIT') {
      if (WRR.allSteps(draft).length >= 1500 || JSON.stringify(draft).length > 3500000) throw new Error('录制已达到容量上限，请导出后新建录制。');
      if (!Number.isInteger(message.seconds) || message.seconds < 1 || message.seconds > 3600) throw new Error('等待时间必须是 1 到 3600 秒的整数');
      const after=steps.find(step=>step.id===message.afterStepId);
      if (!after) throw new Error('找不到要插入等待的位置');
      WRR.insertAfter(draft,message.afterStepId,{action:'wait',seconds:message.seconds,url:after.url,target:{},at:new Date().toISOString()},routeId);
    }
    await chrome.storage.local.set({draft});return state();
  }
  if (message.type === 'NOTE') {
    if (!draft) throw new Error('请先创建录制。');
    if (WRR.allSteps(draft).length >= 1500 || JSON.stringify(draft).length > 3500000) throw new Error('录制已达到容量上限，请导出后新建录制。');
    const last = WRR.routePath(draft).at(-1);
    if (last && WRR.short(message.note)) { WRR.appendToRoute(draft, { action:'note', url:last.url, target:{}, note:WRR.short(message.note,500), at:new Date().toISOString() }); await chrome.storage.local.set({draft}); }
    return state();
  }
  throw new Error('Unknown action');
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  serialized(() => handle(message, sender)).then(data => respond({ ok: true, ...data }), error => respond({ ok: false, error: error.message }));
  return true;
});
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status !== 'complete') return;
  serialized(async () => {
    const { active } = await state();
    if (active && active.tabId === tabId) {
      try { await inject(tabId); } catch (_) {
        const { draft } = await state();
        if (draft) { draft.warning = '页面权限已改变，录制已暂停。点击扩展中的“继续录制当前页”。'; await chrome.storage.local.set({ draft }); }
        await stop(active);
      }
    }
  });
});
chrome.tabs.onRemoved.addListener(tabId => serialized(async () => {
  const { active } = await state(); if (active && active.tabId === tabId) await stop(active);
}));
// Dynamic drawers often load an iframe without any top-level page navigation.
chrome.webNavigation.onDOMContentLoaded.addListener(details => {
  serialized(async () => {
    const {active}=await state();
    if (!active || active.tabId !== details.tabId) return;
    try { await inject(active.tabId); } catch (_) {
      const {draft}=await state();
      if (draft) {draft.warning='页面已变化，录制暂停。请点击“继续录制当前页”。';await chrome.storage.local.set({draft});}
      await stop(active);
    }
  });
});
chrome.runtime.onStartup.addListener(() => badge(null));
