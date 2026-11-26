import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const sandbox={module:{exports:{}},console};
sandbox.exports=sandbox.module.exports;
vm.runInNewContext(readFileSync(new URL('../dist/vendor/matter.min.js',import.meta.url),'utf8'),sandbox);
const {Engine,Bodies,Composite,Constraint}=sandbox.module.exports;
function fallingDistance(g){const engine=Engine.create();engine.gravity.y=g;const ball=Bodies.circle(0,0,10,{frictionAir:0});Composite.add(engine.world,ball);for(let i=0;i<60;i++)Engine.update(engine,1000/60);return ball.position.y;}
test('Earth and Moon fall distances match the gravity ratio; zero gravity stays still',()=>{assert.ok(Math.abs(fallingDistance(1)/fallingDistance(1.62/9.81)-9.81/1.62)<.001);assert.equal(fallingDistance(0),0);});
test('grab constraint pulls an object toward its target',()=>{const engine=Engine.create();engine.gravity.y=0;const ball=Bodies.circle(100,100,20);const constraint=Constraint.create({pointA:{x:300,y:180},bodyB:ball,length:0,stiffness:.22,damping:.12});Composite.add(engine.world,[ball,constraint]);for(let i=0;i<45;i++)Engine.update(engine,1000/60);assert.ok(Math.hypot(ball.position.x-300,ball.position.y-180)<2);});
