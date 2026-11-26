import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {paintSolid} from '../dist/solid-art.mjs';
import {makeArcade} from '../dist/arcade.mjs';
import {BLADES, BLADE_SPRITE} from '../dist/arcade-blades.mjs';
import {createExperimentLab, slopeTrial} from '../dist/experiment-lab.mjs';
import {motionCSV, PIXELS_PER_METRE, STEP_MS, projected} from '../dist/experiment-math.mjs';

// Run the actual app module and Matter engine against a small in-memory UI.
// This checks input routing and scene cleanup without requiring a webcam or
// network access. The worker pipeline has separate lifecycle and backpressure tests.
function boot(){
 const elements=new Map(),actions=new Map(),listeners=new Map();
 const canvasBounds={left:0,top:0,width:800,height:600};
 const route={hash:'',pathname:'/',search:''};
 const bladeDraws=[];
 let translation, rotation;
 const context2d=new Proxy({
  createRadialGradient:()=>({addColorStop(){}}),createLinearGradient:()=>({addColorStop(){}}),
  translate(x,y){translation={x,y};},rotate(angle){rotation=angle;},
  drawImage(image,x,y){if(image.width===BLADE_SPRITE.width&&image.height===BLADE_SPRITE.height)bladeDraws.push({translation,rotation,x,y,image});}
 },{get:(o,k)=>k in o?o[k]:(()=>{})});
 class Element{
  constructor(id=''){this.id=id;this.dataset={};this.style={setProperty(){}};this.value='';this.checked=false;this.textContent='';this.hidden=false;this.disabled=false;this.handlers=new Map();this.attributes=new Map();this.children=[];this.classList={toggle(){},remove(){},add(){}};}
  addEventListener(type,fn){this.handlers.set(type,fn);}
  getBoundingClientRect(){return {...canvasBounds};}
  getContext(){return context2d;}
  setPointerCapture(){}setAttribute(name,value){this.attributes.set(name,value);}focus(){}scrollIntoView(){}append(...children){this.children.push(...children);}close(){this.open=false;}showModal(){this.open=true;}
  closest(selector){return selector==='button'?this:null;}
 }
 const html=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
 for(const [,id]of html.matchAll(/\bid="([^"]+)"/g))elements.set(id,new Element(id));
 elements.get('bounce').value='65';elements.get('object-size').value='1';elements.get('trails').checked=true;elements.get('performance').value='auto';elements.get('material').value='rubber';
 const tools=['grab','magnet','repel','stretch','draw','portal','rope','spring'].map(name=>{const b=new Element();b.dataset.tool=name;return b;});
 const selected=new Element();
 const document={
  createElement(){return new Element();},
  querySelector(selector){if(selector.startsWith('#'))return elements.get(selector.slice(1));if(selector.includes('data-action=')){if(!actions.has(selector))actions.set(selector,new Element());return actions.get(selector);}return selected;},
  querySelectorAll(selector){return selector==='[data-tool]'?tools:[];},
  addEventListener(type,fn){listeners.set(type,fn);},hidden:false,body:new Element()
 };
 const sandbox={module:{exports:{}},makeArcade,paintSolid,createExperimentLab,slopeTrial,PIXELS_PER_METRE,STEP_MS,console,document,performance:{now:()=>1000},devicePixelRatio:1,innerWidth:1000,innerHeight:800,setTimeout:()=>0,clearTimeout(){},requestAnimationFrame(){},ResizeObserver:class{observe(){}},Event:class{constructor(type){this.type=type;}}};
 sandbox.exports=sandbox.module.exports;vm.createContext(sandbox);
 vm.runInContext(readFileSync(new URL('../dist/vendor/matter.min.js',import.meta.url),'utf8'),sandbox);
 sandbox.window={Matter:sandbox.module.exports,addEventListener(){},location:route,
  history:{pushState(_,__,url){route.hash=url;},replaceState(){route.hash='';}}};
 const bundle=(filename,names)=>`(()=>{${readFileSync(new URL(filename,import.meta.url),'utf8').replaceAll('export ','')}\nreturn {${names.join(',')}};})()`;
 vm.runInContext(`var SceneFormat=${bundle('../dist/scene-format.mjs',['validateScene'])};var Interaction=${bundle('../dist/interaction.mjs',['clamp','throwVelocity','entersBasket','fieldForce'])};var LabTools=${bundle('../dist/lab-tools.mjs',['createLabTools','TOOL_HELP'])};`,sandbox);
 let app=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
 app=app.replace("import {makeArcade} from './arcade.mjs';",'').replace("import {createExperimentLab, slopeTrial} from './experiment-lab.mjs';",'').replace("import {PIXELS_PER_METRE, STEP_MS} from './experiment-math.mjs';",'').replace("import {paintSolid} from './solid-art.mjs';",'').replace(/import \{validateScene\} from '\.\/scene-format\.mjs';/,'const {validateScene}=SceneFormat;').replace(/import \{([^}]+)\} from '\.\/interaction\.mjs';/, 'const {$1}=Interaction;').replace(/import \{createLabTools,TOOL_HELP\} from '\.\/lab-tools\.mjs';/,'const {createLabTools,TOOL_HELP}=LabTools;').replace(/import \{createHandControl\} from '\.\/hand-control\.mjs(?:\?[^']+)?';/, 'const createHandControl=()=>({releaseAll(){},tick(){},active:false,cameraOpen:false,count:0,toggle(){}});');
 app+='\nglobalThis.inspectLab=()=>({objects,stats:advanced.stats(),mode,engine,lab,arcade});globalThis.sceneAPI={captureScene,restoreScene};';
 vm.runInContext(app,sandbox);
 function click(dataset){const b=new Element();b.dataset=dataset;listeners.get('click')({target:b});}
 let time=1000;
 const frame=(count=1)=>{for(let i=0;i<count;i++){time+=17;sandbox.frame(time);}};
 const pointer=(type,x,y,shiftKey=false)=>elements.get('world').handlers.get(type)({clientX:x,clientY:y,pointerId:1,shiftKey});
 const resize=(width,height)=>{Object.assign(canvasBounds,{width,height});sandbox.resize();};
 return {state:()=>sandbox.inspectLab(),click,frame,pointer,resize,elements,bladeDraws,Matter:sandbox.window.Matter,sceneAPI:sandbox.sceneAPI};
}

test('resizing the canvas preserves the basket scene and its objects',()=>{
 const app=boot();
 app.click({scene:'target'});
 app.click({spawn:'ball'});
 const balls=app.state().objects.map(b=>b.id);
 app.resize(990,645);
 assert.deepEqual(app.state().objects.map(b=>b.id),balls);
 assert.equal(app.elements.get('challenge-score').hidden,false);
 app.frame(12);
 assert.deepEqual(app.state().objects.map(b=>b.id),balls);
});

test('opening the inspector panels leaves just one interactive panel',()=>{
 const app=boot();
 app.click({panel:'scenes'});
 app.click({action:'show-tracking'});
 assert.equal(app.elements.get('panel-nav').dataset.activePanel,'tracking');
 assert.equal(app.elements.get('panel-tracking').hidden,false);
 assert.equal(app.elements.get('panel-tracking').inert,false);
 for(const key of ['build','scenes']){
  assert.equal(app.elements.get('panel-'+key).hidden,true);
  assert.equal(app.elements.get('panel-'+key).inert,true);
 }
});

test('the third sigil tap unlocks the arcade and leaving restores the playground state',()=>{
 const app=boot();
 app.click({scene:'target'});
 const before=app.state().objects.map(body=>body.id);
 const timestamp=app.state().engine.timing.timestamp;
 app.click({action:'arcade-sigil'});
 app.click({action:'arcade-sigil'});
 assert.equal(app.state().arcade.active,false);
 app.click({action:'arcade-sigil'});
 assert.equal(app.elements.get('playground-page').hidden,true);
 assert.equal(app.state().arcade.active,true);
 app.click({game:'citrus'});
 assert.equal(app.state().arcade.browsingLevels,true);
 app.click({level:'1'});
 assert.equal(app.state().arcade.playing,false);
 app.click({level:'0'});
 app.click({action:'arcade-continue'});
 app.frame(65);
 assert.equal(app.state().engine.timing.timestamp,timestamp);
 assert.equal(app.elements.get('arcade-game-title').textContent,'Moon Market');
 app.click({action:'arcade-exit'});
 assert.equal(app.elements.get('playground-page').hidden,false);
 assert.equal(app.state().arcade.active,false);
 assert.deepEqual(app.state().objects.map(body=>body.id),before);
});

test('clearing a siege mission unlocks the next card and retry stays on the current mission',()=>{
 const app=boot();
 for(let tap=0;tap<3;tap++) app.click({action:'arcade-sigil'});
 app.click({game:'orbit'});
 app.click({level:'0'});
 const {arcade}=app.state();
 arcade.begin({x:164,y:344,inside:true},'hand-0');
 arcade.move({x:46,y:352,inside:true},'hand-0');
 arcade.release(true,'hand-0');
 app.frame(290);
 assert.equal(app.elements.get('arcade-round-title').textContent,'Mission cleared');
 app.click({action:'arcade-continue'});
 assert.equal(app.elements.get('arcade-game-title').textContent,'Twin Relay');
 app.click({action:'arcade-map'});
 app.click({level:'2'});
 assert.equal(arcade.browsingLevels,true);
 app.click({level:'1'});
 app.click({action:'arcade-restart'});
 assert.equal(app.elements.get('arcade-game-title').textContent,'Twin Relay');
});

test('Citrus equips the selected sword and draws its tip at each hand’s mapped fingertip',()=>{
 const app=boot();
 for(let tap=0;tap<3;tap++) app.click({action:'arcade-sigil'});
 app.click({game:'citrus'});
 app.click({action:'arcade-blades'});
 const rack=app.elements.get('arcade-blade-rack');
 assert.deepEqual(rack.children.map(item=>item.dataset.blade),BLADES.map(item=>item.id));
 app.click({blade:'ember'});
 const ember=rack.children[1];
 assert.equal(ember.attributes.get('aria-pressed'),'true');
 assert.equal(app.elements.get('arcade-blade-picker').hidden,true);
 app.click({level:'0'});
 app.click({action:'arcade-continue'});
 assert.equal(app.elements.get('arcade-play-blades').textContent,'Blade · Ember Crown');
 const {arcade}=app.state();
 assert.equal(arcade.trackFinger(400,300,350,300,'hand-0'),true);
 assert.equal(arcade.trackFinger(600,200,600,250,'hand-1'),true);
 app.frame();
 const [first,second]=app.bladeDraws;
 assert.deepEqual(first.translation,{x:480,y:270});
 assert.deepEqual(second.translation,{x:720,y:180});
 assert.deepEqual([first.rotation,second.rotation],[0,-Math.PI/2]);
 assert.deepEqual([first.x,first.y],[-BLADE_SPRITE.tipX,-BLADE_SPRITE.tipY]);
 assert.equal(first.image,ember.children[0]);
 assert.equal(second.image,first.image);
 arcade.release(false,'hand-0');
 assert.equal(arcade.trackFinger(810,300,790,300,'hand-1'),false);
 app.frame();
 assert.equal(app.bladeDraws.length,2,'no blade remains after tracking loss or going outside the arena');
 app.click({action:'arcade-blades'});
 const meter=app.elements.get('arcade-meter').textContent;
 assert.equal(arcade.trackFinger(400,300,350,300,'hand-0'),false);
 app.frame(70);
 assert.equal(app.elements.get('arcade-meter').textContent,meter);
 app.click({blade:'jade'});
 assert.equal(app.elements.get('arcade-play-blades').textContent,'Blade · Jade Viper');
});

test('a free-fall trial measures Earth and Moon acceleration and stops before impact',()=>{
 for (const [gravity, expected] of [['earth',9.81],['moon',1.62]]) {
  const app=boot();
  app.click({gravity});
  app.click({action:'lab-drop'});
  app.frame(250);
  const {lab}=app.state();
  assert.match(app.elements.get('lab-status').textContent,/Trial complete/);
  assert.ok(lab.rows.length>20);
  const end=lab.rows.at(-1);
  assert.ok(Math.abs(projected(end,lab.trial.axis).v/end.t-expected)<.015);
  assert.ok(Math.abs(end.t-(lab.rows.length-1)*STEP_MS/1000)<1e-8);
  assert.ok(lab.selected.position.y+lab.selected.circleRadius<560);
  assert.equal(app.elements.get('run-status').textContent,'SIMULATION PAUSED');
  const csv=motionCSV(lab.rows,lab.trial.axis).split('\r\n');
  assert.equal(csv.length,lab.rows.length+1);
  assert.match(csv[0],/time_s.*projected_acceleration_m_s2/);
  assert.equal(csv[1].split(',').at(-1),'');
  assert.ok(Math.abs(Number(csv.at(-1).split(',').at(-1))-expected)<.015);
 }
});

test('parallel blocks measure g sin(theta) on both ramp directions and finish before the end',()=>{
 for(const [angle, flip, gravity] of [[10,false,'earth'],[24,true,'earth'],[45,false,'earth'],[24,true,'moon']]){
  const app=boot();
  app.elements.get('lab-angle').value=String(angle);
  app.elements.get('lab-flip').checked=flip;
  app.click({gravity});
  app.click({action:'lab-incline'});
  app.frame(490);
  const {lab,stats}=app.state();
  assert.equal(stats.platforms,1);
  assert.match(app.elements.get('lab-status').textContent,/Trial complete/);
  const end=lab.rows.at(-1);
  const values=projected(end,lab.trial.axis);
  const measured=values.v/end.t;
  assert.ok(Math.abs(measured-lab.trial.acceleration)<.025, `angle=${angle}, flip=${flip}: measured ${measured}, expected ${lab.trial.acceleration}`);
  assert.ok(values.s>=lab.trial.distance && values.s-lab.trial.distance<.15);
  assert.ok(flip ? end.x<0 : end.x>0);
 }
});

test('placed ramps and slides survive scene round-trip and can be undone',()=>{
 const app=boot();
 app.click({action:'clear'});
 app.elements.get('lab-angle').value='30';
 app.click({action:'lab-ramp'});
 app.pointer('pointerdown',250,280);
 app.elements.get('lab-flip').checked=true;
 app.click({action:'lab-slide'});
 app.pointer('pointerdown',550,385);
 const scene=app.sceneAPI.captureScene();
 assert.equal(scene.construction.platforms[0].length,2);
 const slide=scene.construction.platforms[1];
 assert.equal(slide.length,13);
 assert.ok(slide[0].x>slide.at(-1).x);
 assert.ok(slide[1].y-slide[0].y>slide.at(-1).y-slide.at(-2).y);
 app.sceneAPI.restoreScene(scene);
 assert.equal(app.state().stats.platforms,2);
 app.click({action:'undo-platform'});
 assert.equal(app.state().stats.platforms,1);
});

test('a spawned orb travels down a curved slide under gravity',()=>{
 const app=boot();
 app.click({action:'clear'});
 app.elements.get('lab-angle').value='38';
 app.elements.get('lab-length').value='3.5';
 app.click({action:'lab-slide'});
 app.pointer('pointerdown',380,310);
 const [track]=app.sceneAPI.captureScene().construction.platforms;
 app.click({spawn:'ball'});
 const orb=app.state().objects[0];
 const x=track[2].x, y=track[2].y-orb.circleRadius-12;
 app.Matter.Body.setPosition(orb,{x,y});
 orb.restitution=0;
 app.frame(65);
 assert.ok(orb.position.x>x+90,`orb x=${orb.position.x}, release x=${x}`);
 assert.ok(orb.position.y>y+18,`orb y=${orb.position.y}, release y=${y}`);
});

test('manual recording remains tied to the selected object and respects pause and stop',()=>{
 const app=boot();
 const ball=app.state().objects.find(body=>body.plugin.kind==='ball');
 app.click({action:'lab-pick'});
 app.pointer('pointerdown',ball.position.x,ball.position.y);
 assert.equal(app.state().lab.selected,ball);
 app.click({action:'lab-start'});
 app.frame(10);
 const {lab}=app.state();
 const count=lab.rows.length;
 assert.ok(count>2);
 app.click({action:'pause'});
 app.frame(30);
 assert.equal(lab.rows.length,count);
 app.click({action:'lab-stop'});
 app.click({action:'pause'});
 app.frame(30);
 assert.equal(lab.rows.length,count);
});
test('the live app starts, draws a supporting platform, and routes Shift-stretch correctly',()=>{
 const app=boot();assert.equal(app.state().objects.length,11);
 app.click({action:'clear'});app.click({spawn:'ball'});const ball=app.state().objects[0];app.Matter.Body.setPosition(ball,{x:200,y:100});
 app.click({tool:'draw'});app.pointer('pointerdown',100,300);app.pointer('pointermove',400,300);app.pointer('pointerup',400,300);assert.equal(app.state().stats.platforms,1);assert.match(app.elements.get('build-stats').textContent,/1 platforms/);
 app.frame(150);assert.ok(ball.position.y>260&&ball.position.y<272);
 const oldSize=ball.plugin.size;app.click({tool:'stretch'});app.pointer('pointerdown',ball.position.x+20,ball.position.y,true);app.pointer('pointermove',ball.position.x+45,ball.position.y);app.frame();assert.ok(ball.plugin.size>oldSize);assert.equal(ball.isStatic,true);app.pointer('pointerup',ball.position.x+45,ball.position.y);assert.equal(ball.isStatic,false);
});
test('portal and link tool clicks are integrated and Clear removes their fixtures',()=>{
 const app=boot();app.click({action:'clear'});app.click({spawn:'ball'});const ball=app.state().objects[0];app.Matter.Body.setPosition(ball,{x:200,y:200});
 app.click({tool:'portal'});for(const x of [200,550]){app.pointer('pointerdown',x,350);app.pointer('pointerup',x,350);}assert.equal(app.state().stats.portals,2);
 app.click({tool:'rope'});app.pointer('pointerdown',200,200);app.pointer('pointerup',200,200);app.pointer('pointerdown',200,80);app.pointer('pointerup',200,80);assert.equal(app.state().stats.links,1);
 app.click({action:'clear'});assert.equal(app.state().objects.length,0);assert.equal(app.state().stats.links,0);assert.equal(app.state().stats.portals,0);assert.equal(app.Matter.Composite.allConstraints(app.state().engine.world).length,0);
});

test('new scene presets build bounded connected physics and survive complete scene restoration',()=>{
 const app=boot();for(const scene of ['pendulum','chain','bridge','orbit']){app.click({scene});const before=app.state();assert.ok(before.objects.length>0&&before.objects.length<=35);const snapshot=app.sceneAPI.captureScene();app.click({action:'clear'});app.sceneAPI.restoreScene(snapshot);assert.equal(app.state().objects.length,snapshot.objects.length);assert.equal(app.state().stats.links,snapshot.construction.links.length);app.frame(40);for(const b of app.state().objects)assert.ok(Number.isFinite(b.position.x)&&Number.isFinite(b.position.y));}
});
test('freeze, clone and erase preserve physics and clean dangling constraints',()=>{
 const app=boot();app.click({scene:'pendulum'});const b=app.state().objects[0],p={...b.position};app.click({tool:'freeze'});app.pointer('pointerdown',p.x,p.y);assert.equal(b.isStatic,true);app.click({tool:'clone'});app.pointer('pointerdown',p.x,p.y);assert.equal(app.state().objects.length,3);app.click({tool:'erase'});app.pointer('pointerdown',p.x,p.y);assert.equal(app.state().objects.length,2);assert.equal(app.state().stats.links,1);assert.ok(!app.Matter.Composite.allConstraints(app.state().engine.world).some(c=>c.bodyA===b||c.bodyB===b));
});
test('invalid imported scenes leave the running experiment intact',()=>{const app=boot();const ids=app.state().objects.map(b=>b.id);assert.throws(()=>app.sceneAPI.restoreScene({format:'bad'}));assert.deepEqual(app.state().objects.map(b=>b.id),ids);});
