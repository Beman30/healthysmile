import test from 'node:test';
import assert from 'node:assert/strict';
import {photoEdges} from '../public/reference-contour-core.mjs';
function rectangle(offset=0){
 const width=120,height=160,data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*4,value=(x>=30&&x<90&&y>=40&&y<120?180:30)+offset;data.set([value,value,value,255],i);
 }
 return data;
}
test('contours retain image coordinates and do not fill or deform the face',()=>{
 const edges=photoEdges(rectangle(),120,160),points=[];
 for(let y=0;y<160;y++)for(let x=0;x<120;x++)if(edges[y*120+x])points.push([x,y]);
 assert(points.length>200&&points.length<400);
 assert(points.every(([x,y])=>Math.min(Math.abs(x-30),Math.abs(x-90),Math.abs(y-40),Math.abs(y-120))<=2));
 assert.equal(edges[80*120+60],0,'interior stays transparent');
 assert.deepEqual(edges,photoEdges(rectangle(20),120,160),'uniform brightness offset does not shift contours');
});
test('flat images create no invented face contour',()=>{
 assert.equal(photoEdges(new Uint8ClampedArray(80*100*4).fill(100),80,100).reduce((n,v)=>n+!!v,0),0);
 assert.throws(()=>photoEdges(new Uint8ClampedArray(10),80,100));
});
