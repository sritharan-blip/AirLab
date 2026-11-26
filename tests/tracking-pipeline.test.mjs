import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createFrameGate,TRACKING_PROFILES} from '../dist/tracking-pipeline.mjs';

test('inference never queues another frame while capture or detection is in flight',()=>{
  const gate=createFrameGate(),ticket=gate.acquire(0,60);assert.notEqual(ticket,null);
  for(let now=1;now<1000;now++)assert.equal(gate.acquire(now,60),null);
  gate.finish(ticket);assert.notEqual(gate.acquire(1000,60),null);
});
test('a stopped camera invalidates pending captures and stale completions cannot unlock a new capture',()=>{
  const gate=createFrameGate(),old=gate.acquire(0,50);gate.reset();assert.equal(gate.valid(old),false);
  const fresh=gate.acquire(1,50);gate.finish(old);assert.equal(gate.busy,true);gate.finish(fresh);assert.equal(gate.busy,false);
});
test('backpressure remains available and rendering quality does not throttle detection cadence',()=>{
  const gate=createFrameGate(),ticket=gate.acquire(0,80);gate.finish(ticket);assert.equal(gate.acquire(79,80),null);assert.notEqual(gate.acquire(80,80),null);
  for(const p of Object.values(TRACKING_PROFILES)){assert.ok(p.width<=512);assert.equal(p.hz,undefined);assert.ok(p.dpr<=1.6);}
});

function workerHarness(failGPU=false){
 const messages=[],calls=[];let closed=0,failed=false;
 const detector={detectForVideo(bitmap,timestamp){calls.push(timestamp);if(failed)throw new Error('GPU lost');return {landmarks:[],handedness:[]};}};
 const sdk={FilesetResolver:{forVisionTasks:async()=>({})},HandLandmarker:{createFromOptions:async(files,options)=>{if(failGPU&&options.baseOptions.delegate==='GPU')throw new Error('No GPU');return detector;}}};
 const sandbox={self:{location:{href:'http://localhost/hand-worker.js'},postMessage:data=>messages.push(data)},performance:{now:()=>10},URL,OffscreenCanvas:class{},sdk};
 vm.createContext(sandbox);
 const source=readFileSync(new URL('../dist/hand-worker.js',import.meta.url),'utf8').replace("await import('./vendor/vision_bundle.mjs')",'sdk');vm.runInContext(source,sandbox);
 return {messages,calls,send:data=>sandbox.self.onmessage({data}),bitmap:()=>({close(){closed++;}}),get closed(){return closed;},fail(){failed=true;}};
}
test('worker initializes GPU then detects transferable frames and closes each bitmap',async()=>{
 const w=workerHarness();await w.send({type:'init',maxHands:4});assert.equal(w.messages[0].delegate,'GPU');
 await w.send({type:'frame',bitmap:w.bitmap(),timestamp:42});assert.equal(w.messages[1].type,'result');assert.equal(w.calls[0],42);assert.equal(w.closed,1);
 w.fail();await w.send({type:'frame',bitmap:w.bitmap(),timestamp:43});assert.equal(w.messages[2].type,'error');assert.equal(w.closed,2);
});
test('GPU initialization failure falls back inside the worker',async()=>{const w=workerHarness(true);await w.send({type:'init',maxHands:2});assert.equal(w.messages[0].type,'ready');assert.equal(w.messages[0].delegate,'CPU');});
