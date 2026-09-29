(() => {
  if (globalThis.__wrrRecorder) { globalThis.__wrrRecorder.refresh(); return; }
  let recording = false, recordingId = null, captureValues = false, lastUrl = '', indicator;
  let pointerGesture = null, nativeDrag = null, lastDragAt = 0, lastRangeDragAt = 0;
  let scrollStates = new WeakMap();
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
  function clamp(value) { return Math.max(0,Math.min(1,value)); }
  function relativePoint(element, x, y) {
    const rect=element.getBoundingClientRect();
    if (!rect.width || !rect.height) return {x:.5,y:.5};
    return {x:Math.round(clamp((x-rect.left)/rect.width)*10000)/10000,y:Math.round(clamp((y-rect.top)/rect.height)*10000)/10000};
  }
  function gestureElement(element) {
    if (!(element instanceof Element)) return null;
    return element.closest('input[type="range"],canvas,[draggable="true"],[role="slider"],[role="option"],[role="listitem"],li') || element;
  }
  function dropElement(element) {
    if (!(element instanceof Element)) return document.documentElement;
    return element.closest('[draggable="true"],[role="option"],[role="listitem"],li') || element;
  }
  function dragType(source, destination) {
    if (source.matches('input[type="range"],[role="slider"]')) return 'range';
    if (source.localName === 'canvas') return 'canvas';
    if (source.draggable || source.matches('[role="option"],[role="listitem"],li') || destination?.matches('[draggable="true"],[role="option"],[role="listitem"],li')) return 'sort';
    return 'element';
  }
  function simplifiedPath(points, canvas, start, end) {
    const source=points.length>=2 ? points : [start,end];
    const count=Math.min(24,source.length),result=[];
    for(let i=0;i<count;i++){
      const index=count===1 ? 0 : Math.round(i*(source.length-1)/(count-1));
      const point=relativePoint(canvas,source[index].x,source[index].y),previous=result.at(-1);
      if(!previous || previous.x!==point.x || previous.y!==point.y)result.push(point);
    }
    if(result.length<2){result.length=0;result.push(relativePoint(canvas,start.x,start.y),relativePoint(canvas,end.x,end.y));}
    return result;
  }
  function sendDrag(source, destination, start, end, path = []) {
    const type=dragType(source,destination),event={action:'drag',dragType:type,target:target(source),start:relativePoint(source,start.x,start.y),end:relativePoint(type==='range'||type==='canvas'?source:destination,end.x,end.y)};
    if(type==='element' && String(window.getSelection?.() || '').trim())return;
    if(type==='range'){
      if(captureValues && 'value' in source)event.value=String(source.value).slice(0,4000);
      lastRangeDragAt=Date.now();
    } else if(type!=='canvas') {
      event.dropTarget=target(destination);
      const rect=destination.getBoundingClientRect(),before=rect.width>rect.height*1.5 ? end.x<rect.left+rect.width/2 : end.y<rect.top+rect.height/2;
      event.position=type==='sort' ? (before?'before':'after') : 'inside';
    }
    if(type==='canvas')event.path=simplifiedPath(path,source,start,end);
    send(event);lastDragAt=Date.now();
  }
  function onPointerDown(event) {
    if(!recording || !event.isTrusted || event.button!==0)return;
    const raw=event.composedPath()[0],source=gestureElement(raw);
    if(!source || source.closest('[data-wrr-indicator]'))return;
    pointerGesture={pointerId:event.pointerId,source,start:{x:event.clientX,y:event.clientY},last:{x:event.clientX,y:event.clientY},path:[{x:event.clientX,y:event.clientY}]};
  }
  function onPointerMove(event) {
    if(!pointerGesture || event.pointerId!==pointerGesture.pointerId)return;
    pointerGesture.last={x:event.clientX,y:event.clientY};
    const previous=pointerGesture.path.at(-1);
    if(pointerGesture.source.localName==='canvas' && pointerGesture.path.length<96 && Math.hypot(event.clientX-previous.x,event.clientY-previous.y)>=4)pointerGesture.path.push({x:event.clientX,y:event.clientY});
  }
  function onPointerUp(event) {
    if(!pointerGesture || event.pointerId!==pointerGesture.pointerId)return;
    const gesture=pointerGesture;pointerGesture=null;
    const end={x:event.clientX,y:event.clientY};
    if(Math.hypot(end.x-gesture.start.x,end.y-gesture.start.y)<8)return;
    if(gesture.source.getRootNode()!==document){send({action:'manual',target:{},reason:'Shadow DOM drag: inspect the live browser and complete manually.'});return;}
    const destination=dropElement(document.elementFromPoint(end.x,end.y) || event.composedPath()[0]);
    sendDrag(gesture.source,destination,gesture.start,end,gesture.path.concat(end));
  }
  function onDragStart(event) {
    if(!recording || !event.isTrusted)return;
    const source=gestureElement(event.composedPath()[0]);
    if(!source || event.dataTransfer?.files?.length)return;
    if(source.getRootNode()!==document){send({action:'manual',target:{},reason:'Shadow DOM drag: inspect the live browser and complete manually.'});return;}
    const rect=source.getBoundingClientRect(),x=event.clientX||rect.left+rect.width/2,y=event.clientY||rect.top+rect.height/2;
    nativeDrag={source,start:{x,y},last:{x,y}};pointerGesture=null;
  }
  function finishNativeDrag(event) {
    if(event.dataTransfer?.files?.length){nativeDrag=null;pointerGesture=null;send({action:'manual',target:target(dropElement(event.composedPath()[0])),reason:'File drop: supply a new local file at replay time; file paths were not recorded.'});return;}
    if(!nativeDrag)return;
    const gesture=nativeDrag;nativeDrag=null;
    const end={x:event.clientX||gesture.last.x,y:event.clientY||gesture.last.y},destination=dropElement(document.elementFromPoint(end.x,end.y) || event.composedPath()[0]);
    sendDrag(gesture.source,destination,gesture.start,end);
  }
  function onScroll(event) {
    if(!recording)return;
    const page=event.target===document,element=page ? document.scrollingElement : event.target;
    if(!(element instanceof Element) || element.closest?.('[data-wrr-indicator]'))return;
    const existing=scrollStates.get(element) || {timer:null,lastX:null,lastY:null};
    clearTimeout(existing.timer);
    const scheduledRecordingId=recordingId;
    existing.timer=setTimeout(()=>{
      if(!recording || recordingId!==scheduledRecordingId)return;
      const x=page ? window.scrollX : element.scrollLeft,y=page ? window.scrollY : element.scrollTop;
      if(existing.lastX!==null && Math.abs(x-existing.lastX)<24 && Math.abs(y-existing.lastY)<24)return;
      const maxX=Math.max(0,element.scrollWidth-element.clientWidth),maxY=Math.max(0,element.scrollHeight-element.clientHeight);
      send({action:'scroll',target:target(element),scrollX:Math.max(0,x),scrollY:Math.max(0,y),xRatio:maxX?clamp(x/maxX):0,yRatio:maxY?clamp(y/maxY):0,page});
      existing.lastX=x;existing.lastY=y;
    },300);
    scrollStates.set(element,existing);
  }
  function field(element) {
    if (!(element instanceof Element)) return;
    if (!element.matches('input,textarea,select,[contenteditable="true"]')) return;
    if(element.matches('input[type="range"]') && (pointerGesture?.source===element || Date.now()-lastRangeDragAt<400))return;
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
    if(Date.now()-lastDragAt<400)return;
    let el = e.composedPath()[0];
    if (!(el instanceof Element) || el.closest('[data-wrr-indicator]')) return;
    if (el.getRootNode() !== document) { send({action:'manual',target:{},reason:'Shadow DOM interaction: inspect the live browser at replay time.'}); return; }
    el = el.closest('button,a,input,select,textarea,[role="button"],[role="link"],[contenteditable="true"]') || el;
    if (el.matches('input,textarea,select,[contenteditable="true"]')) return;
    send({action:'click',target:target(el),href:el.href,submitLike:el.matches('button') && el.type === 'submit' && !!el.form});
  }
  document.addEventListener('click',onClick,true);
  document.addEventListener('pointerdown',onPointerDown,true);
  document.addEventListener('pointermove',onPointerMove,true);
  document.addEventListener('pointerup',onPointerUp,true);
  document.addEventListener('pointercancel',event=>{if(pointerGesture?.pointerId===event.pointerId)pointerGesture=null;},true);
  document.addEventListener('dragstart',onDragStart,true);
  document.addEventListener('dragover',event=>{if(nativeDrag)nativeDrag.last={x:event.clientX,y:event.clientY};},true);
  document.addEventListener('drop',finishNativeDrag,true);
  document.addEventListener('dragend',finishNativeDrag,true);
  document.addEventListener('scroll',onScroll,true);
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
      if(response.recordingId!==recordingId)scrollStates=new WeakMap();
      recording = response.active === true; recordingId = response.recordingId; captureValues = response.captureValues === true;
      if (recording) {
        if (window === window.top && (!indicator || !indicator.isConnected)) {
          indicator = document.createElement('div'); indicator.setAttribute('data-wrr-indicator','');
          indicator.textContent = '● 录制中 · 点击扩展图标停止';
          indicator.style.cssText = 'position:fixed!important;bottom:16px!important;right:16px!important;z-index:2147483647!important;background:#972c2c!important;color:#fff!important;border-radius:10px!important;padding:10px 14px!important;font:13px sans-serif!important;pointer-events:none!important;box-shadow:0 3px 20px #0003!important';
          document.documentElement.appendChild(indicator);
        }
        if (location.href !== lastUrl) { lastUrl = location.href; send({action:'navigate',target:{}}); }
      } else {pointerGesture=null;nativeDrag=null;scrollStates=new WeakMap();if(indicator){indicator.remove();indicator=null;}}
    } catch (_) { recording = false; indicator?.remove(); }
  }
  chrome.runtime.onMessage.addListener(message => { if (message.type === 'REFRESH') refresh(); });
  // Covers History API routes without patching the website's JavaScript.
  setInterval(() => { if (recording && location.href !== lastUrl) { lastUrl=location.href; send({action:'navigate',target:{},reason:'URL changed; query/fragment values are not retained'}); } },500);
  globalThis.__wrrRecorder = {refresh}; refresh();
})();
