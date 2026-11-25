import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pinchState,throwVelocity,entersBasket} from '../dist/interaction.mjs';
function hand(gap){const points=Array.from({length:21},()=>({x:0,y:0}));points[9]={x:0,y:1};points[8]={x:gap,y:0};return points;}
test('pinch hysteresis avoids accidental repeated clicks around the activation threshold',()=>{assert.equal(pinchState(hand(.25)),true);assert.equal(pinchState(hand(.38),true),true);assert.equal(pinchState(hand(.38),false),false);assert.equal(pinchState(hand(.55),true),false);});
test('throw uses recent motion and caps extreme tracking jumps',()=>{assert.deepEqual(throwVelocity([]),{x:0,y:0});const v=throwVelocity([{x:0,y:0,t:0},{x:1000,y:-1000,t:50}]);assert.deepEqual(v,{x:22,y:-22});const still=throwVelocity([{x:100,y:100,t:0},{x:100,y:100,t:90}]);assert.deepEqual(still,{x:0,y:0});});
test('basket scores downward crossings inside the rim, never side entry or upward motion',()=>{const basket={x:100,half:50,rim:200};assert.equal(entersBasket({x:100,y:190},{x:100,y:210},basket,20),true);assert.equal(entersBasket({x:100,y:210},{x:100,y:190},basket,20),false);assert.equal(entersBasket({x:160,y:190},{x:160,y:210},basket,20),false);assert.equal(entersBasket({x:100,y:210},{x:100,y:220},basket,20),false);});
