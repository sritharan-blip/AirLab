import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cameraScore,chooseCamera,associateHands,fieldForce} from '../dist/interaction.mjs';
const camera=(deviceId,label)=>({kind:'videoinput',deviceId,label});
test('auto camera prefers built-in webcam over a default phone or virtual feed',()=>{
 const devices=[camera('phone','Windows Virtual Camera - Samsung Phone'),camera('obs','OBS Virtual Camera'),camera('usb','Logitech USB Webcam'),camera('local','HP Wide Vision Integrated Camera')];
 assert.equal(chooseCamera(devices).deviceId,'local');
 assert.equal(chooseCamera(devices,'usb').deviceId,'usb');
 assert.equal(chooseCamera(devices,'phone').deviceId,'phone');
 assert.equal(chooseCamera(devices,'missing'),null);
 assert.equal(chooseCamera([devices[0],devices[1]]),null);
 assert.ok(cameraScore('Iriun Webcam')<0);
 assert.ok(cameraScore('HD User Facing')>0);
});
test('hand identities survive reversed detector ordering',()=>{
 const tracks=[{id:'a',center:{x:.2,y:.5},label:'Left',lastSeen:100},{id:'b',center:{x:.8,y:.5},label:'Right',lastSeen:100}];
 const detections=[{center:{x:.77,y:.5},label:'Right'},{center:{x:.23,y:.5},label:'Left'}];
 assert.deepEqual(associateHands(tracks,detections,130),['b','a']);
});
test('four nearby hands receive distinct ownership and stale hands cannot inherit a grab',()=>{
 const tracks=[.1,.35,.6,.85].map((x,i)=>({id:`h${i}`,center:{x,y:.5},label:'Left',lastSeen:100}));
 const detections=[.85,.35,.1,.6].map(x=>({center:{x,y:.5},label:'Left'}));
 assert.deepEqual(associateHands(tracks,detections,130),['h3','h1','h0','h2']);
 assert.deepEqual(associateHands(tracks,detections,400),[null,null,null,null]);
 assert.deepEqual(associateHands(tracks,[{center:{x:.5,y:1},label:'Left'}],130),[null]);
});
test('force fields attract or repel only nearby bodies and avoid singularities',()=>{
 const body={mass:2,position:{x:10,y:10}};
 assert.ok(fieldForce(body,{x:100,y:10},'magnet').x>0);
 assert.ok(fieldForce(body,{x:100,y:10},'repel').x<0);
 assert.deepEqual(fieldForce(body,{x:1000,y:10},'magnet'),{x:0,y:0});
 assert.deepEqual(fieldForce(body,{x:10,y:10},'magnet'),{x:0,y:0});
});
