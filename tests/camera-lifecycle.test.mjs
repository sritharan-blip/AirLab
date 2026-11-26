import {createHandMotion,createRateMeter} from '../dist/hand-motion.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createFrameGate,TRACKING_PROFILES} from '../dist/tracking-pipeline.mjs';
import {clamp,pinchState,chooseCamera,associateHands} from '../dist/interaction.mjs';

function boot({nativeFrames=false,bladeTracking=false,manualWorker=false,hideDeviceDetails=false,cameraBlocked=false,cameraError}={}){
 const elements=new Map(),events=new Map(),workers=[],captures=[];let stopped=0,closed=0,clock=100,nextCallback=0,opens=0;const callbacks=new Map(),cursors=[],calls={begin:[],move:[],release:[],blade:[]},draws={strokes:0};
 class Element{
  constructor(){this.value='';this.checked=true;this.dataset={};this.style={setProperty(){}};this.classList={toggle(){}};this.currentTime=1;this.readyState=2;this.videoWidth=640;this.videoHeight=480;}
  getContext(){return new Proxy({},{get:(_,key)=>()=>{if(key==='stroke')draws.strokes++;}});}addEventListener(){}replaceChildren(){}add(){}remove(){this.removed=true;}append(){}async play(){}
 }
 const $=key=>{if(!elements.has(key))elements.set(key,new Element());return elements.get(key);};$('#hand-limit').value='2';$('#skeleton').checked=false;$('#hand-smoothing').value='70';if(nativeFrames){$('#camera').requestVideoFrameCallback=cb=>{const id=++nextCallback;callbacks.set(id,cb);return id;};$('#camera').cancelVideoFrameCallback=id=>callbacks.delete(id);}
 const document={querySelector:$,querySelectorAll:()=>[],addEventListener:(name,fn)=>events.set(name,fn),body:new Element(),hidden:false,createElement:()=>{const el=new Element();cursors.push(el);return el;},elementFromPoint:()=>null};document.body.dataset.quality='balanced';
 if(cameraBlocked)document.permissionsPolicy={allowsFeature:name=>name!=='camera'};
 const track={label:'Integrated webcam',stop(){stopped++;},getSettings:()=>({deviceId:'local-test-camera'}),addEventListener(){}};
 const stream={getTracks:()=>[track],getVideoTracks:()=>[track]};
 const mediaDevices={enumerateDevices:async()=>[{kind:'videoinput',label:hideDeviceDetails?'':'Integrated webcam',deviceId:hideDeviceDetails?'':'local-test-camera'}],getUserMedia:async()=>{opens++;if(cameraError)throw cameraError;return stream;},addEventListener(){}};
 class Worker{
  constructor(){this.frames=[];this.terminated=false;workers.push(this);}
  postMessage(data){if(data.type==='init'){if(!manualWorker)queueMicrotask(()=>this.ready());}else this.frames.push(data);}
  ready(){this.onmessage({data:{type:'ready',delegate:'GPU'}});}
  terminate(){this.terminated=true;}
 }
 const sandbox={document,navigator:{mediaDevices},localStorage:{getItem:()=>'',setItem(){},removeItem(){}},Option:class{},Worker,URL,createHandMotion,createRateMeter,createFrameGate,TRACKING_PROFILES,clamp,pinchState,chooseCamera,associateHands,console,setTimeout,clearTimeout,queueMicrotask,calls,bladeTracking,performance:{now:()=>clock},innerWidth:1200,innerHeight:800,window:{addEventListener(){},scrollBy(){}},createImageBitmap:()=>new Promise(resolve=>captures.push(()=>resolve({close(){closed++;}})))};
 vm.createContext(sandbox);
 let source=readFileSync(new URL('../dist/hand-control.mjs',import.meta.url),'utf8').replace(/^import .*;\r?$/gm,'').replace('export function','function').replace('import.meta.url',"'http://localhost/hand-control.mjs'");
 vm.runInContext(source+';globalThis.controller=createHandControl({stagePoint:(x,y)=>({inside:true,x,y}),begin:(...args)=>calls.begin.push(args),move:(...args)=>calls.move.push(args),release:(...args)=>calls.release.push(args),isGrabbing:()=>false,toast(){},getMode:()=>"grab",tracksFinger:()=>bladeTracking,trackFinger:(...args)=>{calls.blade.push(args);return true;}});',sandbox);
 return {elements,events,cursors,calls,draws,setNow:now=>clock=now,present(now,mediaTime,presentedFrames){clock=now;const [id,cb]=callbacks.entries().next().value;callbacks.delete(id);cb(now,{mediaTime,presentedFrames});},callbacks,controller:sandbox.controller,workers,captures,document,video:$('#camera'),get opens(){return opens;},get stopped(){return stopped;},get closed(){return closed;}};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('the preview opens while tracking loads and a browser with hidden device IDs keeps the current stream',async()=>{
 const a=boot({manualWorker:true,hideDeviceDetails:true});
 const ready=a.controller.toggle();
 await flush();
 assert.equal(a.opens,1);
 assert.equal(a.controller.active,false);
 assert.equal(a.controller.cameraOpen,true);
 assert.equal(a.elements.get('#camera-preview').hidden,false);
 assert.match(a.elements.get('#tracking-status').textContent,/loading hand tracking/i);
 a.workers[0].ready();
 await ready;
 assert.equal(a.controller.active,true);
 a.controller.stop();
 assert.equal(a.stopped,1);
});
test('a camera policy block reports a useful status without starting a stream',async()=>{
 const a=boot({cameraBlocked:true});
 await a.controller.toggle();
 assert.equal(a.opens,0);
 assert.equal(a.controller.active,false);
 assert.match(a.elements.get('#tracking-status').textContent,/camera blocked/i);
 assert.match(a.elements.get('#camera-active').textContent,/directly in Chrome or Edge/);
});
test('a declined permission remains visible after startup cleanup',async()=>{
 const a=boot({cameraError:Object.assign(new Error('Permission denied'),{name:'NotAllowedError'})});
 await a.controller.toggle();
 assert.equal(a.controller.active,false);
 assert.equal(a.elements.get('#camera-preview').hidden,true);
 assert.match(a.elements.get('#tracking-status').textContent,/permission needed/i);
 assert.match(a.elements.get('#camera-active').textContent,/Allow Camera/);
});
test('camera captures only one frame until a worker result arrives, and stopping terminates it',async()=>{
 const a=boot();await a.controller.toggle();assert.equal(a.controller.active,true);
 a.controller.tick(100);a.video.currentTime++;a.controller.tick(200);assert.equal(a.captures.length,1);
 a.captures[0]();await flush();assert.equal(a.workers[0].frames.length,1);
 a.controller.tick(300);assert.equal(a.captures.length,1);
 a.workers[0].onmessage({data:{type:'result',landmarks:[],handedness:[],ms:5}});a.controller.tick(400);assert.equal(a.captures.length,2);
 a.controller.stop();assert.equal(a.stopped,1);assert.equal(a.workers[0].terminated,true);assert.equal(a.controller.active,false);
 a.captures[1]();await flush();assert.equal(a.closed,1);assert.equal(a.workers[0].frames.length,1);
});
test('late results from an old camera session cannot alter a restarted camera',async()=>{
 const a=boot();await a.controller.toggle();const old=a.workers[0];a.controller.stop();await a.controller.toggle();
 old.onmessage({data:{type:'error',message:'late failure'}});assert.equal(a.controller.active,true);assert.equal(a.workers[1].terminated,false);a.controller.stop();
});
test('hidden pages do not capture camera frames',async()=>{const a=boot();await a.controller.toggle();a.document.hidden=true;a.controller.tick(100);assert.equal(a.captures.length,0);a.controller.stop();});

const landmarks=(x,pinched=false)=>{const h=Array.from({length:21},()=>({x,y:.45,z:0}));h[0].y=.7;h[9].y=.5;h[8].y=.35;h[4].y=pinched?.351:.55;return h;};
test('native camera callbacks capture immediately without waiting for rendering or a low-FPS timer',async()=>{
 const a=boot({nativeFrames:true});await a.controller.toggle();a.present(100,1,1);assert.equal(a.captures.length,1);a.present(107,1.007,2);assert.equal(a.captures.length,1);
 a.captures[0]();await flush();a.setNow(110);a.workers[0].onmessage({data:{type:'result',landmarks:[],handedness:[],timestamp:100,ms:8}});assert.equal(a.captures.length,2,'new camera frame starts immediately after inference');
 a.controller.stop();assert.equal(a.callbacks.size,0,'stop cancels the pending video callback');a.captures[1]();await flush();assert.equal(a.closed,1);
});
test('skeleton and cursor update on display ticks between detections; prediction cannot invent a pinch',async()=>{
 const a=boot();await a.controller.toggle();a.elements.get('#skeleton').checked=true;
 a.workers[0].onmessage({data:{type:'result',landmarks:[landmarks(.4)],handedness:[],timestamp:100,ms:5}});
 a.setNow(133);a.workers[0].onmessage({data:{type:'result',landmarks:[landmarks(.43)],handedness:[],timestamp:133,ms:5}});
 a.controller.tick(140);const first=a.cursors[0].style.transform;a.controller.tick(147);assert.notEqual(a.cursors[0].style.transform,first);assert.equal(a.draws.strokes,2,'one batched skeleton draw per display tick');assert.equal(a.calls.begin.length,0);
 a.setNow(154);a.workers[0].onmessage({data:{type:'result',landmarks:[landmarks(.45,true)],handedness:[],timestamp:154,ms:5}});assert.equal(a.calls.begin.length,1);
 const before=a.calls.move.length;a.controller.tick(160);a.controller.tick(167);assert.equal(a.calls.move.length,before+2,'drag uses the same continuous position as the cursor');
 a.controller.tick(360);assert.equal(a.controller.active,true);assert.equal(a.cursors[0].removed,true);assert.ok(a.calls.release.length>0,'stalled input releases its grab');a.controller.stop();
});

test('blade mode steers with the index tip and knuckle every display frame and clears an occluded swipe',async()=>{
 const a=boot({bladeTracking:true});
 await a.controller.toggle();
 function detect(time,...hands){
  a.setNow(time);
  a.workers[0].onmessage({data:{type:'result',landmarks:hands,handedness:[],timestamp:time,ms:5}});
 }
 detect(100,landmarks(.4));
 a.controller.tick(107);
 assert.equal(a.calls.begin.length,0);
 assert.equal(a.cursors[0].hidden,true);
 const [tipX,tipY,knuckleX,knuckleY,id]=a.calls.blade[0];
 assert.ok(Math.abs(tipX-((1-.4-.12)/.76)*1200)<.001);
 assert.ok(Math.abs(tipY-((.35-.08)/.82)*800)<.001);
 assert.equal(knuckleX,tipX);
 assert.ok(knuckleY>tipY);
 detect(133,landmarks(.45,true));
 a.controller.tick(140);a.controller.tick(147);
 assert.notEqual(a.calls.blade[1][0],a.calls.blade[2][0]);
 assert.equal(a.calls.begin.length,1);
 assert.equal(a.calls.move.length,0,'blade movement is handled once through the display-rate path');
 detect(150);
 const [committed,released]=a.calls.release.at(-1);
 assert.equal(committed,false);
 assert.equal(released,id);
 a.controller.tick(157);
 assert.equal(a.calls.blade.length,3);
 detect(166,landmarks(.46,true));
 a.controller.tick(173);
 assert.equal(a.calls.begin.length,1,'a reappearing pinch must open before cutting again');
 assert.equal(a.calls.blade.length,4);
 a.controller.stop();
});
