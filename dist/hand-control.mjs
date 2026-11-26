import {createHandMotion,createRateMeter} from './hand-motion.mjs';
import {createFrameGate,TRACKING_PROFILES} from './tracking-pipeline.mjs';
import {clamp, pinchState, chooseCamera, associateHands} from './interaction.mjs';

export function createHandControl({stagePoint, begin, move, release, isGrabbing, toast, getMode, tracksFinger = () => false, trackFinger}) {
  const $=s=>document.querySelector(s), video=$('#camera'), overlay=$('#hand-overlay'), ctx=overlay.getContext('2d');
  const states=new Map(), colors=['#d4f887','#c6a5ff','#7de7ec','#ffbc89'];
  const gate=createFrameGate();
  let worker=null,workerReject=null,workerTimeout=null,delegate='',lastResult=0;
  let stream=null, active=false, loading=false, generation=0, nextId=0, lastFrame=-1, lastDetect=0, count=0;
  let overlayDirty=false;
  let gateTicket=null,videoCallback=null,latestMediaTime=-1,lastPresented=null,lastMetrics=0,inferenceMs=0,pipelineMs=0,lastRender=0;
  const cameraRate=createRateMeter(),detectionRate=createRateMeter(),overlayRate=createRateMeter();
  const smoothingInput=$('#hand-smoothing'),skeletonInput=$('#skeleton'),predictionInput=$('#motion-prediction');
  const metricElements={camera:$('#camera-fps'),detections:$('#detection-fps'),overlay:$('#overlay-fps'),latency:$('#pipeline-latency'),footer:$('#tracking-fps'),speed:$('#tracking-speed')};
  function resetMetrics(){cameraRate.reset();detectionRate.reset();overlayRate.reset();lastMetrics=0;inferenceMs=0;pipelineMs=0;for(const el of Object.values(metricElements))if(el)el.textContent='—';}
  function showMetrics(now){if(now-lastMetrics<250)return;lastMetrics=now;
    if(metricElements.camera)metricElements.camera.textContent=video.requestVideoFrameCallback||video.getVideoPlaybackQuality?`${Math.round(cameraRate.rate(now))} fps`:'Unavailable';
    if(metricElements.detections)metricElements.detections.textContent=`${Math.round(detectionRate.rate(now))} fps`;
    if(metricElements.overlay)metricElements.overlay.textContent=`${Math.round(overlayRate.rate(now))} fps`;
    if(metricElements.latency)metricElements.latency.textContent=`${Math.round(pipelineMs)} ms`;
    if(metricElements.footer)metricElements.footer.textContent=Math.round(detectionRate.rate(now));
    if(metricElements.speed)metricElements.speed.textContent=`${Math.round(inferenceMs)} ms · ${delegate}`;
  }
  let selected=''; try{selected=localStorage.getItem('airlab.camera.v2')||'';}catch{}
  const connections=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
  const labels=text=>{document.querySelectorAll('.camera-label').forEach(el=>el.textContent=text);};
  function reportCameraError(summary, detail) {
    $('#tracking-status').textContent = summary;
    $('#camera-active').textContent = detail;
    toast(detail);
  }
  function dropState(state){release(false,state.id);state.cursor.remove();states.delete(state.id);}
  function releaseAll(){for(const s of states.values()){release(false,s.id);s.armed=false;s.pinched=false;s.range=null;s.field=false;}}
  function stop(){
    generation++;active=false;loading=false;if(videoCallback!==null)video.cancelVideoFrameCallback?.(videoCallback);videoCallback=null;latestMediaTime=-1;lastPresented=null;lastRender=0;resetMetrics();gate.reset();workerReject?.(new Error('Camera stopped'));workerReject=null;clearTimeout(workerTimeout);worker?.terminate();worker=null;lastResult=0;
    stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;
    for(const s of [...states.values()])dropState(s);
    ctx.clearRect(0,0,innerWidth,innerHeight);overlayDirty=false;$('#camera-preview').hidden=true;$('#hand-count').textContent='0';
    labels('Enable hand tracking');if($('#tracking-speed'))$('#tracking-speed').textContent='OFF';$('#tracking-status').textContent='Mouse control ready';$('#camera-active').textContent='Camera off · choose your computer webcam below';lastFrame=-1;count=0;
    $('#camera-source').disabled=false;$('#hand-limit').disabled=false;
  }
  async function refresh(){
    if(!navigator.mediaDevices?.enumerateDevices)return [];
    const devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');
    const select=$('#camera-source');select.replaceChildren(new Option('Auto · prefer computer webcam',''));
    devices.forEach((d,i)=>select.add(new Option(d.label||`Camera ${i+1} · enable camera to see name`,d.deviceId)));
    if(selected&&!devices.some(d=>d.deviceId===selected)){selected='';try{localStorage.removeItem('airlab.camera.v2');}catch{}}
    select.value=selected;
    return devices;
  }
  const constraints=id=>({audio:false,video:{...(id?{deviceId:{exact:id}}:{}),width:{ideal:640},height:{ideal:480},frameRate:{ideal:144}}});
  async function start(){
    if(loading)return;
    const cameraPolicy = document.permissionsPolicy ?? document.featurePolicy;
    if (cameraPolicy?.allowsFeature?.('camera') === false) {
      reportCameraError('Camera blocked in this view', 'Open AirLab directly in Chrome or Edge to allow this site to use your webcam.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      const detail = window.isSecureContext === false ? 'Open AirLab at its HTTPS address to use the webcam.' :
        'Camera access is unavailable in this browser view. Open AirLab directly in Chrome or Edge.';
      reportCameraError('Camera unavailable', detail);
      return;
    }
    loading=true;const ticket=++generation;
    $('#camera-source').disabled=true;$('#hand-limit').disabled=true;
    labels('Starting camera…');$('#tracking-status').textContent='Waiting for camera…';
    $('#camera-active').textContent='Allow camera access if your browser asks.';
    let candidate=null;
    let trackerStarting=false;
    const valid=()=>ticket===generation;
    try{
      let devices=await refresh();
      if(!valid())return;
      let choice=chooseCamera(devices,selected);
      // Some browsers conceal camera names and IDs until a stream is open.
      if(!devices.some(d=>d.label)){
        candidate=await navigator.mediaDevices.getUserMedia(constraints());
        if(!valid()){candidate.getTracks().forEach(t=>t.stop());return;}
        devices=await refresh();choice=chooseCamera(devices,selected);
      }
      const probedTrack = candidate?.getVideoTracks()[0];
      const probedId = probedTrack?.getSettings().deviceId;
      if (!devices.some(device => device.label) && probedTrack) {
        choice = chooseCamera([{kind:'videoinput', deviceId:probedId || '', label:probedTrack.label}], selected);
      }
      if(selected&&!choice){const e=new Error('The selected camera is unavailable.');e.name='OverconstrainedError';throw e;}
      if(!choice){const e=new Error('No computer webcam was found. Choose a camera from the list.');e.name='NoLocalCameraError';throw e;}
      const differentCamera = choice.deviceId && probedId ? choice.deviceId !== probedId :
        Boolean(choice.label && probedTrack?.label && choice.label !== probedTrack.label);
      if(candidate&&differentCamera){candidate.getTracks().forEach(t=>t.stop());candidate=null;}
      if(!candidate)candidate=await navigator.mediaDevices.getUserMedia(constraints(choice.deviceId));
      if(!valid()){candidate.getTracks().forEach(t=>t.stop());return;}
      stream=candidate;candidate=null;video.srcObject=stream;
      $('#camera-preview').hidden=$('#preview-toggle')?.checked===false;
      const actual=stream.getVideoTracks()[0];
      actual.addEventListener('ended', () => {
        if (!valid()) return;
        stop();
        reportCameraError('Camera disconnected', 'The webcam disconnected. Select an available camera and try again.');
      }, {once:true});
      await video.play();
      if(!valid())return;
      trackerStarting=true;
      labels('Loading hand tracking…');
      $('#tracking-status').textContent='Camera on · loading hand tracking';
      $('#camera-active').textContent=`Using: ${actual.label || choice.label || 'Selected webcam'} · loading hand tracking`;
      const maxHands=Number($('#hand-limit').value);
      await new Promise((resolve,reject)=>{
        if(typeof Worker==='undefined'||typeof createImageBitmap==='undefined'){
          const error=new Error('This browser does not support background camera tracking.');
          error.name='TrackingUnsupportedError';
          throw error;
        }
        worker=new Worker(new URL('./hand-worker.js',import.meta.url));workerReject=reject;
        workerTimeout=setTimeout(()=>reject(new Error('Hand tracking took too long to load. Restart the camera.')),45000);
        worker.onerror=event=>{if(!valid())return;reject(new Error(event.message||'Tracking worker failed'));if(active){stop();reportCameraError('Hand tracking stopped', 'The hand tracker stopped unexpectedly. Enable hand tracking to retry.');}};
        worker.onmessage=({data})=>{
          if(!valid())return;
          if(data.type==='ready'){delegate=data.delegate;clearTimeout(workerTimeout);workerReject=null;resolve();}
          else if(data.type==='result'){
            gate.finish(gateTicket);
            if(active&&!document.hidden){const now=performance.now();lastResult=now;detectionRate.mark(now);inferenceMs=inferenceMs?inferenceMs*.7+data.ms*.3:data.ms;const latency=Math.max(0,now-(data.timestamp??now));pipelineMs=pipelineMs?pipelineMs*.7+latency*.3:latency;processResult(data,now);captureLatest(now);}
          }
          else if(data.type==='error'){reject(new Error(data.message));if(active){stop();reportCameraError('Hand tracking stopped', 'Try a lower hand limit or restart the camera.');}}
        };
        worker.postMessage({type:'init',maxHands});
      });
      if(!valid())return;
      active=true;loading=false;resetMetrics();scheduleVideoFrame(ticket);$('#camera-source').disabled=false;$('#hand-limit').disabled=false;
      $('#camera-preview').hidden=$('#preview-toggle')?.checked===false;$('#onboarding').hidden=true;labels('Turn camera off');
      const settings=actual.getSettings();$('#camera-active').textContent=`Using: ${actual.label||choice.label||'Selected webcam'} · ${settings.width||'?'}×${settings.height||'?'} · ${Math.round(settings.frameRate||0)||'?'} fps reported · ${maxHands} hand${maxHands===1?'':'s'}`;
      $('#tracking-status').textContent='Show your open hands';toast('Each hand can grab a different object. Open fingers first, then pinch.');
    }catch(error){
      candidate?.getTracks().forEach(t=>t.stop());
      if(!valid())return;
      stop();
      const messages = {
        NotAllowedError: ['Camera permission needed', 'Allow Camera for this site in your browser settings. In an embedded view, try opening AirLab directly in Chrome or Edge.'],
        NotFoundError: ['No webcam found', 'Connect your webcam and refresh the camera list.'],
        NotReadableError: ['Camera is busy', 'Close other apps or tabs using the camera, or select a different webcam.'],
        OverconstrainedError: ['Camera unavailable', 'Refresh the camera list and choose an available webcam.'],
        NoLocalCameraError: ['Choose a computer webcam', 'Auto skipped phone or virtual feeds. Select a camera explicitly or connect a built-in or USB webcam.'],
        TrackingUnsupportedError: ['Tracking unsupported', 'Open AirLab directly in a recent Chrome or Edge browser to use hand tracking.'],
      };
      const fallback = trackerStarting ? ['Hand tracker failed to load', 'The camera opened, but hand tracking could not start. Reload AirLab and try again.'] :
        ['Could not start the camera', 'Choose a webcam in Camera settings and try again.'];
      reportCameraError(...(messages[error.name] || fallback));
      console.warn('Camera:',error.name,error.message);
    }
  }
  async function toggle(){if(loading){stop();return;}if(active)stop();else await start();}
  async function restart(){const running=active||loading;stop();if(running)await start();}
  $('#camera-source').addEventListener('change',async e=>{selected=e.target.value;try{localStorage.setItem('airlab.camera.v2',selected);}catch{}await restart();});
  $('#hand-limit').addEventListener('change',restart);
  $('#refresh-cameras').addEventListener('click',()=>refresh().then(()=>toast('Camera list refreshed. Select your built-in or USB webcam.')).catch(()=>toast('Could not read the camera list.')));
  navigator.mediaDevices?.addEventListener('devicechange',()=>refresh().catch(()=>{}));
  refresh().catch(()=>{});

  function setRange(input,x){const r=input.getBoundingClientRect(),step=Number(input.step)||1,raw=Number(input.min)+clamp((x-r.left)/r.width,0,1)*(Number(input.max)-Number(input.min));const next=(Math.round(raw/step)*step).toFixed(3);if(Number(input.value)===Number(next))return;input.value=next;input.dispatchEvent(new Event('input',{bubbles:true}));}
  function ui(s,x,y){
    const el=document.elementFromPoint(x,y);
    if($('#guide').open&&!$('#guide').contains(el))return true;
    const range=el?.closest('input[type=range]');
    if(range){s.range=range;setRange(range,x);return true;}
    const button=el?.closest('button,label.toggle-row');
    if(button&&!button.disabled){button.click();return true;}
    return Boolean(el?.closest('select,a'));
  }
  function cursorFor(s){
    const el=document.createElement('div');el.className='hand-pointer';el.style.setProperty('--hand-color',s.color);el.innerHTML=`<span></span><small>H${s.number}</small>`;
    (document.fullscreenElement||document.body).append(el);return el;
  }
  const mapX=x=>clamp(((1-x)-.12)/.76,0,1)*innerWidth;
  const mapY=y=>clamp((y-.08)/.82,0,1)*innerHeight;
  function processHand(s,landmarks,now){
    s.motion.update(landmarks,s.sampleTime,Number(smoothingInput?.value||70)/100);
    const points=s.motion.sample(now,predictionInput?.checked!==false);
    const x=mapX(points[16]),y=mapY(points[17]);
    s.point={x,y};
    const wasPinched=s.pinched,next=pinchState(landmarks,wasPinched);if(!next)s.armed=true;
    s.cursor.classList.toggle('pinched',next);
    const point=stagePoint(x,y);
    if(next&&!wasPinched&&s.armed){
      s.armed=false;
      if(!ui(s,x,y)&&!$('#guide').open&&point.inside)begin(point,s.id);
      if(!states.has(s.id))return; // A camera button may have stopped tracking.
    }
    if(next){if(!tracksFinger())move(point,s.id);if(s.range)setRange(s.range,x);}
    if(!next&&wasPinched){release(true,s.id);s.range=null;}
    s.pinched=next;

  }
  function processResult(result,now){
      const detections=result.landmarks.map((landmarks,i)=>({landmarks,center:{x:landmarks[9].x,y:landmarks[9].y},label:result.handedness?.[i]?.[0]?.categoryName||''}));
      const ids=associateHands([...states.values()],detections,now), seen=new Set();
      count=detections.length;$('#hand-count').textContent=count;
      detections.forEach((d,i)=>{
        if(!active)return;
        let s=states.get(ids[i]);
        if(!s){const number=nextId++;s={id:`hand-${number}`,number:number+1,color:colors[number%colors.length],point:null,pinched:false,armed:false,range:null,motion:createHandMotion(),visible:true};s.cursor=cursorFor(s);states.set(s.id,s);}
        s.center=d.center;s.label=d.label;s.lastSeen=now;s.sampleTime=result.timestamp??now;s.visible=true;seen.add(s.id);processHand(s,d.landmarks,now);
      });
      for(const s of [...states.values()])if(!seen.has(s.id)){
        if(s.visible&&tracksFinger()){release(false,s.id);s.range=null;}
        s.visible=false;s.cursor.hidden=true;if(now-s.lastSeen>160)dropState(s);
      }
      if(active)$('#tracking-status').textContent=count?`${count} hand${count===1?'':'s'} tracked · ${getMode()}`:'Hands lost · show open hands';
  }
  function scheduleVideoFrame(ticket){
    if(!video.requestVideoFrameCallback)return;
    videoCallback=video.requestVideoFrameCallback((now,metadata)=>{
      videoCallback=null;if(ticket!==generation||!active)return;
      // Register immediately: frames arriving during inference are dropped, not queued.
      scheduleVideoFrame(ticket);
      if(document.hidden)return;
      if(metadata.mediaTime!==latestMediaTime){latestMediaTime=metadata.mediaTime;const presented=metadata.presentedFrames;cameraRate.mark(now,Number.isFinite(presented)&&lastPresented!==null?Math.max(1,presented-lastPresented):1);lastPresented=Number.isFinite(presented)?presented:null;}
      captureLatest(now);
    });
  }
  function captureLatest(now){
    if(!active||!worker||video.readyState<2||document.hidden)return;
    const mediaTime=video.requestVideoFrameCallback?latestMediaTime:(video.getVideoPlaybackQuality?.().totalVideoFrames??video.currentTime);
    if(mediaTime<0||mediaTime===lastFrame)return;
    const ticket=gate.acquire(now,0);if(ticket===null)return;
    const profile=TRACKING_PROFILES[document.body.dataset.quality||'balanced']||TRACKING_PROFILES.balanced;

    gateTicket=ticket;lastDetect=now;lastFrame=mediaTime;
    const currentWorker=worker;
    createImageBitmap(video,{resizeWidth:profile.width,resizeHeight:Math.max(1,Math.round(profile.width*video.videoHeight/video.videoWidth)),resizeQuality:'low'})
      .then(bitmap=>{if(!gate.valid(ticket)||!active||document.hidden){bitmap.close();gate.finish(ticket);return;}try{currentWorker.postMessage({type:'frame',bitmap,timestamp:now},[bitmap]);}catch(error){bitmap.close();throw error;}})
      .catch(error=>{gate.finish(ticket);if(gate.valid(ticket)&&active){stop();toast('Camera frame capture failed. Try restarting the webcam.');console.warn(error);}});
  }
  function renderHands(now){
    const dt=lastRender?Math.min(50,now-lastRender):0;lastRender=now;
    if(overlayDirty){ctx.clearRect(0,0,innerWidth,innerHeight);overlayDirty=false;}
    const skeleton=skeletonInput?.checked!==false,predict=predictionInput?.checked!==false;
    const followFinger=tracksFinger();
    let first=true;
    for(const s of [...states.values()]){
      if(now-s.lastSeen>200){dropState(s);continue;}
      if(!s.visible||now-s.lastSeen>150){
        if(s.visible&&followFinger){release(false,s.id);s.range=null;s.visible=false;}
        s.cursor.hidden=true;continue;
      }
      const points=s.motion.sample(now,predict);if(!points)continue;
      const x=mapX(points[16]),y=mapY(points[17]);
      const bladeVisible=followFinger&&trackFinger(x,y,mapX(points[12]),mapY(points[13]),s.id);
      s.point={x,y};s.cursor.hidden=bladeVisible;
      if(!bladeVisible)s.cursor.style.transform=`translate3d(${x}px,${y}px,0)`;
      if(skeleton){
        overlayDirty=true;ctx.strokeStyle=s.color+'a0';ctx.lineWidth=1.5;ctx.beginPath();
        for(const [a,b]of connections){ctx.moveTo(mapX(points[a*2]),mapY(points[a*2+1]));ctx.lineTo(mapX(points[b*2]),mapY(points[b*2+1]));}ctx.stroke();
        ctx.fillStyle=s.color;ctx.beginPath();for(let i=0;i<21;i++){const px=mapX(points[i*2]),py=mapY(points[i*2+1]);ctx.moveTo(px+2,py);ctx.arc(px,py,2,0,Math.PI*2);}ctx.fill();
      }
      if(s.pinched){if(!followFinger)move(stagePoint(x,y),s.id);if(s.range)setRange(s.range,x);}
      if(first&&!bladeVisible&&!s.pinched&&!isGrabbing(s.id)&&!$('#guide').open&&!document.fullscreenElement){if(y>innerHeight-24)window.scrollBy(0,dt*.4);else if(y<18)window.scrollBy(0,-dt*.4);}first=false;
    }
  }
  function tick(now){
    if(!active||document.hidden)return;
    overlayRate.mark(now);renderHands(now);showMetrics(now);
    if(!video.requestVideoFrameCallback){const frames=video.getVideoPlaybackQuality?.().totalVideoFrames;if(Number.isFinite(frames)&&frames!==lastPresented){cameraRate.mark(now,lastPresented===null?1:Math.max(1,frames-lastPresented));lastPresented=frames;}captureLatest(now);}
  }
  document.addEventListener('visibilitychange',()=>{releaseAll();ctx.clearRect(0,0,innerWidth,innerHeight);overlayDirty=false;for(const s of states.values()){s.cursor.hidden=true;s.visible=false;}cameraRate.reset();detectionRate.reset();overlayRate.reset();lastPresented=null;lastRender=0;});
  document.addEventListener('fullscreenchange',()=>{const parent=document.fullscreenElement||document.body;parent.append(overlay);for(const s of states.values())parent.append(s.cursor);});
  window.addEventListener('pagehide',stop);
  return {toggle,stop,tick,releaseAll,get active(){return active;},get cameraOpen(){return Boolean(stream);},get count(){return count;}};
}
