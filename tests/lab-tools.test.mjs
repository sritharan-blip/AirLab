import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createLabTools,stretchPose,simplifyStroke,portalCrossed} from '../dist/lab-tools.mjs';
const sandbox={module:{exports:{}},console};sandbox.exports=sandbox.module.exports;
vm.runInNewContext(readFileSync(new URL('../dist/vendor/matter.min.js',import.meta.url),'utf8'),sandbox);
const Matter=sandbox.module.exports;
const near=(a,b,tolerance=.001)=>assert.ok(Math.abs(a-b)<tolerance,`${a} should be close to ${b}`);
function lab(){
 const engine=Matter.Engine.create(),objects=[],messages=[];
 const tools=createLabTools({Matter,engine,getObjects:()=>objects,getBounds:()=>({width:800,height:600}),toast:m=>messages.push(m)});
 function ball(x=200,y=200,size=30){const b=Matter.Bodies.circle(x,y,size,{density:.002,restitution:0});b.plugin={kind:'ball',size,trail:[]};objects.push(b);Matter.Composite.add(engine.world,b);return b;}
 function step(n=1){for(let i=0;i<n;i++){const prev=new Map(objects.map(b=>[b.id,{...b.position}]));tools.beforeStep();Matter.Engine.update(engine,1000/60);tools.afterStep(prev,engine.timing.timestamp);}}
 return {engine,objects,tools,ball,step,messages};
}
test('two hands resize and rotate one body, then return it to valid dynamic physics',()=>{
 const {tools,ball}=lab(),b=ball(),mass=b.mass,inertia=b.inertia;
 tools.begin('stretch',{x:185,y:200},'left');tools.begin('stretch',{x:215,y:200},'right');
 tools.move({x:170,y:200},'left');tools.move({x:230,y:200},'right');tools.beforeStep();near(b.plugin.size,60);near(b.circleRadius,60);near(b.position.x,200);
 tools.move({x:200,y:170},'left');tools.move({x:200,y:230},'right');tools.beforeStep();near(b.angle,Math.PI/2);
 tools.release(true,'left');tools.move({x:210,y:240},'right');tools.beforeStep();near(b.position.x,210);near(b.position.y,210);
 tools.release(true,'right');assert.equal(b.isStatic,false);near(b.mass,mass*4);near(b.inertia,inertia*16);assert.equal(tools.stats().stretching,0);
});
test('tracking loss releases stretch ownership and mouse Shift-drag also transforms',()=>{
 const {tools,ball}=lab(),b=ball();tools.begin('stretch',{x:225,y:200},'mouse',{shift:true});tools.move({x:250,y:200},'mouse');tools.beforeStep();assert.ok(b.plugin.size>30);
 tools.release(false,'mouse');assert.equal(b.isStatic,false);assert.equal(tools.isActive('mouse'),false);near(b.speed,0);
});
test('stretch has bounded sizes and preserves an off-centre object offset',()=>{
 const p=stretchPose({x:0,y:0},{x:20,y:0},{x:0,y:0},{x:0,y:40},{x:10,y:5,size:20,angle:0});near(p.size,40);near(p.x,-10);near(p.y,20);near(p.angle,Math.PI/2);
 const capped=stretchPose({x:0,y:0},{x:20,y:0},{x:0,y:0},{x:2000,y:0},{x:10,y:0,size:20,angle:0},{min:12,max:100});near(capped.size,100);
});
test('air-drawn lines become solid collision platforms supporting a falling ball',()=>{
 const {tools,ball,step}=lab();tools.begin('draw',{x:100,y:300},'hand');for(let x=120;x<=400;x+=20)tools.move({x,y:300},'hand');tools.release(true,'hand');
 assert.equal(tools.stats().platforms,1);assert.equal(tools.stats().segments,1);const b=ball(200,100,20);step(150);assert.ok(b.position.y>270&&b.position.y<280,`Ball should rest on the ramp, got ${b.position.y}`);
 tools.undoPlatform();assert.equal(tools.stats().platforms,0);
});
test('cancelled or tiny strokes do not create physics fixtures; reset cleans up',()=>{
 const {tools,engine,ball}=lab();const b=ball();tools.begin('draw',{x:100,y:300},'one');tools.move({x:300,y:300},'one');tools.release(false,'one');assert.equal(tools.stats().platforms,0);
 tools.begin('draw',{x:100,y:300},'two');tools.move({x:105,y:300},'two');tools.release(true,'two');assert.equal(tools.stats().platforms,0);
 tools.begin('draw',{x:100,y:300},'three');tools.move({x:300,y:300},'three');tools.release(true,'three');tools.begin('stretch',{x:200,y:200},'four');tools.clearAll();assert.equal(Matter.Composite.allBodies(engine.world).length,1);assert.equal(b.isStatic,false);
});
test('stroke simplification retains a real bend and removes jitter on a straight segment',()=>{
 assert.equal(simplifyStroke([{x:0,y:0},{x:10,y:.2},{x:20,y:0}]).length,2);
 assert.equal(simplifyStroke([{x:0,y:0},{x:10,y:20},{x:20,y:0}]).length,3);
});
test('portal sweep detection catches fast objects and ignores stationary ones',()=>{
 const p={x:200,y:200,radius:48};assert.equal(portalCrossed({x:40,y:200},{x:400,y:200},p,20),true);assert.equal(portalCrossed({x:200,y:200},{x:200,y:200},p,20),false);
});
test('paired portals preserve velocity and rotation while preventing immediate ping-pong',()=>{
 const {tools,ball}=lab();tools.begin('portal',{x:200,y:200},'a');tools.begin('portal',{x:550,y:200},'b');const body=ball(190,200,20);
 Matter.Body.setVelocity(body,{x:7,y:-2});Matter.Body.setAngularVelocity(body,.12);const angular=body.angularVelocity;
 const warped=tools.afterStep(new Map([[body.id,{x:140,y:200}]]),100);assert.ok(warped.has(body.id));assert.ok(body.position.x>550);near(body.velocity.x,7);near(body.velocity.y,-2);near(body.angularVelocity,angular);
 Matter.Body.setPosition(body,{x:550,y:200});const cooldown=tools.afterStep(new Map([[body.id,{x:600,y:200}]]),120);assert.equal(cooldown.size,0);
});
test('portal placement rejects overlapping pairs and linked bodies stay in their system',()=>{
 const {tools,ball}=lab();tools.begin('portal',{x:200,y:200},'a');tools.begin('portal',{x:220,y:200},'b');assert.equal(tools.stats().portals,1);tools.begin('portal',{x:550,y:200},'b');assert.equal(tools.stats().portals,2);
 const body=ball(190,200,20);tools.begin('rope',{x:190,y:200},'a');tools.begin('rope',{x:190,y:70},'a');assert.equal(tools.afterStep(new Map([[body.id,{x:140,y:200}]]),100).size,0);
 tools.clearPortals();assert.equal(tools.stats().portals,0);
});
test('rope is slack under compression and constrains extension',()=>{
 const {tools,engine,ball,step}=lab(),body=ball(100,200,20);engine.gravity.y=0;tools.begin('rope',{x:100,y:200},'hand');tools.begin('rope',{x:300,y:200},'hand');
 const c=Matter.Composite.allConstraints(engine.world)[0];near(c.length,200);Matter.Body.setPosition(body,{x:250,y:200});tools.beforeStep();near(c.stiffness,0);near(c.damping,0);
 Matter.Body.setPosition(body,{x:50,y:200});tools.beforeStep();assert.ok(c.stiffness>.8);step(10);assert.ok(Math.hypot(body.position.x-300,body.position.y-200)<205);
 tools.clearLinks();assert.equal(Matter.Composite.allConstraints(engine.world).length,0);
});
test('spring pulls toward its shorter rest length and can link two objects',()=>{
 const {tools,engine,ball,step}=lab(),a=ball(100,200,20),b=ball(300,200,20);engine.gravity.y=0;
 tools.begin('spring',{x:100,y:200},'left');tools.begin('spring',{x:300,y:200},'right');const c=Matter.Composite.allConstraints(engine.world)[0];assert.ok(c.bodyA===a&&c.bodyB===b);near(c.length,140);assert.ok(c.stiffness>0&&c.stiffness<.1);step(30);assert.ok(b.position.x-a.position.x<190);
});
test('pending connections follow moving objects, and never attach a body to itself',()=>{
 const {tools,engine,ball}=lab(),body=ball(100,200,20);tools.begin('rope',{x:100,y:200},'left');tools.begin('rope',{x:100,y:200},'right');assert.equal(tools.stats().links,0);
 Matter.Body.setPosition(body,{x:150,y:200});tools.begin('rope',{x:300,y:200},'right');near(Matter.Composite.allConstraints(engine.world)[0].length,150);
});
