// Exactly one transferred frame in flight; stale sessions cannot revive a camera.
export function createFrameGate() {
  let epoch=0, busy=false, last=-Infinity;
  return {
    reset(){epoch++;busy=false;last=-Infinity;},
    acquire(now,interval){if(busy||now-last<interval)return null;busy=true;last=now;return epoch;},
    valid(ticket){return ticket===epoch;},
    finish(ticket){if(ticket===epoch)busy=false;},
    get busy(){return busy;}
  };
}
// Quality controls input resolution, never imposes a low detection frame cap.
export const TRACKING_PROFILES={fast:{width:256,dpr:1},balanced:{width:320,dpr:1.25},quality:{width:384,dpr:1.6}};
