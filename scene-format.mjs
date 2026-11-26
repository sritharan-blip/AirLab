const finite=(n,min,max)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
const point=p=>p&&finite(p.x,-5000,5000)&&finite(p.y,-5000,5000);
export function validateScene(s){
  const fail=()=>{throw new Error('Invalid AirLab scene. Use a scene exported by this version.');};
  if(!s||s.format!=='airlab-4'||!finite(s.width,200,5000)||!finite(s.height,200,5000)||!['earth','moon','space','reverse'].includes(s.gravity)||!['playground','tower','target','shower','empty','pendulum','chain','orbit','bridge'].includes(s.scene))fail();
  if(!Array.isArray(s.objects)||s.objects.length>35)fail();
  for(const b of s.objects)if(!b||!['ball','box','triangle'].includes(b.kind)||!point(b.position)||!point(b.velocity)||!finite(b.size,8,180)||!finite(b.angle,-1e6,1e6)||!finite(b.spin,-2,2)||!/^#[0-9a-f]{6}$/i.test(b.color)||!['rubber','ice','steel','cork'].includes(b.material)||typeof b.frozen!=='boolean'||!finite(b.bounce,0,1))fail();
  const a=s.construction;if(!a||!Array.isArray(a.platforms)||!Array.isArray(a.portals)||!Array.isArray(a.links)||a.platforms.length>60||a.portals.length>2||a.links.length>24)fail();
  let segments=0;for(const p of a.platforms){if(!Array.isArray(p)||p.length<2||p.length>35||!p.every(point))fail();segments+=p.length-1;}if(segments>120)fail();
  for(const p of a.portals)if(!point(p)||!finite(p.radius,8,100))fail();
  const endpoint=e=>e&&Number.isInteger(e.body)&&e.body>=-1&&e.body<s.objects.length&&point(e.point);
  for(const l of a.links)if(!l||!['rope','spring'].includes(l.mode)||!endpoint(l.a)||!endpoint(l.b)||l.a.body===l.b.body||!finite(l.length,1,10000))fail();
  return s;
}
