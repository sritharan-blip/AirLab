// Classic worker: MediaPipe's vendored WASM loader needs importScripts.
let detector=null;
self.onmessage=async ({data})=>{
  const {type,bitmap,timestamp}=data;
  try {
    if(type==='init'){
      const {HandLandmarker,FilesetResolver}=await import('./vendor/vision_bundle.mjs');
      const files=await FilesetResolver.forVisionTasks(new URL('./vendor/wasm',self.location.href).href);
      const make=delegate=>HandLandmarker.createFromOptions(files,{
        canvas:new OffscreenCanvas(1,1),
        baseOptions:{modelAssetPath:new URL('./vendor/hand_landmarker.task',self.location.href).href,delegate},
        runningMode:'VIDEO',numHands:data.maxHands,minHandDetectionConfidence:.55,minTrackingConfidence:.55
      });
      let delegate='GPU';try{detector=await make(delegate);}catch{delegate='CPU';detector=await make(delegate);}
      self.postMessage({type:'ready',delegate});
    }else if(type==='frame'&&detector){
      const start=performance.now(),result=detector.detectForVideo(bitmap,timestamp);
      self.postMessage({type:'result',landmarks:result.landmarks,handedness:result.handedness,ms:performance.now()-start,timestamp});
    }
  }catch(error){self.postMessage({type:'error',message:error.message||String(error)});}
  finally{bitmap?.close();}
};
