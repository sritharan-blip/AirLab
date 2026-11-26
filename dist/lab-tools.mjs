const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const midpoint=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
const rotate=(p,a)=>({x:p.x*Math.cos(a)-p.y*Math.sin(a),y:p.x*Math.sin(a)+p.y*Math.cos(a)});

export function stretchPose(startA,startB,currentA,currentB,body,limits={min:12,max:160}) {
  const initialDistance=Math.max(distance(startA,startB),12);
  const initialMid=midpoint(startA,startB),currentMid=midpoint(currentA,currentB);
  const angle=Math.atan2(currentB.y-currentA.y,currentB.x-currentA.x)-Math.atan2(startB.y-startA.y,startB.x-startA.x);
  const size=clamp(body.size*distance(currentA,currentB)/initialDistance,limits.min,limits.max),ratio=size/body.size;
  const offset=rotate({x:(body.x-initialMid.x)*ratio,y:(body.y-initialMid.y)*ratio},angle);
  return {x:currentMid.x+offset.x,y:currentMid.y+offset.y,angle:body.angle+angle,size};
}

function segmentDistance(p,a,b) {
  const dx=b.x-a.x,dy=b.y-a.y,t=clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1),0,1);
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}
export function simplifyStroke(points,tolerance=5) {
  if(points.length<=2)return points.map(p=>({x:p.x,y:p.y}));
  let furthest=0,index=0;
  for(let i=1;i<points.length-1;i++){const d=segmentDistance(points[i],points[0],points.at(-1));if(d>furthest){furthest=d;index=i;}}
  if(furthest<=tolerance)return [{...points[0]},{...points.at(-1)}];
  return [...simplifyStroke(points.slice(0,index+1),tolerance).slice(0,-1),...simplifyStroke(points.slice(index),tolerance)];
}
export function portalCrossed(previous,current,portal,bodyRadius=20) {
  const trigger=Math.max(10,portal.radius-Math.min(bodyRadius,portal.radius*.7));
  return distance(previous,portal)>trigger&&segmentDistance(portal,previous,current)<=trigger&&distance(previous,current)>.1;
}
export function portalExit(body,exit,bounds) {
  const speed=Math.hypot(body.velocity.x,body.velocity.y);
  const direction=speed>.1?{x:body.velocity.x/speed,y:body.velocity.y/speed}:{x:0,y:-1};
  const radius=body.circleRadius||Math.max(body.bounds.max.x-body.bounds.min.x,body.bounds.max.y-body.bounds.min.y)/2;
  const clearance=exit.radius+radius+12;
  return {position:{x:clamp(exit.x+direction.x*clearance,radius+4,bounds.width-radius-4),y:clamp(exit.y+direction.y*clearance,radius+4,bounds.height-radius-44)},velocity:{...body.velocity}};
}

export const TOOL_HELP={
  ramp:'Click or pinch in the playground to place the configured ramp or slide.',
  measure:'Click or pinch an object to select it for measurement.',
  grab:'Pinch an object to grab it. Move and release to throw.',
  magnet:'Pinch and hold in the scene to attract nearby objects.',
  repel:'Pinch and hold in the scene to push nearby objects away.',
  stretch:'Pinch the same object with two hands. Spread to resize; twist to rotate. Mouse: Shift + drag.',
  draw:'Pinch, draw a line, then release to build a solid platform. Mouse: click and drag.',
  portal:'Pinch or click two empty spots to place a portal pair. Released, unlinked objects keep their velocity through portals.',
  rope:'Select an object, then another object or an empty anchor point. Rope goes slack when its ends move closer.',
  freeze:'Click or pinch an object to freeze it in place. Repeat to unfreeze.',
  clone:'Click or pinch an object to make a copy.',
  erase:'Click or pinch an object to remove it and its connections.',
  spring:'Select an object, then another object or an empty anchor point to connect an elastic spring.'
};

export function createLabTools({Matter,engine,getObjects,getBounds,externallyHeld=()=>false,toast=()=>{},changed=()=>{}}) {
  const {Bodies,Body,Composite,Constraint,Query}=Matter;
  const stretches=new Map(),owners=new Map(),strokes=new Map(),platforms=[],links=[],cooldowns=new Map();
  let portals=[],pendingLink=null,linkPreview=null;
  const bounds=()=>getBounds(),inside=p=>({x:clamp(p.x,8,bounds().width-8),y:clamp(p.y,8,bounds().height-48)});
  const stats=()=>({platforms:platforms.length,segments:platforms.reduce((n,p)=>n+p.parts.length,0),portals:portals.length,links:links.length,stretching:stretches.size});
  const hit=p=>Query.point(getObjects(),p).reverse().find(b=>!externallyHeld(b));
  function strokeParts(points) {
    const parts=[];
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],length=distance(a,b);if(length<3)continue;
      parts.push(Bodies.rectangle((a.x+b.x)/2,(a.y+b.y)/2,length+4,12,{isStatic:true,angle:Math.atan2(b.y-a.y,b.x-a.x),friction:.65,restitution:.15,chamfer:{radius:3}}));
    }
    return parts;
  }
  function addPlatform(points) {
    const parts = strokeParts(points);
    if (!parts.length || parts.length + stats().segments > 120 || platforms.length >= 60) return false;
    Composite.add(engine.world, parts);
    platforms.push({points, parts});
    changed(stats());
    return true;
  }
  function endStretch(group) {
    Body.setStatic(group.body,group.wasStatic);
    if(!group.wasStatic){Body.setDensity(group.body,group.density);Body.setInertia(group.body,group.inertia*Math.pow(group.body.plugin.size/group.originalSize,4));}
    Body.setVelocity(group.body,{x:0,y:0});Body.setAngularVelocity(group.body,0);stretches.delete(group.body.id);
  }
  function baseline(group) {
    const entries=[...group.members.values()];
    group.baseline=entries.length===2?{a:{...entries[0].point},b:{...entries[1].point},body:{x:group.body.position.x,y:group.body.position.y,angle:group.body.angle,size:group.body.plugin.size}}:null;
    if(entries.length===1)entries[0].offset={x:group.body.position.x-entries[0].point.x,y:group.body.position.y-entries[0].point.y};
  }
  function beginStretch(point,owner,options) {
    const body=hit(point);if(!body){toast('Pinch directly over an orb, block, or triangle.');return;}
    let group=stretches.get(body.id);
    if(group&&group.members.size>=2){toast('This object already has two stretch handles.');return;}
    if(!group){
      group={body,members:new Map(),density:body.density,inertia:body.inertia,originalSize:body.plugin.size,wasStatic:body.isStatic};
      Body.setVelocity(body,{x:0,y:0});Body.setAngularVelocity(body,0);Body.setStatic(body,true);body.plugin.trail=[];stretches.set(body.id,group);
    }
    group.members.set(owner,{point:{...point}});owners.set(owner,group);
    if(options.shift&&group.members.size===1){
      const dx=point.x-body.position.x,dy=point.y-body.position.y;
      const anchor=distance(point,body.position)<12?{x:body.position.x-30,y:body.position.y}:{x:body.position.x-dx,y:body.position.y-dy};
      group.virtualOwner=owner;group.members.set(owner+'-fixed',{point:anchor});
    }
    baseline(group);changed(stats());
  }
  function anchor(point) {
    const body=hit(point);
    return body?{body,local:rotate({x:point.x-body.position.x,y:point.y-body.position.y},-body.angle)}:{body:null,point:inside(point)};
  }
  function worldAnchor(a) {if(!a.body)return {...a.point};const p=rotate(a.local,a.body.angle);return {x:a.body.position.x+p.x,y:a.body.position.y+p.y};}
  function constraintPoint(a){return a.body?rotate(a.local,a.body.angle):{...a.point};}
  function link(mode,point) {
    if(links.length>=24){toast('Connection limit reached. Clear links to build a new setup.');return;}
    const next=anchor(point);
    if(!pendingLink){pendingLink=next;linkPreview=inside(point);toast(next.body?'Now select another object or an empty anchor point.':'Anchor placed. Now select an object.');return;}
    if((!pendingLink.body&&!next.body)||(pendingLink.body&&pendingLink.body===next.body)){toast('Choose a different object, or connect an object to empty space.');return;}
    const length=Math.max(20,distance(worldAnchor(pendingLink),worldAnchor(next)));
    const constraint=Constraint.create({bodyA:pendingLink.body,pointA:constraintPoint(pendingLink),bodyB:next.body,pointB:constraintPoint(next),length:mode==='spring'?Math.max(20,length*.7):length,stiffness:mode==='spring'?0.025:0,damping:mode==='spring'?0.035:0.08});
    Composite.add(engine.world,constraint);links.push({constraint,mode});pendingLink=null;linkPreview=null;changed(stats());
  }
  function begin(mode,point,owner,options={}) {
    if(owners.has(owner)||strokes.has(owner))return;
    point=inside(point);
    if(mode==='stretch')beginStretch(point,owner,options);
    else if(mode==='draw')strokes.set(owner,[point]);
    else if(mode==='portal'){
      const radius=Math.min(48,bounds().width*.12,bounds().height*.12);
      const p={x:clamp(point.x,radius+8,bounds().width-radius-8),y:clamp(point.y,radius+8,bounds().height-radius-48),radius};
      if(portals.length===2){portals=[];cooldowns.clear();}
      if(portals.length&&distance(portals[0],p)<radius*2+22){toast('Place the second portal farther from the first.');return;}
      portals.push(p);toast(portals.length===1?'Blue portal placed. Place the orange portal next.':'Portal pair active. Throw a released object into either ring.');changed(stats());
    } else if(mode==='rope'||mode==='spring')link(mode,point);
  }
  function move(point,owner) {
    point=inside(point);
    if(owners.has(owner)){owners.get(owner).members.get(owner).point=point;}
    const stroke=strokes.get(owner);
    if(stroke&&distance(stroke.at(-1),point)>=6&&stroke.length<240)stroke.push(point);
    if(pendingLink)linkPreview=point;
  }
  function release(commit,owner) {
    const group=owners.get(owner);
    if(group){group.members.delete(owner);owners.delete(owner);if(group.virtualOwner===owner){group.members.delete(owner+'-fixed');group.virtualOwner=null;}if(group.members.size)baseline(group);else endStretch(group);changed(stats());}
    const points=strokes.get(owner);if(!points)return;strokes.delete(owner);
    if(!commit)return;
    const length=points.slice(1).reduce((n,p,i)=>n+distance(points[i],p),0);
    if(length<22){toast('Draw a longer line to create a platform.');return;}
    let simplified=simplifyStroke(points,5);
    if(simplified.length>35)simplified=simplifyStroke(points,12);
    if(!addPlatform(simplified)){toast('Platform limit reached. Undo a platform or clear the scene.');return;}
    toast('Solid platform created. Drop an orb onto it.');
  }
  function cancelActive(){for(const owner of [...owners.keys(),...strokes.keys()])release(false,owner);pendingLink=null;linkPreview=null;}
  function clearLinks(){for(const l of links)Composite.remove(engine.world,l.constraint);links.length=0;pendingLink=null;linkPreview=null;changed(stats());}
  function clearPortals(){portals=[];cooldowns.clear();changed(stats());}
  function undoPlatform(){const p=platforms.pop();if(p)for(const b of p.parts)Composite.remove(engine.world,b);changed(stats());}
  function clearAll(){cancelActive();clearLinks();clearPortals();while(platforms.length)undoPlatform();}
  function resize(sx,sy){
    cancelActive();
    for(const p of platforms){for(const b of p.parts)Composite.remove(engine.world,b);p.points=p.points.map(a=>({x:a.x*sx,y:a.y*sy}));p.parts=strokeParts(p.points);Composite.add(engine.world,p.parts);}
    portals=portals.map(p=>({...p,x:p.x*sx,y:p.y*sy,radius:Math.min(48,bounds().width*.12,bounds().height*.12)}));
    for(const {constraint:c} of links){if(!c.bodyA){c.pointA.x*=sx;c.pointA.y*=sy;}if(!c.bodyB){c.pointB.x*=sx;c.pointB.y*=sy;}}
  }
  function beforeStep(){
    for(const g of stretches.values()){
      const entries=[...g.members.values()];let pose;
      if(entries.length===2&&g.baseline){const b=g.baseline;pose=stretchPose(b.a,b.b,entries[0].point,entries[1].point,b.body,{min:12,max:Math.max(28,Math.min(160,bounds().width*.22,bounds().height*.22))});}
      else{const m=entries[0];pose={x:m.point.x+m.offset.x,y:m.point.y+m.offset.y,angle:g.body.angle,size:g.body.plugin.size};}
      const ratio=pose.size/g.body.plugin.size;
      if(Math.abs(ratio-1)>.0001){Body.scale(g.body,ratio,ratio);g.body.plugin.size=pose.size;for(const {constraint:c}of links){if(c.bodyA===g.body){c.pointA.x*=ratio;c.pointA.y*=ratio;}if(c.bodyB===g.body){c.pointB.x*=ratio;c.pointB.y*=ratio;}}}
      const radius=g.body.circleRadius||pose.size*.72;
      const turn=pose.angle-g.body.angle;
      for(const {constraint:c}of links){if(c.bodyA===g.body){c.pointA=rotate(c.pointA,turn);c.angleA=pose.angle;}if(c.bodyB===g.body){c.pointB=rotate(c.pointB,turn);c.angleB=pose.angle;}}
      Body.setPosition(g.body,{x:clamp(pose.x,radius+2,bounds().width-radius-2),y:clamp(pose.y,radius+2,bounds().height-radius-42)});Body.setAngle(g.body,pose.angle);Body.setVelocity(g.body,{x:0,y:0});Body.setAngularVelocity(g.body,0);
    }
    for(const {constraint:c,mode}of links)if(mode==='rope'){
      const a={x:c.pointA.x+(c.bodyA?.position.x||0),y:c.pointA.y+(c.bodyA?.position.y||0)},b={x:c.pointB.x+(c.bodyB?.position.x||0),y:c.pointB.y+(c.bodyB?.position.y||0)};
      c.stiffness=distance(a,b)>c.length ? 0.92 : 0;
      c.damping=c.stiffness>0 ? 0.08 : 0;
    }
  }
  function afterStep(previous,now){
    const teleported=new Set();if(portals.length!==2)return teleported;
    for(const body of getObjects()){
      if(externallyHeld(body)||stretches.has(body.id)||links.some(l=>l.constraint.bodyA===body||l.constraint.bodyB===body)||(cooldowns.get(body.id)||0)>now)continue;
      const old=previous.get(body.id);if(!old)continue;
      const radius=body.circleRadius||body.plugin.size*.65;
      for(let i=0;i<2;i++)if(portalCrossed(old,body.position,portals[i],radius)){
        const exit=portalExit(body,portals[1-i],bounds());Body.setPosition(body,exit.position);Body.setVelocity(body,exit.velocity);body.plugin.trail=[];cooldowns.set(body.id,now+650);teleported.add(body.id);break;
      }
    }
    return teleported;
  }
  function draw(ctx, now, animated = true){
    ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
    for(const p of platforms){ctx.beginPath();p.points.forEach((v,i)=>i?ctx.lineTo(v.x,v.y):ctx.moveTo(v.x,v.y));ctx.strokeStyle='#89d7cd';ctx.lineWidth=12;ctx.stroke();ctx.strokeStyle='#d7fff088';ctx.lineWidth=2;ctx.stroke();}
    for(const points of strokes.values()){ctx.beginPath();points.forEach((v,i)=>i?ctx.lineTo(v.x,v.y):ctx.moveTo(v.x,v.y));ctx.strokeStyle='#aaf6d9';ctx.lineWidth=6;ctx.setLineDash([8,7]);ctx.stroke();ctx.setLineDash([]);}
    portals.forEach((p,i)=>{const color=i?'#ffae72':'#78b9ff';ctx.shadowColor=color;ctx.shadowBlur=animated?12:0;ctx.strokeStyle=color;ctx.lineWidth=5;ctx.beginPath();ctx.arc(p.x,p.y,p.radius,0,Math.PI*2);ctx.stroke();ctx.shadowBlur=0;ctx.strokeStyle=color+'60';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(p.x,p.y,p.radius+6+(animated?Math.sin(now*.004)*2:0),0,Math.PI*2);ctx.stroke();ctx.fillStyle=color+'0d';ctx.beginPath();ctx.arc(p.x,p.y,p.radius-3,0,Math.PI*2);ctx.fill();ctx.fillStyle=color;ctx.font='10px Arial';ctx.textAlign='center';ctx.fillText(i?'PORTAL B':'PORTAL A',p.x,p.y-p.radius-12);});
    ctx.textAlign='left';
    for(const {constraint:c,mode}of links){
      const a={x:c.pointA.x+(c.bodyA?.position.x||0),y:c.pointA.y+(c.bodyA?.position.y||0)},b={x:c.pointB.x+(c.bodyB?.position.x||0),y:c.pointB.y+(c.bodyB?.position.y||0)};
      ctx.strokeStyle=mode==='rope'?'#eacb96':'#cea7fa';ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(a.x,a.y);
      if(mode==='spring'){const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1;for(let j=1;j<18;j++){const t=j/18,offset=(j%2?1:-1)*7;ctx.lineTo(a.x+dx*t-dy/len*offset,a.y+dy*t+dx/len*offset);}}
      else if(distance(a,b)<c.length*.97){const slack=Math.min(55,Math.sqrt(Math.max(0,c.length*c.length-distance(a,b)**2))*.35);ctx.quadraticCurveTo((a.x+b.x)/2,(a.y+b.y)/2+slack,b.x,b.y);}
      ctx.lineTo(b.x,b.y);ctx.stroke();
      for(const p of [a,b]){ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fillStyle=ctx.strokeStyle;ctx.fill();}
    }
    if(pendingLink){const a=worldAnchor(pendingLink);ctx.strokeStyle='#e7c9ff';ctx.lineWidth=2;ctx.beginPath();ctx.arc(a.x,a.y,9,0,Math.PI*2);ctx.stroke();if(linkPreview){ctx.setLineDash([4,6]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(linkPreview.x,linkPreview.y);ctx.stroke();}}
    ctx.restore();
  }
  function removeBody(body){
    cancelActive();for(let i=links.length-1;i>=0;i--)if(links[i].constraint.bodyA===body||links[i].constraint.bodyB===body){Composite.remove(engine.world,links[i].constraint);links.splice(i,1);}cooldowns.delete(body.id);changed(stats());
  }
  function serialize(){
    const objects=getObjects();
    const endpoint=(body,point)=>({body:body?objects.indexOf(body):-1,point:{...point}});
    return {platforms:platforms.map(p=>p.points.map(v=>({...v}))),portals:portals.map(p=>({...p})),links:links.map(({mode,constraint:c})=>({mode,a:endpoint(c.bodyA,c.pointA),b:endpoint(c.bodyB,c.pointB),length:c.length}))};
  }
  function restore(data){
    clearAll();
    for(const points of data.platforms){const parts=strokeParts(points);platforms.push({points,parts});Composite.add(engine.world,parts);}
    portals=data.portals.map(p=>({...p}));const objects=getObjects();
    for(const l of data.links){const bodyA=objects[l.a.body]||null,bodyB=objects[l.b.body]||null;const constraint=Constraint.create({bodyA,bodyB,pointA:{...l.a.point},pointB:{...l.b.point},length:l.length,stiffness:l.mode==='rope'?.92:.025,damping:l.mode==='rope'?.08:.035});links.push({mode:l.mode,constraint});Composite.add(engine.world,constraint);}
    changed(stats());
  }
  return {addPlatform,serialize,restore,removeBody,begin,move,release,cancelActive,clearAll,clearLinks,clearPortals,undoPlatform,resize,beforeStep,afterStep,draw,stats,hasBody:b=>stretches.has(b.id),isActive:owner=>owners.has(owner)||strokes.has(owner)};
}
