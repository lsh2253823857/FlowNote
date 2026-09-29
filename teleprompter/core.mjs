export const LIMITS = Object.freeze({ speed: [60, 360], fontSize: [28, 72] });

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || min));
}

export function normalizeSettings(value = {}) {
  return {
    speed: clamp(value.speed ?? 180, ...LIMITS.speed),
    fontSize: clamp(value.fontSize ?? 42, ...LIMITS.fontSize),
    mirror: Boolean(value.mirror),
    landscape: Boolean(value.landscape),
    countdown: value.countdown !== false
  };
}

export function visibleLength(text = '') {
  return String(text).replace(/\s+/g, '').length;
}

export function estimatedSeconds(text, charsPerMinute = 180) {
  const length = visibleLength(text);
  return length ? Math.max(1, Math.ceil(length / clamp(charsPerMinute, 30, 1000) * 60)) : 0;
}

export function formatDuration(seconds) {
  const safe = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

export function pixelsPerSecond(charsPerMinute, fontSize) {
  // 中文正文平均每行字符数与视口有关；以字号为基准换算成稳定、可感知的滚动速度。
  return clamp(charsPerMinute, ...LIMITS.speed) / 60 * clamp(fontSize, ...LIMITS.fontSize) * 0.12;
}

export function scrollProgress(offset, maximum) {
  if (maximum <= 0) return 1;
  return clamp(offset / maximum, 0, 1);
}

export function nextOffset(current, elapsedMs, charsPerMinute, fontSize, maximum) {
  const next = current + pixelsPerSecond(charsPerMinute, fontSize) * Math.max(0, elapsedMs) / 1000;
  return Math.min(Math.max(0, maximum), next);
}

export function offsetFromDrag(startOffset, deltaY, maximum, sensitivity = 1.15) {
  return clamp(startOffset - deltaY * sensitivity, 0, Math.max(0, maximum));
}
