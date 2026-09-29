import assert from 'node:assert/strict';
import { estimatedSeconds, formatDuration, nextOffset, normalizeSettings, pixelsPerSecond, scrollProgress, visibleLength } from '../core.mjs';

assert.equal(visibleLength('你好，\n 世界'), 5);
assert.equal(estimatedSeconds('一'.repeat(180), 180), 60);
assert.equal(formatDuration(65), '1:05');
assert.deepEqual(normalizeSettings({ speed: 999, fontSize: 2, mirror: 1, landscape: 1, countdown: false }), { speed: 360, fontSize: 28, mirror: true, landscape: true, countdown: false });
assert.equal(pixelsPerSecond(180, 42), 15.12);
assert.equal(nextOffset(95, 1000, 180, 42, 100), 100);
assert.equal(scrollProgress(25, 100), 0.25);
assert.equal(scrollProgress(0, 0), 1);

console.log('core.test.mjs: 8 assertions passed');
