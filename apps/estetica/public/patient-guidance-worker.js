// Classic worker: MediaPipe's WASM loader uses importScripts. No camera requests
// or network uploads here; only locally transferred, cropped ImageBitmaps.
let detector,measure,initializing;
async function initialize(){
 if(detector)return;
 if(!initializing)initializing=(async()=>{
  const [{FaceLandmarker,FilesetResolver},core]=await Promise.all([import('./pose-vendor/vision_bundle.mjs'),import('./patient-guidance-core.mjs?v=24')]);
  measure=core.measureFace;
  const files=await FilesetResolver.forVisionTasks(new URL('./pose-vendor/wasm',self.location).href);
  detector=await FaceLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:new URL('./pose-vendor/face_landmarker.task',self.location).href,delegate:'CPU'},runningMode:'IMAGE',numFaces:2,minFaceDetectionConfidence:.65,minFacePresenceConfidence:.65,minTrackingConfidence:.65,outputFacialTransformationMatrixes:true});
 })();
 await initializing;
}
self.onmessage=async({data})=>{
 const {id,bitmap}=data;
 try{
  await initialize();
  const face=bitmap?measure(detector.detect(bitmap),bitmap.width,bitmap.height):null;
  self.postMessage({id,face});
 }catch{self.postMessage({id,error:'Guida automatica non disponibile'});}
 finally{bitmap?.close();}
};
