let core;
self.onmessage=async({data})=>{
 try{
  core ||=await import('./reference-contour-core.mjs?v=19');
  const edges=core.photoEdges(new Uint8ClampedArray(data.rgba),data.width,data.height,data.detail);
  self.postMessage({id:data.id,edges:edges.buffer},[edges.buffer]);
 }catch{self.postMessage({id:data.id,error:true});}
};
