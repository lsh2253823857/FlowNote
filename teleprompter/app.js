import {
  LIMITS, clamp, estimatedSeconds, formatDuration, nextOffset,
  normalizeSettings, offsetFromDrag, scrollProgress, visibleLength
} from './core.mjs';

const STORAGE_KEY = 'shunci-teleprompter-v1';
const $ = id => document.getElementById(id);
const state = {
  settings: normalizeSettings(),
  playing: false,
  offset: 0,
  maximum: 0,
  lastFrame: 0,
  raf: 0,
  countdownTimer: 0,
  wakeLock: null,
  installPrompt: null,
  toastTimer: 0,
  scrub: { active: false, pointerId: null, startY: 0, startOffset: 0, wasPlaying: false, moved: false },
  suppressClickUntil: 0,
  seekWasPlaying: false
};

const sample = `大家好，今天想和你分享一个很实用的小方法。\n\n面对镜头时，不要急着把每句话都背下来。先想清楚你最想让观众记住什么，再用自己的话把它讲出来。\n\n提词器不是为了让你念稿，而是帮你在忘词的时候，快速找回节奏。看着镜头，放慢一点，就像在和屏幕对面的一个朋友聊天。\n\n准备好了吗？深呼吸，我们现在开始。`;

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    $('scriptTitle').value = typeof saved.title === 'string' ? saved.title : '';
    $('scriptInput').value = typeof saved.text === 'string' ? saved.text : '';
    state.settings = normalizeSettings(saved.settings);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    title: $('scriptTitle').value.trim(),
    text: $('scriptInput').value,
    settings: state.settings
  }));
}

function toast(message) {
  clearTimeout(state.toastTimer);
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  state.toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 1900);
}

function renderSettings() {
  const { speed, fontSize, mirror, landscape, countdown } = state.settings;
  $('speedValue').textContent = `${(speed / 180).toFixed(1)}×`;
  $('speedWpm').textContent = speed;
  $('fontValue').textContent = fontSize;
  $('mirrorToggle').checked = mirror;
  $('landscapeToggle').checked = landscape;
  $('countdownToggle').checked = countdown;
  $('liveSpeed').textContent = `${(speed / 180).toFixed(1)}×`;
  $('liveFont').textContent = `${fontSize}px`;
  $('scriptDisplay').style.setProperty('--prompt-size', `${fontSize}px`);
  $('scriptDisplay').classList.toggle('mirrored', mirror);
}

function renderMeta() {
  const text = $('scriptInput').value;
  $('charCount').textContent = visibleLength(text).toLocaleString('zh-CN');
  $('durationEstimate').textContent = formatDuration(estimatedSeconds(text, state.settings.speed));
  save();
}

function adjust(key, delta) {
  const [min, max] = LIMITS[key];
  state.settings[key] = clamp(state.settings[key] + delta, min, max);
  renderSettings();
  renderMeta();
  if (!$('promptScreen').hidden) requestAnimationFrame(measureScroll);
}

function measureScroll() {
  const zone = $('readingZone');
  state.maximum = Math.max(0, $('scriptDisplay').scrollHeight - zone.clientHeight * 0.47);
  state.offset = Math.min(state.offset, state.maximum);
  applyOffset();
}

function applyOffset() {
  $('scriptDisplay').style.translate = `0 ${-state.offset}px`;
  const progress = scrollProgress(state.offset, state.maximum);
  $('progressSlider').value = String(Math.round(progress * 1000));
  $('progressSlider').style.setProperty('--progress', `${progress * 100}%`);
  if (progress >= 1 && state.playing) finish();
}

function frame(time) {
  if (!state.playing) return;
  if (!state.lastFrame) state.lastFrame = time;
  const elapsed = Math.min(100, time - state.lastFrame);
  state.lastFrame = time;
  state.offset = nextOffset(state.offset, elapsed, state.settings.speed, state.settings.fontSize, state.maximum);
  applyOffset();
  if (state.playing) state.raf = requestAnimationFrame(frame);
}

async function requestWakeLock() {
  if (window.AndroidTeleprompter?.keepScreenOn) {
    window.AndroidTeleprompter.keepScreenOn(true);
    return;
  }
  if (!('wakeLock' in navigator) || state.wakeLock) return;
  try {
    state.wakeLock = await navigator.wakeLock.request('screen');
    state.wakeLock.addEventListener('release', () => { state.wakeLock = null; });
  } catch { /* Android browsers without permission continue normally. */ }
}

async function releaseWakeLock() {
  if (window.AndroidTeleprompter?.keepScreenOn) {
    window.AndroidTeleprompter.keepScreenOn(false);
    return;
  }
  try { await state.wakeLock?.release(); } catch { /* already released */ }
  state.wakeLock = null;
}

function setPlaying(playing) {
  if ($('promptScreen').hidden || !$('countdown').hidden) return;
  state.playing = playing;
  $('promptScreen').dataset.playing = String(playing);
  $('playState').innerHTML = `<i></i> ${playing ? '提词中' : '已暂停'}`;
  cancelAnimationFrame(state.raf);
  state.lastFrame = 0;
  if (playing) {
    $('finishCard').hidden = true;
    requestWakeLock();
    state.raf = requestAnimationFrame(frame);
  } else {
    releaseWakeLock();
  }
}

function togglePlaying() { setPlaying(!state.playing); }

function beginScrub(event) {
  if (!event.isPrimary || !$('countdown').hidden || !$('finishCard').hidden) return;
  state.scrub = {
    active: true,
    pointerId: event.pointerId,
    startY: event.clientY,
    startOffset: state.offset,
    wasPlaying: state.playing,
    moved: false
  };
  if (state.playing) setPlaying(false);
  $('readingZone').classList.add('scrubbing');
  try { $('readingZone').setPointerCapture(event.pointerId); } catch { /* Synthetic events and older WebViews may not capture. */ }
}

function moveScrub(event) {
  if (!state.scrub.active || event.pointerId !== state.scrub.pointerId) return;
  const deltaY = event.clientY - state.scrub.startY;
  if (Math.abs(deltaY) < 4 && !state.scrub.moved) return;
  state.scrub.moved = true;
  event.preventDefault();
  state.offset = offsetFromDrag(state.scrub.startOffset, deltaY, state.maximum);
  $('playState').innerHTML = '<i></i> 调整进度';
  applyOffset();
}

function endScrub(event) {
  if (!state.scrub.active || event.pointerId !== state.scrub.pointerId) return;
  const { moved, wasPlaying } = state.scrub;
  state.scrub.active = false;
  $('readingZone').classList.remove('scrubbing');
  try { $('readingZone').releasePointerCapture(event.pointerId); } catch { /* not captured */ }
  if (moved) state.suppressClickUntil = performance.now() + 400;
  if (wasPlaying) setPlaying(true);
  else if (moved) $('playState').innerHTML = '<i></i> 已暂停';
}

function beginSliderSeek() {
  state.seekWasPlaying = state.playing;
  if (state.playing) setPlaying(false);
  $('progressSlider').classList.add('seeking');
}

function updateSliderSeek() {
  state.offset = state.maximum * Number($('progressSlider').value) / 1000;
  $('finishCard').hidden = true;
  $('playState').innerHTML = '<i></i> 调整进度';
  applyOffset();
}

function endSliderSeek() {
  $('progressSlider').classList.remove('seeking');
  if (state.seekWasPlaying) setPlaying(true);
  else $('playState').innerHTML = '<i></i> 已暂停';
  state.seekWasPlaying = false;
}

function finish() {
  setPlaying(false);
  $('playState').innerHTML = '<i></i> 已完成';
  $('finishCard').hidden = false;
}

function resetPlayback() {
  setPlaying(false);
  state.offset = 0;
  $('finishCard').hidden = true;
  applyOffset();
}

function beginCountdown() {
  if (!state.settings.countdown) { setPlaying(true); return; }
  let value = 3;
  const panel = $('countdown');
  panel.hidden = false;
  const tick = () => {
    if (value === 0) {
      panel.hidden = true;
      setPlaying(true);
      return;
    }
    panel.querySelector('span').textContent = value;
    panel.querySelector('span').style.animation = 'none';
    requestAnimationFrame(() => { panel.querySelector('span').style.animation = ''; });
    value -= 1;
    state.countdownTimer = window.setTimeout(tick, 820);
  };
  tick();
}

async function applyPreferredOrientation() {
  if (!state.settings.landscape) return;
  if (window.AndroidTeleprompter?.setLandscape) {
    window.AndroidTeleprompter.setLandscape(true);
    return;
  }
  let locked = false;
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    }
    if (screen.orientation?.lock) {
      await screen.orientation.lock('landscape');
      locked = true;
    }
  } catch { /* Some browsers require device auto-rotate; the responsive layout still works. */ }
  if (!locked && matchMedia('(orientation: portrait)').matches) {
    toast('请打开自动旋转，并将手机横过来');
  }
}

async function openPrompt() {
  const text = $('scriptInput').value.trim();
  if (!text) { toast('先写一点要说的内容'); $('scriptInput').focus(); return; }
  save();
  $('scriptDisplay').textContent = text;
  $('editorScreen').hidden = true;
  $('promptScreen').hidden = false;
  document.body.style.overflow = 'hidden';
  renderSettings();
  state.offset = 0;
  $('playState').innerHTML = '<i></i> 准备';
  await applyPreferredOrientation();
  requestAnimationFrame(() => { measureScroll(); beginCountdown(); });
}

async function closePrompt() {
  clearTimeout(state.countdownTimer);
  $('countdown').hidden = true;
  setPlaying(false);
  if (window.AndroidTeleprompter?.setLandscape) window.AndroidTeleprompter.setLandscape(false);
  try { screen.orientation?.unlock?.(); } catch { /* not locked */ }
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
  $('promptScreen').hidden = true;
  $('editorScreen').hidden = false;
  document.body.style.overflow = '';
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch { toast('当前浏览器不支持全屏'); }
}

function bind() {
  $('scriptInput').addEventListener('input', renderMeta);
  $('scriptTitle').addEventListener('input', save);
  $('sampleButton').addEventListener('click', () => { $('scriptInput').value = sample; renderMeta(); toast('示例稿已填入'); });
  $('clearButton').addEventListener('click', () => {
    if (!$('scriptInput').value || confirm('确定清空这篇稿件吗？')) {
      $('scriptInput').value = ''; $('scriptTitle').value = ''; renderMeta();
    }
  });
  $('fileInput').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 1024 * 1024) { toast('请选择 1MB 以内的 TXT 文件'); return; }
    $('scriptInput').value = await file.text();
    if (!$('scriptTitle').value) $('scriptTitle').value = file.name.replace(/\.txt$/i, '');
    renderMeta(); toast('稿件已导入'); event.target.value = '';
  });
  document.querySelectorAll('[data-adjust]').forEach(button => button.addEventListener('click', () => adjust(button.dataset.adjust, Number(button.dataset.delta))));
  document.querySelectorAll('[data-live-adjust]').forEach(button => button.addEventListener('click', () => adjust(button.dataset.liveAdjust, Number(button.dataset.delta))));
  $('mirrorToggle').addEventListener('change', event => { state.settings.mirror = event.target.checked; renderSettings(); save(); });
  $('landscapeToggle').addEventListener('change', event => { state.settings.landscape = event.target.checked; save(); });
  $('countdownToggle').addEventListener('change', event => { state.settings.countdown = event.target.checked; save(); });
  $('startButton').addEventListener('click', openPrompt);
  $('backButton').addEventListener('click', closePrompt);
  $('fullscreenButton').addEventListener('click', toggleFullscreen);
  $('playButton').addEventListener('click', togglePlaying);
  $('readingZone').addEventListener('pointerdown', beginScrub);
  $('readingZone').addEventListener('pointermove', moveScrub);
  $('readingZone').addEventListener('pointerup', endScrub);
  $('readingZone').addEventListener('pointercancel', endScrub);
  $('readingZone').addEventListener('click', () => {
    if (performance.now() < state.suppressClickUntil) return;
    togglePlaying();
  });
  $('readingZone').addEventListener('keydown', event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); togglePlaying(); } });
  $('progressSlider').addEventListener('pointerdown', beginSliderSeek);
  $('progressSlider').addEventListener('input', updateSliderSeek);
  $('progressSlider').addEventListener('pointerup', endSliderSeek);
  $('progressSlider').addEventListener('pointercancel', endSliderSeek);
  $('progressSlider').addEventListener('change', updateSliderSeek);
  $('replayButton').addEventListener('click', () => { resetPlayback(); beginCountdown(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state.playing) setPlaying(false); });
  window.addEventListener('resize', () => { if (!$('promptScreen').hidden) requestAnimationFrame(measureScroll); });
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); state.installPrompt = event; $('installButton').hidden = false; });
  $('installButton').addEventListener('click', async () => {
    if (!state.installPrompt) return;
    state.installPrompt.prompt();
    await state.installPrompt.userChoice;
    state.installPrompt = null;
    $('installButton').hidden = true;
  });
  window.addEventListener('appinstalled', () => toast('顺词已安装到桌面'));
}

load();
bind();
renderSettings();
renderMeta();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
