const assert = require('node:assert/strict');
const core = require('../extension/core.js');

const privateRange = core.normalizeEvent({
  action:'drag', dragType:'range', url:'https://example.test/',
  target:{tag:'input', inputType:'range', label:'价格'},
  start:{x:.2,y:.5}, end:{x:.8,y:.5}, startValue:'20', value:'80'
}, false);
assert.deepEqual(privateRange.start,{x:.2,y:.5});
assert.deepEqual(privateRange.end,{x:.8,y:.5});
assert.equal(privateRange.parameter,true);
assert.equal(Object.hasOwn(privateRange,'startValue'),false);
assert.equal(Object.hasOwn(privateRange,'value'),false);

const capturedRange = core.normalizeEvent({
  action:'drag', dragType:'range', url:'https://example.test/',
  target:{tag:'input', inputType:'range', label:'价格'},
  start:{x:.2,y:.5}, end:{x:.8,y:.5}, startValue:'20', value:'80'
}, true);
assert.equal(capturedRange.startValue,'20');
assert.equal(capturedRange.value,'80');

console.log('core drag data tests passed');
