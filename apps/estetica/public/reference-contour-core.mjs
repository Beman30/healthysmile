// Thin image edges in the source crop's coordinate system. No face template,
// inferred landmarks, registration, scaling or deformation of a patient photo.
export function photoEdges(rgba,width,height,detail=55){
 const n=width*height;
 if(rgba.length!==n*4||width<5||height<5)throw Error('Invalid contour image');
 const grey=new Float32Array(n),temp=new Float32Array(n),smooth=new Float32Array(n);
 for(let i=0;i<n;i++)grey[i]=.2126*rgba[i*4]+.7152*rgba[i*4+1]+.0722*rgba[i*4+2];
 const kernel=[1,4,6,4,1];
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  let v=0;for(let k=-2;k<=2;k++)v+=grey[y*width+Math.max(0,Math.min(width-1,x+k))]*kernel[k+2];temp[y*width+x]=v/16;
 }
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  let v=0;for(let k=-2;k<=2;k++)v+=temp[Math.max(0,Math.min(height-1,y+k))*width+x]*kernel[k+2];smooth[y*width+x]=v/16;
 }
 const magnitude=new Float32Array(n),direction=new Uint8Array(n),thin=new Float32Array(n),histogram=new Uint32Array(256);
 for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
  const i=y*width+x,gx=-smooth[i-width-1]+smooth[i-width+1]-2*smooth[i-1]+2*smooth[i+1]-smooth[i+width-1]+smooth[i+width+1];
  const gy=-smooth[i-width-1]-2*smooth[i-width]-smooth[i-width+1]+smooth[i+width-1]+2*smooth[i+width]+smooth[i+width+1];
  magnitude[i]=Math.hypot(gx,gy)/4;
  const angle=(Math.atan2(gy,gx)*180/Math.PI+180)%180;
  direction[i]=angle<22.5||angle>=157.5?0:angle<67.5?1:angle<112.5?2:3;
 }
 const offsets=[1,width+1,width,width-1];let count=0;
 for(let y=2;y<height-2;y++)for(let x=2;x<width-2;x++){
  const i=y*width+x,v=magnitude[i],d=offsets[direction[i]];
  if(v>=2&&v>=magnitude[i-d]&&v>magnitude[i+d]){thin[i]=v;histogram[Math.min(255,Math.floor(v))]++;count++;}
 }
 const quantile=.92-Math.max(0,Math.min(100,detail))*.0052;
 let sum=0,high=255;for(let i=2;i<256;i++){sum+=histogram[i];if(sum>=count*quantile){high=i;break;}}
 high=Math.max(4,high);const low=Math.max(2,high*.4),edges=new Uint8Array(n),queue=new Uint32Array(n);let end=0;
 for(let i=0;i<n;i++)if(thin[i]>=high){edges[i]=255;queue[end++]=i;}
 for(let q=0;q<end;q++){
  const i=queue[q];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
   const j=i+dy*width+dx;if(!edges[j]&&thin[j]>=low){edges[j]=255;queue[end++]=j;}
  }
 }
 // Remove isolated speckles without moving the retained contours.
 const seen=new Uint8Array(n);
 for(let i=0;i<n;i++)if(edges[i]&&!seen[i]){
  let size=1;queue[0]=i;seen[i]=1;
  for(let q=0;q<size;q++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
   const j=queue[q]+dy*width+dx;if(edges[j]&&!seen[j]){seen[j]=1;queue[size++]=j;}
  }
  if(size<8)for(let j=0;j<size;j++)edges[queue[j]]=0;
 }
 return edges;
}
