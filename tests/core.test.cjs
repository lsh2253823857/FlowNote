const assert = require('node:assert/strict');
const core = require('../extension/core.js');

const privateRange = core.normalizeEvent({
  action:'drag', dragType:'range', url:'https://example.test/',
  target:{tag:'input', inputType:'range', label:'价格'},
  start:{x:.2,y:.5}, end:{x:.8,y:.5}, startValue:'20', value:'80'
}, false);
assert.deepEqual(privateRange.coordinateSystem,{unit:'ratio',origin:'top-left'});
assert.deepEqual(privateRange.start,{x:.2,y:.5,relativeTo:'source'});
assert.deepEqual(privateRange.end,{x:.8,y:.5,relativeTo:'source'});
assert.equal(privateRange.replayStrategy,'set-value-first');
assert.equal(privateRange.parameter,true);
assert.equal(Object.hasOwn(privateRange,'startValue'),false);
assert.equal(Object.hasOwn(privateRange,'targetValue'),false);

const capturedRange = core.normalizeEvent({
  action:'drag', dragType:'range', url:'https://example.test/',
  target:{tag:'input', inputType:'range', label:'价格'},
  coordinateSystem:{unit:'ratio',origin:'top-left'},
  start:{x:.2,y:.5,relativeTo:'source'}, end:{x:.8,y:.5,relativeTo:'source'},
  startValue:'20', targetValue:'80', replayStrategy:'set-value-first'
}, true);
assert.equal(capturedRange.startValue,'20');
assert.equal(capturedRange.targetValue,'80');

const legacyRange = core.normalizeEvent({
  action:'drag', dragType:'range', url:'https://example.test/', target:{},
  start:{x:.1,y:.5}, end:{x:.9,y:.5}, value:'90'
}, true);
assert.equal(legacyRange.targetValue,'90');
assert.equal(legacyRange.end.relativeTo,'source');

const sortDrag = core.normalizeEvent({
  action:'drag', dragType:'sort', url:'https://example.test/', target:{name:'商品 A'}, dropTarget:{name:'商品 B'},
  coordinateSystem:{unit:'ratio',origin:'top-left'},
  start:{x:.5,y:.5,relativeTo:'source'}, end:{x:.5,y:.9,relativeTo:'dropTarget'},
  position:'after', replayStrategy:'semantic-drop-first'
}, false);
assert.equal(sortDrag.end.relativeTo,'dropTarget');
assert.equal(sortDrag.replayStrategy,'semantic-drop-first');

const canvasDrag = core.normalizeEvent({
  action:'drag', dragType:'canvas', url:'https://example.test/', target:{selector:'#board'},
  start:{x:.1,y:.2}, end:{x:.8,y:.9}, path:[{x:.1,y:.2},{x:.8,y:.9}]
}, false);
assert.equal(canvasDrag.replayStrategy,'path-first');
assert(canvasDrag.path.every(point=>point.relativeTo==='source'));

for (const invalid of [
  {coordinateSystem:{unit:'pixel',origin:'top-left'}},
  {coordinateSystem:{unit:'ratio',origin:'center'}},
  {start:{x:.2,y:.5,relativeTo:'dropTarget'}},
  {end:{x:.8,y:.5,relativeTo:'dropTarget'}},
  {replayStrategy:'coordinate-only'}
]) {
  const raw={action:'drag',dragType:'range',url:'https://example.test/',target:{},start:{x:.2,y:.5},end:{x:.8,y:.5},...invalid};
  assert.equal(core.normalizeEvent(raw,false),null);
}

console.log('core drag data tests passed');
