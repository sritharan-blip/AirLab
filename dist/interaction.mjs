export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export function pinchState(landmarks, previous = false) {
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const scale = Math.max(distance(landmarks[0], landmarks[9]), .015);
  const ratio = distance(landmarks[4], landmarks[8]) / scale;
  return ratio < (previous ? .48 : .30);
}
export function throwVelocity(history) {
  if (history.length < 2) return {x: 0, y: 0};
  const last = history.at(-1);
  const recent = history.find(p => p.t >= last.t - 100) || history[0];
  const dt = Math.max(last.t - recent.t, 16);
  return {x: clamp((last.x - recent.x) / dt * 16.667, -22, 22), y: clamp((last.y - recent.y) / dt * 16.667, -22, 22)};
}
export function entersBasket(previous, current, basket, radius) {
  return previous.y < basket.rim && current.y >= basket.rim && current.y > previous.y && current.x > basket.x - basket.half + radius && current.x < basket.x + basket.half - radius;
}

export function cameraScore(label = '') {
  if (/phone|droid|iriun|epoc|camo|continuity|android|iphone|mobile|link to windows/i.test(label)) return -100;
  if (/virtual|obs|manycam|snap camera|ndi|broadcast|capture card/i.test(label)) return -200;
  if (/integrated|built.?in|internal|facetime|truevision|easycamera|hd user facing|hp wide vision/i.test(label)) return 100;
  if (/usb|webcam|logitech|brio|lifecam/i.test(label)) return 60;
  return 10;
}
export function chooseCamera(devices, preferred = '') {
  const cameras = devices.filter(d => d.kind === 'videoinput');
  if (preferred) return cameras.find(d => d.deviceId === preferred) || null;
  return cameras.filter(d => cameraScore(d.label) >= 0).sort((a,b) => cameraScore(b.label)-cameraScore(a.label))[0] || null;
}

// Solve the small (at most four hands) assignment globally. Detector output
// ordering is not a stable hand identity, especially when two hands cross.
export function associateHands(tracks, detections, now) {
  const eligible = tracks.filter(t => now-t.lastSeen < 180);
  let best = {cost: Infinity, ids: []};
  function visit(index, used, ids, cost) {
    if (cost >= best.cost) return;
    if (index === detections.length) {best = {cost, ids: [...ids]}; return;}
    const d = detections[index];
    for (const t of eligible) {
      if (used.has(t.id)) continue;
      const distance = Math.hypot(d.center.x-t.center.x,d.center.y-t.center.y);
      if (distance > .30) continue;
      const penalty = d.label && t.label && d.label !== t.label ? .12 : 0;
      used.add(t.id); ids.push(t.id); visit(index+1,used,ids,cost+distance+penalty);ids.pop();used.delete(t.id);
    }
    ids.push(null);visit(index+1,used,ids,cost+.32);ids.pop();
  }
  visit(0,new Set(),[],0);
  return best.ids;
}

export function fieldForce(body, point, mode, radius = 210) {
  const dx=point.x-body.position.x,dy=point.y-body.position.y,distance=Math.hypot(dx,dy);
  if (distance<8 || distance>radius) return {x:0,y:0};
  const strength=(mode==='repel'?-1:1)*body.mass*.00065*(1-distance/radius);
  return {x:dx/distance*strength,y:dy/distance*strength};
}
