import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHandMotion,createRateMeter} from '../dist/hand-motion.mjs';
const hand=x=>Array.from({length:21},(_,i)=>({x:x+i*.0001,y:.4+i*.0001,z:0}));

test('motion renders intermediate positions at 144 Hz from 30 Hz camera samples without a buffered frame of delay',()=>{
 const motion=createHandMotion();motion.update(hand(.2),1000,.8);motion.update(hand(.23),1033.33,.8);
 const a=motion.sample(1040)[16],b=motion.sample(1047)[16],c=motion.sample(1054)[16];
 assert.ok(a>.225,'latest position is already visible');assert.ok(b>a&&c>b,'display refreshes move between real detections');
 assert.ok(c<.27,'short prediction stays bounded');
});
test('stationary input stays stationary and old samples cannot rewind motion',()=>{
 const motion=createHandMotion();motion.update(hand(.4),1000);motion.update(hand(.4),1033);
 const a=[...motion.sample(1040)];assert.equal(motion.update(hand(.9),1020),false);assert.deepEqual([...motion.sample(1070)],a);
});
test('prediction stops after a stall and a reacquired hand does not inherit old velocity',()=>{
 const motion=createHandMotion();motion.update(hand(.2),1000);motion.update(hand(.23),1033);
 const stale=[...motion.sample(1250)],unpredicted=[...motion.sample(1250,false)];assert.deepEqual(stale,unpredicted);
 motion.update(hand(.8),1300);assert.ok(Math.abs(motion.sample(1310)[16]-.8008)<.0001);
});
test('sudden hand jumps, bounds and optional prediction remain controlled',()=>{
 const motion=createHandMotion();motion.update(hand(.1),1000);motion.update(hand(.14),1016);
 assert.ok(motion.sample(1040,true)[0]>motion.sample(1040,false)[0]);
 motion.update(hand(.9),1033);assert.ok(Math.abs(motion.sample(1050)[0]-.9)<.0001);
 for(const x of motion.sample(1e6))assert.ok(x>=0&&x<=1);
});
test('rate meters report 30 real samples independently from 144 render ticks, then decay to zero',()=>{
 const tracking=createRateMeter(),render=createRateMeter();for(let i=0;i<=30;i++)tracking.mark(i*1000/30);for(let i=0;i<=144;i++)render.mark(i*1000/144);
 assert.ok(Math.abs(tracking.rate(1000)-30)<.001);assert.ok(Math.abs(render.rate(1000)-144)<.001);assert.equal(tracking.rate(2500),0);tracking.reset();assert.equal(tracking.rate(100),0);
});
