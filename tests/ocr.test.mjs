import test from 'node:test';
import assert from 'node:assert/strict';
import {orderCandidate,StableDigits} from '../assets/ocr.js';
const a='20261012192853973',b='20261013100000001';
test('17 digit candidate stays string; only full single lines accepted',()=>{
  assert.equal(orderCandidate(a),a);assert.equal(orderCandidate('00000000000000001'),'00000000000000001');
  assert.equal(orderCandidate(' 20261012 192853973\n'),a);
  assert.equal(orderCandidate('２０２６１０１２１９２８５３９７３'),a);
  for(const x of [a.slice(1),a+'1','訂單:'+a,a+'\n'+b,'123\n456',a+'abc'])assert.equal(orderCandidate(x),null);
});
test('three consecutive confident identical frames required and duplicates suppressed',()=>{
  const gate=new StableDigits();assert.equal(gate.observe(a,90,0).ready,false);assert.equal(gate.observe(a,90,1000).ready,false);
  assert.equal(gate.observe(a,90,2000).ready,true);assert.equal(gate.observe(a,90,3000).ready,false);
  assert.equal(gate.observe(b,90,4000).hits,1);assert.equal(gate.observe(b,90,5000).ready,false);assert.equal(gate.observe(b,90,6000).ready,true);
});
test('low confidence, invalid text, different readings and long gaps break stability',()=>{
  const gate=new StableDigits();gate.observe(a,95,0);gate.observe(a,74,1000);assert.equal(gate.observe(a,95,2000).hits,1);
  gate.observe('123',99,3000);assert.equal(gate.observe(a,95,4000).hits,1);
  assert.equal(gate.observe(b,95,5000).hits,1);assert.equal(gate.observe(b,95,12000).hits,1);
  assert.equal(gate.observe(b,NaN,13000).hits,0);
});
