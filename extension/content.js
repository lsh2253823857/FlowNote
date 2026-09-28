(() => {
  if (globalThis.__wrrRecorder) { globalThis.__wrrRecorder.refresh(); return; }
  let recording = false, recordingId = null, captureValues = false, lastUrl = '', indicator;
  function send(event) {
    if (!recording) return;
    chrome.runtime.sendMessage({ type: 'EVENT', recordingId, event: { ...event, url: location.href } }).catch(() => {});
  }
  function attr(element, name) { return element.getAttribute(name) || ''; }
  function selector(element) {
    const candidates = [];
    if (element.id) candidates.push('#' + CSS.escape(element.id));
    for (const key of ['data-testid','name','aria-label']) {
      const value = attr(element,key); if (value) candidates.push(element.localName + '[' + key + '=' + JSON.stringify(value) + ']');
    }
    for (const candidate of candidates) { try { if (document.querySelectorAll(candidate).length === 1) return candidate; } catch (_) {} }
    const parts = []; let current = element;
    for (let depth = 0; current && current.nodeType === 1 && depth < 6; depth++, current = current.parentElement) {
      let part = current.localName;
      if (current.id) { parts.unshift('#' + CSS.escape(current.id)); break; }
      const siblings = current.parentElement ? [...current.parentElement.children].filter(x => x.localName === current.localName) : [];
      if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(current)+1) + ')';
      parts.unshift(part);
    }
    return parts.join(' > ');
  }
  function target(element) {
    const label = element.labels ? [...element.labels].map(x => x.textContent).join(' ') : '';
    const labelled = attr(element,'aria-labelledby').split(/\s+/).filter(Boolean).map(id => document.getElementById(id)?.textContent || '').join(' ');
    const tag = element.localName;
    const name = attr(element,'aria-label') || labelled || label || (['button','a','option','span'].includes(tag) || attr(element,'role') === 'button' ? element.textContent : '') || attr(element,'title') || (element.children.length < 3 && element.textContent.length <= 100 && !element.matches('input,textarea,[contenteditable]') ? element.textContent : '');
    return { tag, role: attr(element,'role'), name: WRR.short(name), label: WRR.short(label), placeholder: WRR.short(attr(element,'placeholder')), inputType: attr(element,'type'), selector: selector(element), testId: WRR.short(attr(element,'data-testid')), fieldName: WRR.short(attr(element,'name')) };
  }
  function field(element) {
    if (!(element instanceof Element)) return;
    if (!element.matches('input,textarea,select,[contenteditable="true"]')) return;
    const t = target(element);
    const secret = t.inputType === 'password' || WRR.sensitive.test([t.name,t.label,t.fieldName,t.placeholder,attr(element,'autocomplete')].join(' '));
    if (secret) { send({ action:'manual',target:t,reason:'Sensitive field: complete manually; value was not recorded.' }); return; }
    if (t.inputType === 'file') { send({ action:'manual',target:t,reason:'File selection: supply a new local file at replay time.' }); return; }
    if (['checkbox','radio'].includes(t.inputType)) { send({ action:'check',target:t,checked:element.checked }); return; }
    if (element.localName === 'select' && element.multiple) { send({ action:'manual',target:t,reason:'Multi-select: select the desired options at replay time.' }); return; }
    const event = { action:element.localName === 'select' ? 'select' : 'fill',target:t };
    if (captureValues) event.value = String(element.isContentEditable ? element.textContent : element.value).slice(0,4000);
    send(event);
  }
  function onClick(e) {
    if (!recording || !e.isTrusted) return;
    let el = e.composedPath()[0];
    if (!(el instanceof Element) || el.closest('[data-wrr-indicator]')) return;
    if (el.getRootNode() !== document) { send({action:'manual',target:{},reason:'Shadow DOM interaction: inspect the live browser at replay time.'}); return; }
    el = el.closest('button,a,input,select,textarea,[role="button"],[role="link"],[contenteditable="true"]') || el;
    if (el.matches('input,textarea,select,[contenteditable="true"]')) return;
    send({action:'click',target:target(el),href:el.href,submitLike:el.matches('button') && el.type === 'submit' && !!el.form});
  }
  document.addEventListener('click',onClick,true);
  document.addEventListener('input',e => { if (recording && e.isTrusted) field(e.target); },true);
  document.addEventListener('change',e => { if (recording && e.isTrusted) field(e.target); },true);
  document.addEventListener('submit',e => { if (recording && e.isTrusted) send({action:'submit',target:target(e.target)}); },true);
  document.addEventListener('keydown',e => {
    if (!recording || !e.isTrusted || !['Enter','Escape'].includes(e.key) || e.isComposing) return;
    const el = e.target;
    if (!(el instanceof Element) || el.localName === 'textarea' || el.isContentEditable) return;
    if (WRR.sensitive.test([attr(el,'type'),attr(el,'name'),attr(el,'autocomplete')].join(' '))) return;
    send({action:'keypress',target:target(el),key:e.key});
  },true);
  async function refresh() {
    try {
      const response = await chrome.runtime.sendMessage({type:'CONTENT_STATE'});
      recording = response.active === true; recordingId = response.recordingId; captureValues = response.captureValues === true;
      if (recording) {
        if (window === window.top && (!indicator || !indicator.isConnected)) {
          indicator = document.createElement('div'); indicator.setAttribute('data-wrr-indicator','');
          indicator.textContent = '● 录制中 · 点击扩展图标停止';
          indicator.style.cssText = 'position:fixed!important;bottom:16px!important;right:16px!important;z-index:2147483647!important;background:#972c2c!important;color:#fff!important;border-radius:10px!important;padding:10px 14px!important;font:13px sans-serif!important;pointer-events:none!important;box-shadow:0 3px 20px #0003!important';
          document.documentElement.appendChild(indicator);
        }
        if (location.href !== lastUrl) { lastUrl = location.href; send({action:'navigate',target:{}}); }
      } else if (indicator) { indicator.remove(); indicator = null; }
    } catch (_) { recording = false; indicator?.remove(); }
  }
  chrome.runtime.onMessage.addListener(message => { if (message.type === 'REFRESH') refresh(); });
  // Covers History API routes without patching the website's JavaScript.
  setInterval(() => { if (recording && location.href !== lastUrl) { lastUrl=location.href; send({action:'navigate',target:{},reason:'URL changed; query/fragment values are not retained'}); } },500);
  globalThis.__wrrRecorder = {refresh}; refresh();
})();
