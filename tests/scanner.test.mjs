import test from 'node:test';
import assert from 'node:assert/strict';
import {scanRegion,CameraScanner} from '../assets/scanner.js';
test('ROI maps visible object-fit cover coordinates to original frame',()=>{
  const target={x:25,y:80,width:300,height:110};
  const r=scanRegion(1920,1080,350,270,target),scale=.25;
  assert.equal(r.x*scale-(1920*scale-350)/2,target.x);
  assert.equal(r.y*scale,target.y);assert.equal(r.width*scale,target.width);assert.equal(r.height*scale,target.height);
  assert(r.x>=0&&r.x+r.width<=1920&&r.y+r.height<=1080);
});
test('ROI at matching aspect ratio has no cover offset',()=>{assert.deepEqual(scanRegion(1000,500,400,200,{x:40,y:50,width:320,height:100}),{x:100,y:125,width:800,height:250});});
test('late camera permission result after stop releases tracks without starting decode',async()=>{
  const originals={secure:Object.getOwnPropertyDescriptor(globalThis,'isSecureContext'),nav:Object.getOwnPropertyDescriptor(globalThis,'navigator'),zxing:Object.getOwnPropertyDescriptor(globalThis,'ZXingBrowser')};
  let resolve,stopped=0,events=0;
  Object.defineProperty(globalThis,'isSecureContext',{value:true,configurable:true});
  Object.defineProperty(globalThis,'navigator',{value:{mediaDevices:{getUserMedia:()=>new Promise(r=>resolve=r)}},configurable:true});
  Object.defineProperty(globalThis,'ZXingBrowser',{value:{BrowserMultiFormatReader:class{}},configurable:true});
  try{const scanner=new CameraScanner(()=>{},()=>{},()=>events++);const pending=scanner.start({});scanner.stop(false);resolve({getTracks:()=>[{stop:()=>stopped++}]});await pending;assert.equal(stopped,1);assert.equal(events,0);assert.equal(scanner.active,false);assert.equal(scanner.pending,false);}
  finally{for(const [key,descriptor] of [['isSecureContext',originals.secure],['navigator',originals.nav],['ZXingBrowser',originals.zxing]]){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});
