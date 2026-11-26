const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const alpha=(dt,cutoff)=>1-Math.exp(-2*Math.PI*cutoff*dt);

// No interpolation buffer: filter noise adaptively, then make a bounded estimate
// from the latest sample. Pinch state is always decided from real detections.
export function createHandMotion(){
  const filtered=new Float32Array(42),raw=new Float32Array(42),velocity=new Float32Array(42),out=new Float32Array(42);
  let time=null;
  return {
    update(landmarks,timestamp,responsiveness=.7){
      if(time!==null&&timestamp<=time)return false;
      const dt=time===null?0:Math.min(.1,(timestamp-time)/1000);
      const jump=time===null||timestamp-time>180||Math.hypot(landmarks[9].x-raw[18],landmarks[9].y-raw[19])>.3;
      for(let i=0;i<21;i++)for(let axis=0;axis<2;axis++){
        const j=i*2+axis,value=axis?landmarks[i].y:landmarks[i].x;
        if(jump){filtered[j]=value;velocity[j]=0;}
        else{
          const derivative=clamp((value-raw[j])/dt,-5,5);
          velocity[j]+=alpha(dt,9)*(derivative-velocity[j]);
          const cutoff=3+responsiveness*14+Math.abs(velocity[j])*16;
          filtered[j]+=alpha(dt,cutoff)*(value-filtered[j]);
        }
        raw[j]=value;
      }
      time=timestamp;return true;
    },
    sample(now,predict=true){
      if(time===null)return null;
      const age=Math.max(0,now-time);
      // Stop extrapolating after a stall; never invent an endlessly moving hand.
      const horizon=predict?Math.min(age,40)/1000*Math.max(0,1-Math.max(0,age-65)/55):0;
      for(let j=0;j<42;j++)out[j]=clamp(filtered[j]+clamp(velocity[j]*horizon,-.035,.035),0,1);
      return out;
    }
  };
}

export function createRateMeter(){
  const samples=[];
  return {
    reset(){samples.length=0;},
    mark(now,count=1){samples.push({now,count});while(samples.length>300||samples.length>1&&samples[0].now<now-1000)samples.shift();},
    rate(now){while(samples.length&&samples[0].now<now-1000)samples.shift();if(samples.length<2)return 0;const elapsed=samples.at(-1).now-samples[0].now;return elapsed>0?samples.slice(1).reduce((n,s)=>n+s.count,0)*1000/elapsed:0;}
  };
}
