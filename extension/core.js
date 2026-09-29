/* Shared pure helpers, also exercised outside Chrome. */
(function (root) {
  const sensitive = /password|passwd|secret|token|authorization|api.?key|otp|one.?time|credit.?card|cc.?number|cvc|cvv|密码|口令|验证码|密钥|卡号/i;
  function cleanUrl(raw) {
    try {
      const u = new URL(raw);
      if (!/^https?:$/.test(u.protocol)) return null;
      u.username = ''; u.password = '';
      // Query values and fragments may contain session credentials. Keep parameter names only.
      for (const key of [...u.searchParams.keys()]) u.searchParams.set(key, '[parameter]');
      u.hash = '';
      return u.href;
    } catch (_) { return null; }
  }
  function short(value, max = 180) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max); }
  function normalizedTarget(raw) {
    const source = raw && typeof raw === 'object' ? raw : {}, result = {};
    for (const key of ['tag','role','name','label','placeholder','inputType','selector','testId','fieldName']) {
      if (typeof source[key] === 'string') result[key] = short(source[key], key === 'selector' ? 500 : 180);
    }
    return result;
  }
  function normalizedPoint(raw, relativeTo) {
    if (!raw || typeof raw !== 'object' || !Number.isFinite(raw.x) || !Number.isFinite(raw.y) || raw.x < 0 || raw.x > 1 || raw.y < 0 || raw.y > 1) return null;
    if (raw.relativeTo !== undefined && raw.relativeTo !== relativeTo) return null;
    return {x:Math.round(raw.x * 10000) / 10000,y:Math.round(raw.y * 10000) / 10000,relativeTo};
  }
  function normalizeEvent(raw, captureValues) {
    if (!raw || !['navigate','click','fill','select','check','submit','keypress','manual','note','wait','drag','scroll'].includes(raw.action)) return null;
    const url = cleanUrl(raw.url);
    if (!url) return null;
    const target = normalizedTarget(raw.target);
    const secret = target.inputType === 'password' || sensitive.test([target.name,target.label,target.fieldName,target.placeholder,raw.autocomplete].join(' '));
    const event = { action: raw.action, url, target };
    if (raw.action === 'manual') event.reason = short(raw.reason, 300);
    if (raw.action === 'note') event.note = short(raw.note, 500);
    if (raw.action === 'keypress') {
      if (!['Enter','Escape','Tab','ArrowDown','ArrowUp'].includes(raw.key)) return null;
      event.key = raw.key;
    }
    if (['fill','select'].includes(raw.action)) {
      if (secret) { event.action = 'manual'; event.reason = 'Sensitive field: complete manually; value was not recorded.'; }
      else if (captureValues && typeof raw.value === 'string') event.value = raw.value.slice(0, 4000);
      else event.parameter = true;
    }
    if (raw.action === 'check') event.checked = !!raw.checked;
    if (raw.href) event.href = cleanUrl(raw.href);
    if (raw.action === 'navigate' && raw.reason) event.reason = short(raw.reason, 300);
    if (raw.action === 'click' && raw.submitLike) event.submitLike = true;
    if (raw.action === 'wait') {
      if (!Number.isInteger(raw.seconds) || raw.seconds < 1 || raw.seconds > 3600) return null;
      event.seconds = raw.seconds;
    }
    if (raw.action === 'drag') {
      if (!['range','sort','element','canvas'].includes(raw.dragType)) return null;
      if (raw.dragType === 'range' && secret) { event.action='manual';event.reason='Sensitive field: complete manually; value was not recorded.';return event; }
      if (raw.coordinateSystem !== undefined && (!raw.coordinateSystem || typeof raw.coordinateSystem !== 'object' || raw.coordinateSystem.unit !== 'ratio' || raw.coordinateSystem.origin !== 'top-left')) return null;
      const endReference=['sort','element'].includes(raw.dragType) ? 'dropTarget' : 'source';
      const strategy={range:'set-value-first',sort:'semantic-drop-first',element:'semantic-drop-first',canvas:'path-first'}[raw.dragType];
      if (raw.replayStrategy !== undefined && raw.replayStrategy !== strategy) return null;
      const start=normalizedPoint(raw.start,'source'),end=normalizedPoint(raw.end,endReference);
      if (!start || !end) return null;
      event.dragType=raw.dragType;event.coordinateSystem={unit:'ratio',origin:'top-left'};event.start=start;event.end=end;event.replayStrategy=strategy;
      if (['sort','element'].includes(raw.dragType) && (!raw.dropTarget || typeof raw.dropTarget!=='object')) return null;
      if (raw.dropTarget) event.dropTarget=normalizedTarget(raw.dropTarget);
      if (raw.position) {
        if (!['before','after','inside'].includes(raw.position)) return null;
        event.position=raw.position;
      }
      if (['sort','element'].includes(raw.dragType) && !event.position) return null;
      if (raw.dragType === 'canvas') {
        if (!Array.isArray(raw.path) || raw.path.length < 2 || raw.path.length > 24) return null;
        event.path=[];
        for (const item of raw.path) {const point=normalizedPoint(item,'source');if(!point)return null;event.path.push(point);}
      }
      if (raw.dragType === 'range') {
        if (captureValues && typeof raw.startValue === 'string') event.startValue=raw.startValue.slice(0,4000);
        const targetValue=typeof raw.targetValue === 'string' ? raw.targetValue : raw.value;
        if (captureValues && typeof targetValue === 'string') event.targetValue=targetValue.slice(0,4000);
        else event.parameter=true;
      }
    }
    if (raw.action === 'scroll') {
      if (![raw.scrollX,raw.scrollY,raw.xRatio,raw.yRatio].every(Number.isFinite) || raw.scrollX < 0 || raw.scrollY < 0 || raw.xRatio < 0 || raw.xRatio > 1 || raw.yRatio < 0 || raw.yRatio > 1) return null;
      event.scrollX=Math.round(raw.scrollX);event.scrollY=Math.round(raw.scrollY);
      event.xRatio=Math.round(raw.xRatio*10000)/10000;event.yRatio=Math.round(raw.yRatio*10000)/10000;event.page=raw.page===true;
    }
    return event;
  }
  function append(steps, event) {
    const previous = steps[steps.length - 1];
    // chrome.storage may reorder object keys; compare fields rather than JSON insertion order.
    const oldTarget = previous?.target || {}, newTarget = event.target || {};
    const sameFrame = previous && (previous.frame?.id || 0) === (event.frame?.id || 0) && (previous.frame?.documentId || '') === (event.frame?.documentId || '');
    const sameTarget = sameFrame && previous.url === event.url && [...new Set([...Object.keys(oldTarget), ...Object.keys(newTarget)])].every(key => oldTarget[key] === newTarget[key]);
    if (sameTarget && ['fill','select','check','scroll'].includes(event.action) && previous.action === event.action) {
      steps[steps.length - 1] = { ...event, id: previous.id }; return;
    }
    if (sameFrame && event.action === 'navigate' && previous.action === 'navigate' && previous.url === event.url) return;
    if (sameTarget && event.action === 'manual' && previous.action === 'manual' && previous.reason === event.reason) return;
    steps.push({ ...event, id: steps.length + 1 });
  }
  function blacklistHost(value) {
    const raw = String(value || '').trim();
    if (!raw || raw.length > 2048 || /\s|\*/.test(raw)) throw new Error('请输入网站域名或完整 HTTP(S) 网址');
    let u;
    try { u = new URL(raw.includes('://') ? raw : 'https://' + raw); } catch { throw new Error('网站地址格式不正确'); }
    if (!/^https?:$/.test(u.protocol) || !u.hostname || u.username || u.password) throw new Error('请输入普通 HTTP(S) 网站');
    return u.hostname.toLowerCase().replace(/\.$/, '');
  }
  function isBlocked(url, blacklist) {
    try { const host = new URL(url).hostname.toLowerCase().replace(/\.$/, ''); return blacklist.some(rule => host === rule || host.endsWith('.' + rule)); } catch { return false; }
  }
  function blockedFrame(frame, frames, blacklist) {
    const seen = new Set();
    while (frame && !seen.has(frame.frameId)) {
      if (isBlocked(frame.url, blacklist)) return true;
      seen.add(frame.frameId); frame = frames.find(f => f.frameId === frame.parentFrameId);
    }
    return false;
  }
  function routeSteps(draft, routeId = draft.selectedRouteId || 'main') {
    if (routeId === 'main') return draft.steps;
    const route = (draft.branches || []).find(b => b.id === routeId);
    if (!route) throw new Error('这条分支不存在');
    return route.steps;
  }
  function allSteps(draft) { return [draft.steps, ...(draft.branches || []).map(b => b.steps)].flat(); }
  function routePath(draft, routeId = draft.selectedRouteId || 'main', seen = new Set()) {
    if (routeId === 'main') return draft.steps;
    if (seen.has(routeId)) throw new Error('分支关系存在循环');
    seen.add(routeId);
    const route = (draft.branches || []).find(b => b.id === routeId);
    if (!route) throw new Error('这条分支不存在');
    const parent = routePath(draft, route.parentBranchId, seen);
    const index = parent.findIndex(s => s.id === route.afterStepId);
    if (index < 0) throw new Error('找不到分支起点');
    return parent.slice(0, index + 1).concat(route.steps);
  }
  function appendToRoute(draft, event, routeId = draft.selectedRouteId || 'main') {
    const steps = routeSteps(draft, routeId), before = steps.length;
    const next = Math.max(draft.nextStepId || 1, ...allSteps(draft).map(s => s.id + 1));
    // A branch anchor is immutable: coalescing a later input must not change its meaning.
    const anchored = steps.length && (draft.branches || []).some(b => b.afterStepId === steps.at(-1).id);
    if (anchored) steps.push({...event, id:next});
    else append(steps, event);
    if (steps.length > before) { steps.at(-1).id = next; draft.nextStepId = next + 1; }
  }
  function insertAfter(draft, afterStepId, event, routeId = draft.selectedRouteId || 'main') {
    const steps = routeSteps(draft, routeId), index = steps.findIndex(step => step.id === afterStepId);
    if (index < 0) throw new Error('找不到要插入等待的位置');
    const next = Math.max(draft.nextStepId || 1, ...allSteps(draft).map(step => step.id + 1));
    steps.splice(index + 1, 0, {...event, id:next});
    draft.nextStepId = next + 1;
    return steps[index + 1];
  }
  function branchDescendants(draft, branchId) {
    const ids = new Set([branchId]);
    for (let i = 0; i < (draft.branches || []).length; i++) {
      for (const b of draft.branches) if (ids.has(b.parentBranchId)) ids.add(b.id);
    }
    return ids;
  }
  const api = { sensitive, cleanUrl, short, normalizeEvent, append, blacklistHost, isBlocked, blockedFrame, routeSteps, routePath, allSteps, appendToRoute, insertAfter, branchDescendants };
  root.WRR = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
