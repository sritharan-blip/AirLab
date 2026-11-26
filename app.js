import {validateScene} from './scene-format.mjs';
import {clamp, throwVelocity, entersBasket, fieldForce} from './interaction.mjs';
import {createHandControl} from './hand-control.mjs?v=4.8.1';
import {createLabTools,TOOL_HELP} from './lab-tools.mjs';
import {paintSolid} from './solid-art.mjs';
import {createExperimentLab, slopeTrial} from './experiment-lab.mjs';
import {PIXELS_PER_METRE, STEP_MS} from './experiment-math.mjs';
import {makeArcade} from './arcade.mjs';

const $ = selector => document.querySelector(selector);
const {Engine, Bodies, Body, Composite, Constraint, Query} = window.Matter;
const engine = Engine.create({enableSleeping: true});
engine.positionIterations = 6;
const stage = $('#stage'), canvas = $('#world'), ctx = canvas.getContext('2d');
const arcade = makeArcade({get: $, makeElement: tag => document.createElement(tag),
  makeCanvas: () => document.createElement('canvas'), Matter: window.Matter});
let sigilHits = 0, lastSigil = -Infinity;
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
const panelNames = ['build', 'scenes', 'lab', 'tracking'];
const experimentNames = ['tower', 'target', 'shower', 'pendulum', 'chain', 'bridge', 'orbit'];
const uiEasing = 'cubic-bezier(.2,.76,.24,1)';
const uiAnimations = new WeakMap();
let activePanel = 'build';
const overlay = $('#hand-overlay'), handCtx = overlay.getContext('2d');
let width = 800, height = 535, boundaries = [], sceneFixtures = [], objects = [];
let paused = false, scene = 'playground', gravity = 'earth', basket = null, score = 0;
const grabs = new Map(), fields = new Map();
let mode = 'grab';
let curvedPlacement = false;
let lastFrame = performance.now(), accumulator = 0, fpsFrames = 0, fpsStart = lastFrame, toastTimer;
const palette = ['#8ff6df', '#83c7ee', '#ffae79', '#d4f3a3'];
const cached={trails:$('#trails'),motionBlur:$('#motion-blur'),vectors:$('#vectors'),slow:$('#slow-motion'),grab:$('#grab-status'),fps:$('#fps')};
let quality='balanced',frameAverage=16.7,qualitySince=0,lastHud=0,lastTrail=0;
const sprites=new Map();
const materials={rubber:{density:.002,friction:.35,frictionAir:.002,bounce:.85},ice:{density:.0018,friction:.005,frictionAir:.0003,bounce:.3},steel:{density:.008,friction:.4,frictionAir:.001,bounce:.15},cork:{density:.0005,friction:.6,frictionAir:.008,bounce:.45}};
function applyQuality(key){quality=key;document.body.dataset.quality=key;$('#quality-label').textContent=`${key[0].toUpperCase()+key.slice(1)} rendering`;sprites.clear();resize();}
function adaptiveQuality(now,elapsed){
  frameAverage=frameAverage*.96+Math.min(elapsed,100)*.04;
  if($('#performance').value!=='auto'||now-qualitySince<6000)return;
  const next=frameAverage>25?'fast':frameAverage<18?'balanced':quality;
  if(next!==quality){qualitySince=now;applyQuality(next);}
}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function captureScene(){releaseAll();return {format:'airlab-4',width,height,scene,gravity,objects:objects.map(b=>({kind:b.plugin.kind,size:b.plugin.size,color:b.plugin.color,material:b.plugin.material||'rubber',position:{...b.position},velocity:{...b.velocity},angle:b.angle,spin:clamp(b.angularVelocity,-2,2),frozen:b.isStatic,bounce:b.isStatic?(b._original?.restitution??b.restitution):b.restitution})),construction:advanced.serialize()};}
function restoreScene(input){
  const data=validateScene(input);releaseAll();resetScene(data.scene);objects.forEach(b=>Composite.remove(engine.world,b));objects=[];
  for(const b of data.objects){const body=spawn(b.kind,b.position.x,b.position.y,{size:b.size,color:b.color,material:b.material});Body.setAngle(body,b.angle);Body.setVelocity(body,b.velocity);Body.setAngularVelocity(body,b.spin);body.restitution=b.bounce;if(b.frozen){body.plugin.frozenDensity=body.density;Body.setStatic(body,true);}}
  advanced.restore(data.construction);setGravity(data.gravity,false);
  if(data.width!==width||data.height!==height){const sx=width/data.width,sy=height/data.height;objects.forEach(b=>Body.setPosition(b,{x:clamp(b.position.x*sx,10,width-10),y:clamp(b.position.y*sy,10,height-50)}));advanced.resize(sx,sy);}counts();toast('Scene restored. Your experiment is ready.');
}
function saveScene(){try{const data=captureScene();validateScene(data);localStorage.setItem('airlab.scene.v4',JSON.stringify(data));$('#save-status').textContent=`Saved ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;toast('Complete scene saved on this device.');}catch{toast('Could not save this scene. Try exporting it instead.');}}
function addLink(mode,a,b){advanced.begin(mode,a,'preset');advanced.begin(mode,b,'preset');}

const advanced=createLabTools({Matter:window.Matter,engine,getObjects:()=>objects,getBounds:()=>({width,height}),externallyHeld:body=>[...grabs.values()].some(g=>g.body===body),toast,changed:updateBuildStats});
const lab = createExperimentLab({
  get: $, getBounds: () => ({width, height}), getTime: () => engine.timing.timestamp,
  addPlatform: advanced.addPlatform, download, notify: toast
});
function updateBuildStats(state){
  $('#build-stats').textContent=`${state.platforms} platforms · ${state.portals}/2 portals · ${state.links} links`;
  $('[data-action="undo-platform"]').disabled=state.platforms===0;
  $('[data-action="clear-portals"]').disabled=state.portals===0;
  $('[data-action="clear-links"]').disabled=state.links===0;
}
const environments = {earth: {g: 1, value: '9.81', name: 'EARTH GRAVITY', symbol: '◉'}, moon: {g: 1.62 / 9.81, value: '1.62', name: 'MOON GRAVITY', symbol: '☾'}, space: {g: 0, value: '0.00', name: 'ZERO GRAVITY', symbol: '✧'},reverse:{g:-1,value:'−9.81',name:'REVERSED GRAVITY',symbol:'↑'}};

function toast(message) {
  $('#toast').textContent = message;
  $('#arcade-notice').textContent = arcade.active ? message : '';
  $('#toast').classList.add('visible');
  playUI($('#toast'), [
    {transform: 'translate(-50%, 12px) scale(.96)', opacity: 0},
    {transform: 'translate(-50%, 0) scale(1)', opacity: 1}
  ], 260);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $('#toast').classList.remove('visible');
    $('#arcade-notice').textContent = '';
  }, 4200);
}

function motionEnabled() {
  return quality !== 'fast' && !reducedMotion?.matches;
}

function playUI(element, keyframes, duration) {
  uiAnimations.get(element)?.cancel();
  if (!element?.animate || !motionEnabled()) return null;
  const animation = element.animate(keyframes, {duration, easing: uiEasing});
  uiAnimations.set(element, animation);
  return animation;
}

function revealScene() {
  playUI($('#scene-sweep'), [
    {transform: 'translateX(-100%)', opacity: 0},
    {transform: 'translateX(-38%)', opacity: .78, offset: .28},
    {transform: 'translateX(100%)', opacity: 0}
  ], 520);
  playUI($('.stage-heading'), [
    {transform: 'translate3d(-19px, 0, 0)', opacity: .2},
    {transform: 'translate3d(0, 0, 0)', opacity: 1}
  ], 340);
  const started = performance.now();
  objects.forEach((body, index) => {
    body.plugin.appearAt = started + Math.min(index * 16, 190);
  });
}

function syncSceneButtons() {
  for (const button of document.querySelectorAll('[data-scene]')) {
    button.setAttribute('aria-pressed', String(button.dataset.scene === scene));
  }
}

function chooseScene(next) {
  if (scene === 'orbit' && next !== 'orbit' && gravity === 'space') setGravity('earth', false);
  resetScene(next);
  $('#onboarding').hidden = true;
  revealScene();
}

function counts() { $('#object-count').textContent = `${objects.length} / 35`; }
function spawn(kind, x = width * (.2 + Math.random() * .5), y = 155, options = {}) {
  if (objects.length >= 35) { toast('The lab is full. Reset the scene to start fresh.'); return; }
  const size = options.size || (kind === 'ball' ? 27 : 42) * Number($('#object-size').value);
  const material=materials[options.material||$('#material').value]||materials.rubber;
  const physical = {...material,restitution:options.restitution??Number($('#bounce').value)/100};
  const body = kind === 'ball' ? Bodies.circle(x, y, size, physical) : kind === 'triangle' ? Bodies.polygon(x,y,3,size*.7,physical) : Bodies.rectangle(x, y, size, size, {...physical, chamfer: {radius: 5}});
  body.plugin = {kind, color: options.color || palette[objects.length % palette.length], trail: [], size, material:options.material||$('#material').value||'rubber', scored: false};
  Composite.add(engine.world, body); objects.push(body); counts(); return body;
}
function rebuildBounds() {
  boundaries.forEach(b => Composite.remove(engine.world, b));
  boundaries = [Bodies.rectangle(width / 2, height + 10, width + 100, 100, {isStatic: true}), Bodies.rectangle(-30, height / 2, 60, height * 2, {isStatic: true}), Bodies.rectangle(width + 30, height / 2, 60, height * 2, {isStatic: true}), Bodies.rectangle(width / 2, -45, width + 100, 90, {isStatic: true})];
  Composite.add(engine.world, boundaries);
}
function isHeld(body) {return advanced.hasBody(body)||[...grabs.values()].some(g=>g.body===body);}
function release(throwIt = true, owner = 'mouse') {
  advanced.release(throwIt,owner);
  fields.delete(owner);
  const grab=grabs.get(owner);if(!grab)return;
  Composite.remove(engine.world,grab.constraint);
  Body.setVelocity(grab.body,throwIt&&!paused?throwVelocity(grab.history):{x:0,y:0});
  grabs.delete(owner);
}
function releaseAll() {
  arcade.cancel();
  for(const owner of [...grabs.keys(),...fields.keys()])release(false,owner);
  advanced.cancelActive();
  handControl?.releaseAll();
}
function rebuildBasket() {
  for (const body of sceneFixtures) Composite.remove(engine.world, body);
  const floor = height - 40;
  basket = {x: width * .77, half: Math.min(60, width * .12), rim: floor - 125};
  const bottom = floor - 22;
  const wallHeight = bottom - basket.rim + 8;
  const wallY = (basket.rim + bottom) / 2;
  sceneFixtures = [
    Bodies.rectangle(basket.x - basket.half, wallY, 9, wallHeight, {isStatic: true}),
    Bodies.rectangle(basket.x + basket.half, wallY, 9, wallHeight, {isStatic: true}),
    Bodies.rectangle(basket.x, bottom, basket.half * 2, 9, {isStatic: true})
  ];
  Composite.add(engine.world, sceneFixtures);
}

function resetScene(next = scene) {
  lab.clearSelection();
  releaseAll(); advanced.clearAll(); scene = next;
  objects.forEach(body => Composite.remove(engine.world, body)); objects = [];
  sceneFixtures.forEach(body => Composite.remove(engine.world, body)); sceneFixtures = [];
  basket = null; score = 0; $('#score').textContent = '0';
  $('#challenge-score').hidden = scene !== 'target';
  const floor = height - 40;
  if(['pendulum','chain','bridge','orbit'].includes(scene)){
    if(scene==='pendulum'){
      const a=spawn('ball',width*.32,height*.53,{size:30}),b=spawn('ball',width*.63,height*.55,{size:24});
      addLink('rope',a.position,{x:width*.32,y:120});addLink('rope',b.position,{x:width*.63,y:120});Body.setVelocity(a,{x:8,y:0});
      $('#scene-title').textContent='Pendulum lab';$('#scene-description').textContent='Pull, release, and watch energy move.';
    }else if(scene==='chain'||scene==='bridge'){
      let previous={x:width*.15,y:height*.38};
      for(let i=0;i<7;i++){const b=spawn(scene==='bridge'?'box':'ball',width*(.23+i*.085),height*.4,{size:scene==='bridge'?31:18});addLink(scene==='bridge'?'rope':'spring',previous,b.position);previous={...b.position};}
      if(scene==='bridge'){addLink('rope',previous,{x:width*.88,y:height*.38});spawn('ball',width*.5,145,{size:28});}
      $('#scene-title').textContent=scene==='bridge'?'Suspension bridge':'Spring cascade';$('#scene-description').textContent='Grab a node. Change the shape of the system.';
    }else{for(let i=0;i<16;i++){const angle=i*Math.PI/8;const b=spawn(i%4===0?'triangle':'ball',width*.5+Math.cos(angle)*width*.24,height*.52+Math.sin(angle)*height*.24,{size:14+i%3*5});Body.setVelocity(b,{x:-Math.sin(angle)*2,y:Math.cos(angle)*2});}setGravity('space',false);$('#scene-title').textContent='Zero-G constellation';$('#scene-description').textContent='No orbital gravity. Just momentum and your force fields.';}
  } else if (scene === 'target') {
    rebuildBasket();
    spawn('ball', width * .23, floor - 28, {color: palette[0], size: 23});
    $('#scene-title').textContent = 'Make the shot'; $('#scene-description').textContent = 'Throw an orb into the basket. Find your perfect arc.';
  } else if (scene === 'shower') {
    for(let i=0;i<18;i++) spawn(i%4===0?'triangle':'ball',width*(.12+(i%6)*.15),150+Math.floor(i/6)*70,{size:18+(i%3)*5});
    $('#scene-title').textContent='Orb shower';$('#scene-description').textContent='Try the magnet with two hands. Shape the motion.';
  } else if(scene === 'empty') {
    $('#scene-title').textContent='A blank canvas';$('#scene-description').textContent='Add shapes and build your own experiment.';
  } else {
    const towerX = width * .67;
    for (let row = 0; row < 4; row++) for (let col = 0; col < 2; col++) spawn('box', towerX + (col - .5) * 43, floor - 21 - row * 43, {color: row % 2 ? '#7db6b7' : '#a7d8d3', size: 40});
    spawn('ball', width * .28, floor - 45, {size: 40, color: palette[0]});
    spawn('ball', width * .43, height * .4, {size: 23, color: palette[2]});
    spawn('box', width * .12, height * .45, {size: 33, color: palette[3]});
    $('#scene-title').textContent = scene === 'tower' ? 'Knock it down' : 'The playground';
    $('#scene-description').textContent = scene === 'tower' ? 'Send the orb into the tower. Explore momentum.' : 'Drag an object to explore momentum.';
  }
  syncSceneButtons();
  counts();
}
function resize() {
  const dpr = Math.min(devicePixelRatio || 1,quality==='fast'?1:quality==='quality'?1.6:1.25);
  overlay.width = innerWidth * dpr;
  overlay.height = innerHeight * dpr;
  handCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (arcade.active) return;
  const oldW = width, oldH = height;
  const rect = canvas.getBoundingClientRect(); width = rect.width; height = rect.height;
  canvas.width = width * dpr; canvas.height = height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if(boundaries.length&&Math.abs(oldW-width)<.5&&Math.abs(oldH-height)<.5)return;
  if (lab.recording) lab.stop('Canvas resized. Start a new recording to compare distances.');
  releaseAll(); rebuildBounds();
  objects.forEach(body => {
    Body.setPosition(body, {x: clamp(body.position.x * width / oldW, 35, width - 35), y: clamp(body.position.y * height / oldH, 35, height - 45)});
    body.plugin.trail = [];
  });
  advanced.resize(width / oldW, height / oldH);
  if (basket) rebuildBasket();
}
new ResizeObserver(resize).observe(stage);
window.addEventListener('resize', resize);

function setGravity(key,drift=true) {
  if (lab.controlled && key !== gravity) lab.stop('Gravity changed. Rerun the trial to compare with theory.');
  gravity = key; const env = environments[key]; engine.gravity.y = env.g;
  $('[data-gravity].selected')?.classList.remove('selected'); $(`[data-gravity="${key}"]`).classList.add('selected');
  $('#gravity-value').textContent = env.value; $('#gravity-name').textContent = env.name; $('#gravity-symbol').textContent = env.symbol;
  document.body.dataset.gravity = key;
  playUI($('.gravity-readout'), [
    {transform: 'translateY(7px)', opacity: .55},
    {transform: 'translateY(0)', opacity: 1}
  ], 300);
  if (key === 'space'&&drift) objects.forEach(b => Body.setVelocity(b, {x: (Math.random() - .5) * 2.5, y: -1 - Math.random() * 2}));
}
function updatePause() {
  const button = $('#pause');
  button.textContent = paused ? '▶' : 'Ⅱ';
  button.setAttribute('aria-label', paused ? 'Resume physics' : 'Pause physics');
  button.title = paused ? 'Resume physics' : 'Pause physics';
  stage.dataset.paused = String(paused);
  $('#run-status').textContent = paused ? 'SIMULATION PAUSED' : 'SIMULATION LIVE';
  playUI(button, [{transform: 'scale(.78) rotate(-12deg)'}, {transform: 'scale(1) rotate(0deg)'}], 260);
}
function pointToStage(clientX, clientY) {const r = canvas.getBoundingClientRect(); return {x: clientX - r.left, y: clientY - r.top};}
function beginGrab(point, owner = 'mouse', options={}) {
  if (mode === 'measure') {
    const body = Query.point(objects, point).at(-1);
    if (body) {
      lab.select(body);
      setTool('grab');
    } else toast('Click or pinch directly on an object.');
    return;
  }
  if (lab.controlled) lab.stop('The trial was interrupted by a playground interaction.');
  if (mode === 'ramp') {
    lab.place(point, curvedPlacement);
    $('#onboarding').hidden = true;
    return;
  }
  if(['stretch','draw','portal','rope','spring'].includes(mode)){advanced.begin(mode,point,owner,options);$('#onboarding').hidden=true;return;}
  if(['freeze','clone','erase'].includes(mode)){
    const body=Query.point(objects,point).reverse().find(b=>!isHeld(b));if(!body)return;
    if(mode==='freeze'){if(body.isStatic){Body.setStatic(body,false);Body.setDensity(body,body.plugin.frozenDensity||materials[body.plugin.material].density);}else{body.plugin.frozenDensity=body.density;Body.setStatic(body,true);}body.plugin.trail=[];toast(body.isStatic?'Object frozen in place.':'Object released.');}
    else if(mode==='clone'){const clone=spawn(body.plugin.kind,clamp(body.position.x+45,30,width-35),clamp(body.position.y-45,35,height-70),{size:body.plugin.size,color:body.plugin.color,material:body.plugin.material});if(clone){clone.restitution=body.restitution;Body.setAngle(clone,body.angle);}}
    else{if(lab.selected===body)lab.clearSelection();advanced.removeBody(body);Composite.remove(engine.world,body);objects=objects.filter(b=>b!==body);counts();}return;
  }
  if(grabs.has(owner)||fields.has(owner))return;
  if(mode!=='grab'){fields.set(owner,{point,mode});return;}
  const body=Query.point(objects,point).reverse().find(b=>!isHeld(b));
  if(!body||body.isStatic)return;
  window.Matter.Sleeping.set(body,false);
  const constraint=Constraint.create({pointA:{x:point.x,y:point.y},bodyB:body,pointB:{x:0,y:0},stiffness:.22,damping:.12,length:0});
  grabs.set(owner,{body,constraint,point,history:[{...point,t:performance.now()}]});
  Composite.add(engine.world,constraint);Body.setVelocity(body,{x:0,y:0});$('#onboarding').hidden=true;
}
function moveGrab(point,owner = 'mouse') {
  advanced.move(point,owner);
  if(fields.has(owner)){fields.get(owner).point=point;return;}
  const grab=grabs.get(owner);if(!grab)return;
  grab.point=point;grab.constraint.pointA={x:clamp(point.x,0,width),y:clamp(point.y,0,height-40)};
  if(paused)Body.setPosition(grab.body,grab.constraint.pointA);
  grab.history.push({...point,t:performance.now()});grab.history=grab.history.filter(p=>p.t>performance.now()-140);
}
canvas.addEventListener('pointerdown',e=>{canvas.setPointerCapture(e.pointerId);beginGrab(pointToStage(e.clientX,e.clientY),`pointer-${e.pointerId}`,{shift:e.shiftKey});});
canvas.addEventListener('pointermove',e=>moveGrab(pointToStage(e.clientX,e.clientY),`pointer-${e.pointerId}`));
canvas.addEventListener('pointerup',e=>{moveGrab(pointToStage(e.clientX,e.clientY),`pointer-${e.pointerId}`);release(true,`pointer-${e.pointerId}`,{shift:e.shiftKey});});
canvas.addEventListener('pointercancel',e=>release(false,`pointer-${e.pointerId}`));
const handControl=createHandControl({
  stagePoint:(x,y)=>{
    if (arcade.active) return arcade.point(x,y);
    const p=pointToStage(x,y);
    return {...p,inside:p.x>=0&&p.x<=width&&p.y>=0&&p.y<=height-36};
  },
  begin:(point,id)=>arcade.active ? arcade.begin(point,id) : beginGrab(point,id),
  move:(point,id)=>arcade.active ? arcade.move(point,id) : moveGrab(point,id),
  release:(commit,id)=>arcade.active ? arcade.release(commit,id) : release(commit,id),
  tracksFinger:()=>arcade.tracksFinger,
  trackFinger:arcade.trackFinger,
  isGrabbing:id=>grabs.has(id)||fields.has(id)||advanced.isActive(id),toast,
  getMode:()=>arcade.active ? arcade.mode : mode
});

function syncArcadePage() {
  const visible = window.location?.hash === '#arcade';
  if (visible === arcade.active) return;
  releaseAll();
  lastFrame = performance.now();
  accumulator = 0;
  fpsFrames = 0;
  fpsStart = lastFrame;
  arcade.show(visible);
  $('#arcade-notice').textContent = '';
  $('#playground-page').hidden = visible;
  $('#lab-navigation').hidden = visible;
  const preview = $('#camera-preview');
  (visible ? $('#arcade-preview-slot') : stage).append(preview);
  document.body.dataset.page = visible ? 'arcade' : 'playground';
  if (visible) $('#arcade-heading').focus();
  else resize();
}

function enterArcade() {
  if (arcade.active || document.fullscreenElement) return;
  window.history.pushState(null, '', '#arcade');
  syncArcadePage();
}

function leaveArcade() {
  if (!arcade.active) return;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  syncArcadePage();
  $('#brand-home').focus();
}

window.addEventListener('hashchange', syncArcadePage);
$('#brand-home').addEventListener('click', event => {
  if (!arcade.active) return;
  event.preventDefault();
  leaveArcade();
});

function showPanel(name) {
  if (name === activePanel || !panelNames.includes(name)) return;
  const previous = activePanel;
  const direction = Math.sign(panelNames.indexOf(name) - panelNames.indexOf(previous));
  activePanel = name;
  $('#panel-nav').dataset.activePanel = name;

  for (const key of panelNames) {
    const panel = $('#panel-' + key);
    const incoming = key === name;
    panel.inert = !incoming;
    panel.setAttribute('aria-hidden', String(!incoming));
    if (incoming) {
      panel.hidden = false;
      panel.classList.add('is-current');
      playUI(panel, [
        {transform: `translate3d(${direction * 42}px, 0, 0)`, opacity: .35},
        {transform: 'translate3d(0, 0, 0)', opacity: 1}
      ], 300);
    } else {
      panel.classList.remove('is-current');
      uiAnimations.get(panel)?.cancel();
      const outgoing = key === previous && playUI(panel, [
        {transform: 'translate3d(0, 0, 0)', opacity: 1},
        {transform: `translate3d(${-direction * 38}px, 0, 0)`, opacity: 0}
      ], 220);
      if (outgoing) {
        outgoing.finished.then(() => {
          if (activePanel !== key) panel.hidden = true;
        }, () => {});
      } else {
        panel.hidden = true;
      }
    }
  }
  for (const button of document.querySelectorAll('[data-panel]')) {
    button.setAttribute('aria-pressed', String(button.dataset.panel === name));
  }
  if (name === 'lab') lab.render(true);
}

function setFocusMode(enabled) {
  document.body.classList.toggle('focus-mode', enabled);
  $('[data-action="focus"]').setAttribute('aria-pressed', String(enabled));
}

function setTool(name, source) {
  if (name === mode) return;
  releaseAll();
  mode = name;
  for (const tool of document.querySelectorAll('[data-tool]')) {
    const selected = tool.dataset.tool === mode;
    tool.classList.toggle('selected', selected);
    tool.setAttribute('aria-pressed', String(selected));
  }
  $('#tool-hint').textContent = TOOL_HELP[mode];
  if (source) playUI(source, [{transform: 'scale(.88)'}, {transform: 'scale(1.05)', offset: .68}, {transform: 'scale(1)'}], 280);
  playUI($('#tool-hint'), [{transform: 'translateX(-10px)', opacity: .2}, {transform: 'translateX(0)', opacity: 1}], 245);
}

function beginExperiment(type) {
  const incline = type === 'incline';
  const points = incline && lab.pathAt({x: width / 2, y: height * .54});
  if (incline && !points) {
    toast('Make the playground larger to fit an incline.');
    return;
  }
  const down = environments[gravity].g > 0 ? gravity : 'earth';
  const g = environments[down].g * 9.81;
  const requestedDistance = Number($('#lab-drop-distance').value) || 1.5;
  const dropDistance = Math.min(requestedDistance, (height - 157) / PIXELS_PER_METRE);
  const trial = incline ? slopeTrial(points, g) : {
    axis: {x: 0, y: -1}, distance: dropDistance, acceleration: g,
    model: 'Free fall from rest · a = g'
  };
  if (trial.distance < .25) {
    toast('Make the playground larger for a usable measurement distance.');
    return;
  }
  trial.kind = type;
  resetScene('empty');
  setGravity(down, false);
  setTool('grab');
  $('#onboarding').hidden = true;
  let body;
  if (incline) {
    advanced.addPlatform(points);
    const start = points[0];
    const {x: dx, y: up} = trial.axis;
    const dy = -up;
    const blockSize = 28;
    const normalOffset = Math.sign(dx) * (6 + blockSize / 2 + .15);
    body = spawn('box', start.x + dx * 37 + dy * normalOffset, start.y + dy * 37 - dx * normalOffset,
      {size: blockSize, material: 'ice', color: '#8ff6df', restitution: 0});
    // Keep the collision square parallel to the slope in both orientations.
    Body.setAngle(body, Math.atan(dy / dx));
    Body.setInertia(body, Infinity);
  } else {
    const releaseY = height - 40 - 40 - dropDistance * PIXELS_PER_METRE;
    body = spawn('ball', width * .52, releaseY, {size: 20, color: '#83c7ee', restitution: 0});
  }
  body.friction = body.frictionStatic = body.frictionAir = 0;
  $('#scene-title').textContent = incline ? 'Incline test' : 'Free-fall test';
  $('#scene-description').textContent = incline
    ? `Frictionless block · ${Math.round(Math.asin(-trial.axis.y) * 180 / Math.PI)}° incline`
    : `Drop from rest · ${dropDistance.toFixed(2)} m measured`;
  revealScene();
  paused = false;
  accumulator = 0;
  updatePause();
  lab.start(body, trial);
  $('#panel-lab').scrollTop = $('#lab-readout').offsetTop;
}

document.addEventListener('click', async e => {
  const button = e.target.closest('button'); if (!button || button.disabled) return;
  if (button.dataset.game && arcade.active) {
    releaseAll();
    arcade.openGame(button.dataset.game);
    return;
  }
  if (button.dataset.level !== undefined && arcade.active) {
    releaseAll();
    arcade.launch(Number(button.dataset.level));
    return;
  }
  if (button.dataset.blade && arcade.active) {
    arcade.equipBlade(button.dataset.blade);
    return;
  }
  if (button.dataset.panel) showPanel(button.dataset.panel);
  if (button.dataset.gravity) setGravity(button.dataset.gravity);
  if (button.dataset.tool) setTool(button.dataset.tool, button);


  const newObject = button.dataset.spawn && spawn(button.dataset.spawn);
  if (newObject) {
    if (lab.controlled) lab.stop('An object was added. Rerun the trial to compare with theory.');
    newObject.plugin.appearAt = performance.now();
    playUI(button, [{transform: 'translateY(1px) scale(.94)'}, {transform: 'translateY(-3px) scale(1.02)', offset: .62}, {transform: 'translateY(0) scale(1)'}], 270);
    $('#onboarding').hidden = true;
  }
  if (button.dataset.scene) chooseScene(button.dataset.scene);
  switch (button.dataset.action) {
    case 'arcade-sigil': {
      const now = performance.now();
      sigilHits = now - lastSigil <= 1450 ? sigilHits + 1 : 1;
      lastSigil = now;
      if (sigilHits === 3) { sigilHits = 0; enterArcade(); }
      break;
    }
    case 'arcade-exit': leaveArcade(); break;
    case 'arcade-lobby': releaseAll(); arcade.lobby(); $('#arcade-heading').focus(); break;
    case 'arcade-map': releaseAll(); arcade.openMap(); break;
    case 'arcade-blades': arcade.toggleBladePicker(button); break;
    case 'arcade-close-blades': arcade.dismissBladePicker(); break;
    case 'arcade-pause': arcade.togglePause(); break;
    case 'arcade-pulse': arcade.pulse(); break;
    case 'arcade-continue': arcade.advance(); break;
    case 'arcade-restart':
      releaseAll();
      arcade.restart();
      break;
    case 'open-lab':
      setFocusMode(false);
      showPanel('lab');
      $('[data-panel="lab"]').focus({preventScroll: true});
      $('.inspector').scrollIntoView({block: 'nearest'});
      break;
    case 'lab-ramp':
    case 'lab-slide':
      curvedPlacement = button.dataset.action === 'lab-slide';
      setTool('ramp', button);
      stage.scrollIntoView({block: 'nearest'});
      break;
    case 'lab-pick':
      setTool('measure', button);
      stage.scrollIntoView({block: 'nearest'});
      break;
    case 'lab-incline': beginExperiment('incline'); break;
    case 'lab-drop': beginExperiment('drop'); break;
    case 'lab-repeat': if (lab.trial) beginExperiment(lab.trial.kind); break;
    case 'lab-start':
      if (lab.start() && paused) { paused = false; updatePause(); }
      break;
    case 'lab-stop': lab.stop('Recording stopped. Export or inspect your data.'); break;
    case 'lab-csv': lab.exportCSV(); break;
    case 'show-tracking':
      setFocusMode(false);
      showPanel('tracking');
      $('#camera-source').focus({preventScroll: true});
      $('.inspector').scrollIntoView({block: 'nearest'});
      break;
    case 'show-scenes':
      showPanel('scenes');
      $('[data-panel="scenes"]').focus({preventScroll: true});
      $('.inspector').scrollIntoView({block: 'nearest'});
      break;
    case 'shuffle-scene': {
      const choices = experimentNames.filter(name => name !== scene);
      chooseScene(choices[Math.floor(Math.random() * choices.length)]);
      break;
    }
    case 'focus': setFocusMode(!document.body.classList.contains('focus-mode'));break;
    case 'save-scene': saveScene();break;
    case 'load-scene': try{const saved=localStorage.getItem('airlab.scene.v4');if(!saved)toast('Save a scene first.');else restoreScene(JSON.parse(saved));}catch{toast('This saved scene could not be restored.');}break;
    case 'export-scene': try{const data=captureScene();validateScene(data);download(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),'AirLab-scene.json');}catch{toast('Could not export this scene.');}break;
    case 'import-scene': $('#scene-file').click();break;
    case 'camera': await handControl.toggle(); break;
    case 'clear': resetScene('empty'); revealScene(); break;
    case 'undo-platform': if (lab.controlled) lab.stop('The track changed.'); advanced.undoPlatform(); break;
    case 'clear-portals': advanced.clearPortals(); break;
    case 'clear-links': advanced.clearLinks(); break;
    case 'snapshot':
      canvas.toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='AirLab-experiment.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);});break;
    case 'reset': resetScene(); revealScene(); break;
    case 'pause': paused = !paused; updatePause(); break;
    case 'dismiss': $('#onboarding').hidden = true; break;
    case 'guide': {
      releaseAll();
      const guide = $('#guide');
      guide.showModal();
      playUI(guide, [
        {transform: 'translateY(22px) scale(.96)', opacity: 0},
        {transform: 'translateY(0) scale(1)', opacity: 1}
      ], 350);
      break;
    }
    case 'close-guide': $('#guide').close(); break;
    case 'playground': stage.scrollIntoView({behavior: 'smooth', block: 'center'}); break;
    case 'fullscreen':
      try {if (document.fullscreenElement) await document.exitFullscreen(); else await $('.lab-shell').requestFullscreen();} catch {toast('Fullscreen is unavailable in this browser.');} break;
  }
});
$('#scene-file').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;try{if(file.size>300000)throw new Error('Scene file too large (300 KB maximum).');restoreScene(JSON.parse(await file.text()));}catch(error){toast(error.message||'Could not import this scene.');}finally{e.target.value='';}});
$('#performance').addEventListener('change',()=>{qualitySince=performance.now();applyQuality($('#performance').value==='auto'?'balanced':$('#performance').value);});
$('#preview-toggle').addEventListener('change',()=>$('#camera-preview').hidden=!handControl.cameraOpen||!$('#preview-toggle').checked);
$('#hand-smoothing').addEventListener('input',()=>$('#smoothing-value').textContent=Number($('#hand-smoothing').value)<40?'Steady':Number($('#hand-smoothing').value)>60?'Responsive':'Balanced');
cached.trails.addEventListener('change',()=>objects.forEach(b=>b.plugin.trail=[]));
$('#material').addEventListener('change',()=>{const m=materials[$('#material').value];$('#bounce').value=Math.round(m.bounce*100);$('#bounce-value').textContent=`${$('#bounce').value}%`;toast('Material applies to new objects.');});
try{if(localStorage.getItem('airlab.scene.v4'))$('#save-status').textContent='A saved scene is available';}catch{}
$('#bounce').addEventListener('input', () => {
  if (lab.controlled) lab.stop('Bounciness changed. Rerun the trial to compare with theory.');
  const n = Number($('#bounce').value);
  $('#bounce-value').textContent = `${n}%`;
  objects.forEach(body => body.restitution = n / 100);
});
$('#object-size').addEventListener('input',()=>{const n=Number($('#object-size').value);$('#size-value').textContent=n<.85?'Small':n>1.15?'Large':'Medium';});
$('#guide').addEventListener('click', e => {if (e.target === $('#guide')) {const r = $('#guide').getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) $('#guide').close();}});

// Each shape and material is rasterized once. Resizing and rotating a body just
// scales and rotates its cached sprite, even while a hand is stretching it.
function solidSprite(kind, color, material) {
  const key = `${kind}/${color}/${material}`;
  if (sprites.has(key)) return sprites.get(key);
  if (sprites.size >= 72) sprites.delete(sprites.keys().next().value);
  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = quality === 'fast' ? 144 : 240;
  const context = sprite.getContext('2d');
  context.translate(sprite.width / 2, sprite.height / 2);
  context.scale(sprite.width / 2.36, sprite.height / 2.36);
  paintSolid(context, kind, color, material);
  sprites.set(key, sprite);
  return sprite;
}

function drawGroundShadow(body) {
  const floor = height - 40;
  const radius = body.circleRadius || body.plugin.size * .6;
  const gap = Math.max(0, floor - body.position.y - radius);
  if (gap > 160 || body.position.y < 0) return;
  const spread = radius + gap * .15;
  ctx.fillStyle = `rgba(0,0,0,${.46 * (1 - gap / 160)})`;
  ctx.beginPath();
  ctx.ellipse(body.position.x + 5, floor + 4, spread, Math.min(7, spread * .2), 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawBody(body, now, animated) {
  const {color, trail, kind, size} = body.plugin;
  if (cached.trails.checked&&quality!=='fast' && trail.length > 1) {
    ctx.beginPath(); trail.forEach((p,i) => i ? ctx.lineTo(p.x,p.y) : ctx.moveTo(p.x,p.y));
    ctx.strokeStyle = `${color}35`; ctx.lineWidth = kind === 'ball' ? Math.min(size * .7, 16) : 7; ctx.lineCap = 'round'; ctx.stroke();
  }
  const sprite = solidSprite(kind, color, body.plugin.material);
  const extent = size * 2.36;
  const angle = kind === 'ball' ? 0 : body.angle;
  const appearing = animated && body.plugin.appearAt !== undefined;
  const progress = appearing ? clamp((now - body.plugin.appearAt) / 255, 0, 1) : 1;
  const eased = 1 - (1 - progress) ** 3;
  const visualSize = extent * (1 - .23 * (1 - eased));
  const x = body.position.x;
  const y = body.position.y;

  if (progress > 0 && progress < 1) {
    ctx.strokeStyle = color;
    ctx.save();
    ctx.globalAlpha = (1 - eased) * .6;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, size * (.5 + eased * .72), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Reuse the lit silhouette for short motion blur samples.
  if (cached.motionBlur.checked && animated && !paused && !body.isStatic && !body.isSleeping && body.speed > 3) {
    const exposure = Math.min(.95, 23 / body.speed) * (cached.slow.checked ? .3 : 1);
    const samples = quality === 'quality' ? 4 : 2;
    for (let index = samples; index > 0; index--) {
      const offset = exposure * index / samples;
      ctx.save();
      ctx.translate(x - body.velocity.x * offset, y - body.velocity.y * offset);
      ctx.rotate(angle - (kind === 'ball' ? 0 : body.angularVelocity * offset));
      ctx.globalAlpha = (.17 - .09 * index / samples) * (.45 + eased * .55);
      ctx.drawImage(sprite, -visualSize / 2, -visualSize / 2, visualSize, visualSize);
      ctx.restore();
    }
  }

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.globalAlpha = .48 + eased * .52;
  ctx.drawImage(sprite, -visualSize / 2, -visualSize / 2, visualSize, visualSize);
  ctx.globalAlpha = 1;
  if(body.isStatic){ctx.fillStyle='#fff';ctx.font='12px Segoe UI';ctx.textAlign='center';ctx.fillText('❄',0,4);ctx.textAlign='left';}
  if (lab.selected === body) {
    ctx.strokeStyle = '#a5f9ef';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.arc(0, 0, size * (kind === 'ball' ? 1 : .86) + 11, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (isHeld(body)) {ctx.strokeStyle = '#e2ffaa';ctx.lineWidth = 2;ctx.setLineDash([4,4]);ctx.beginPath();ctx.arc(0,0,(kind==='ball'?size:size*.71)+7,0,Math.PI*2);ctx.stroke();}
  ctx.restore();
  if (cached.vectors.checked && body.speed > .5) {
    const {x,y} = body.position, vx = body.velocity.x * 6, vy = body.velocity.y * 6, angle = Math.atan2(vy,vx);
    ctx.strokeStyle = '#edffb2';ctx.lineWidth = 1.4;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+vx,y+vy);ctx.lineTo(x+vx-7*Math.cos(angle-.4),y+vy-7*Math.sin(angle-.4));ctx.moveTo(x+vx,y+vy);ctx.lineTo(x+vx-7*Math.cos(angle+.4),y+vy-7*Math.sin(angle+.4));ctx.stroke();
  }
}
function draw(now) {
  const animated = motionEnabled();
  ctx.fillStyle = '#11191b';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#0a1113';
  ctx.fillRect(0, height - 40, width, 40);
  ctx.fillStyle = '#2a3d40';
  ctx.fillRect(0, height - 41, width, 1);
  if (quality !== 'fast') objects.forEach(drawGroundShadow);
  if (basket) {
    ctx.strokeStyle = '#d4f88766';ctx.lineWidth = 2;
    for(const body of sceneFixtures) {ctx.beginPath();body.vertices.forEach((v,i)=>i?ctx.lineTo(v.x,v.y):ctx.moveTo(v.x,v.y));ctx.closePath();ctx.fillStyle='#c3e2a51a';ctx.fill();ctx.stroke();}
    ctx.fillStyle = '#bad695';ctx.font = '9px Arial';ctx.textAlign='center';ctx.fillText('LAND IT HERE',basket.x,basket.rim-18);ctx.textAlign='left';
  }
  advanced.draw(ctx, now, animated);
  for (const object of objects) drawBody(object, now, animated);
  for(const g of grabs.values()){ctx.beginPath();ctx.moveTo(g.body.position.x,g.body.position.y);ctx.lineTo(g.point.x,g.point.y);ctx.strokeStyle='#dcffb680';ctx.lineWidth=1.2;ctx.stroke();}
  for (const field of fields.values()) {
    const {x, y} = field.point;
    const attracts = field.mode === 'magnet';
    ctx.strokeStyle = attracts ? '#7de7ec83' : '#ffbc8983';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 100, 0, Math.PI * 2);
    ctx.setLineDash([4, 8]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (animated) {
      const progress = (now % 780) / 780;
      ctx.save();
      ctx.globalAlpha = Math.sin(progress * Math.PI) * .64;
      ctx.beginPath();
      ctx.arc(x, y, attracts ? 96 - 73 * progress : 23 + 73 * progress, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = ctx.strokeStyle;
    ctx.font = '11px Arial';
    ctx.fillText(attracts ? 'ATTRACT' : 'REPEL', x + 12, y - 12);
  }
  if(now-lastHud>250){lastHud=now;cached.grab.textContent=advanced.stats().stretching?'STRETCH · SPREAD OR TWIST YOUR HANDS':grabs.size?`${grabs.size} OBJECT${grabs.size>1?'S':''} HELD · RELEASE TO THROW`:fields.size?'FORCE FIELD ACTIVE':handControl.active?'POINT · PINCH · PLAY':'CLICK + DRAG TO EXPLORE';}

}
function frame(now) {
  const rawElapsed=now-lastFrame;const elapsed = Math.min(rawElapsed, 50);lastFrame=now;
  if(!document.hidden)adaptiveQuality(now,rawElapsed);
  handControl.tick(now);
  if (arcade.active) {
    if (!document.hidden) arcade.frame(now, elapsed, handControl, motionEnabled());
    requestAnimationFrame(frame);
    return;
  }
  if (!paused && !document.hidden) {
    accumulator += elapsed * (cached.slow.checked ? .3 : 1);
    let steps=0;
    while(accumulator >= STEP_MS && steps < 3) {
      const previous = basket||advanced.stats().portals===2?new Map(objects.map(b=>[b.id,{...b.position}])):new Map();
      for(const field of fields.values())for(const body of objects)if(!isHeld(body)&&!body.isStatic){const force=fieldForce(body,field.point,field.mode);if(force.x||force.y)window.Matter.Sleeping.set(body,false);Body.applyForce(body,body.position,force);}
      advanced.beforeStep();
      Engine.update(engine,STEP_MS); accumulator-=STEP_MS;steps++;
      const teleported=advanced.afterStep(previous,engine.timing.timestamp);
      if (lab.step(teleported)) {
        paused = true;
        accumulator = 0;
        updatePause();
        break;
      }
      objects.forEach(b=>{
        if (basket && !teleported.has(b.id) && b.plugin.kind==='ball' && !isHeld(b) && !b.plugin.scored && entersBasket(previous.get(b.id),b.position,basket,b.circleRadius)) {
          b.plugin.scored = true;
          score++;
          $('#score').textContent = score;
          playUI($('#challenge-score'), [
            {transform: 'translateY(4px) scale(.95)'},
            {transform: 'translateY(-5px) scale(1.10)', offset: .45},
            {transform: 'translateY(0) scale(1)'}
          ], 410);
          toast('Nice shot! +1. Add an orb to go again.');
        }
      });
    }
    if(now-lastTrail>32&&cached.trails.checked&&quality!=='fast'){lastTrail=now;objects.forEach(b=>{if(b.speed>.35 || isHeld(b)){b.plugin.trail.push({...b.position});if(b.plugin.trail.length>24)b.plugin.trail.shift();}else if(b.plugin.trail.length)b.plugin.trail.shift();});}
  } else {accumulator=0;advanced.beforeStep();}
  if(!document.hidden) {
    draw(now);
    if (activePanel === 'lab') lab.render(false, now);
  }
  fpsFrames++;
  if(now-fpsStart>600){cached.fps.textContent=Math.round(fpsFrames*1000/(now-fpsStart));fpsFrames=0;fpsStart=now;}
  requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange',()=>{
  releaseAll();
  if (document.hidden) arcade.suspend();
  lastFrame=performance.now();accumulator=0;
});
document.addEventListener('fullscreenchange',()=>{
  const parent = document.fullscreenElement || document.body;
  parent.append(overlay);
  resize();
});
window.addEventListener('blur', () => { releaseAll(); arcade.suspend(); });
document.addEventListener('keydown', e => {
  if (e.target.closest('input,select,textarea') || $('#guide').open) return;
  if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !e.repeat && e.code === 'KeyG') {
    e.preventDefault();
    if (arcade.active) leaveArcade();
    else enterArcade();
    return;
  }
  if (arcade.active && e.code === 'Escape') {
    e.preventDefault();
    if (arcade.dismissBladePicker()) return;
    if (arcade.playing) { releaseAll(); arcade.openMap(); }
    else if (arcade.browsingLevels) { releaseAll(); arcade.lobby(); $('#arcade-heading').focus(); }
    else leaveArcade();
    return;
  }
  if (arcade.active) {
    if (e.code === 'KeyX' && !e.repeat) arcade.pulse();
    else if (e.code === 'Space' && !e.target.closest('button')) { e.preventDefault(); arcade.togglePause(); }
    return;
  }
  if (e.target.closest('button')) return;
  if (e.code === 'Space') { e.preventDefault(); paused = !paused; updatePause(); }
  else if (e.key.toLowerCase() === 'r') { resetScene(); revealScene(); }
  else if (e.key.toLowerCase() === 'f') setFocusMode(!document.body.classList.contains('focus-mode'));
});
document.body.dataset.quality = quality;
resize();
resetScene('playground');
revealScene();
syncArcadePage();
requestAnimationFrame(frame);
