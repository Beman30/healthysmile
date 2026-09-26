import test from 'node:test';
import assert from 'node:assert/strict';
import {beforePoseState,faceSharpness} from '../public/before-guidance-core.mjs';
const f={cx:.5,cy:.36,size:.35,yaw:0,pitch:0,roll:0,eyeOpen:.25};
const options={phoneConfirmed:true,level:{roll:0,pitch:0},kind:'front'};
test('first photo requires phone, distance, eyes, centering, rotation and chin together',()=>{
 assert.equal(beforePoseState(f,options).ready,true);
 for(const change of [{size:.20},{size:.5},{cx:.7},{cy:.5},{yaw:10},{pitch:10},{roll:8},{eyeOpen:.02},{clipped:true}])assert.equal(beforePoseState({...f,...change},options).ready,false,JSON.stringify(change));
 assert.equal(beforePoseState({...f,size:.2,yaw:20},options).checks.distance.text,'Prima orienta il viso');
 const pose=beforePoseState({...f,roll:9,pitch:10,size:.5},options);assert.equal(pose.checks.eyes.okay,false);assert.equal(pose.checks.chin.okay,false);assert.equal(pose.checks.distance.okay,false);
});
test('manual phone check is explicit, stale/missing sensor is not called measured, profiles are not frontal',()=>{
 assert.equal(beforePoseState(f).ready,false);
 const manual=beforePoseState(f,{phoneConfirmed:true});assert.equal(manual.ready,true);assert.equal(manual.checks.phone.text,'Verificato da te');
 assert.equal(beforePoseState(f,{...options,level:{roll:0,pitch:9}}).ready,false);
 assert.equal(beforePoseState(f,{...options,screenAngle:90}).ready,false);
 assert.equal(beforePoseState(f,{...options,kind:'profile'}).ready,false);
 assert.equal(beforePoseState({error:'no face'},options).ready,false);
});
test('sharpness is evaluated on face pixels rather than detailed background',()=>{
 const w=90,h=120,flat=new Uint8ClampedArray(w*h*4).fill(128),sharp=flat.slice(),background=flat.slice();
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const v=(x+y)%2?230:20,i=(y*w+x)*4;
  if(x>25&&x<65&&y>30&&y<70)for(let c=0;c<3;c++)sharp[i+c]=v;
  if(x<10||x>80)for(let c=0;c<3;c++)background[i+c]=v;
 }
 assert(faceSharpness(sharp,w,h,f)>faceSharpness(flat,w,h,f));
 assert.equal(faceSharpness(background,w,h,f),faceSharpness(flat,w,h,f));
});


test('small first-photo pose and phone deviations no longer block capture',()=>{
 const state=beforePoseState({...f,cx:.54,cy:.41,yaw:4.7,pitch:5.5,roll:3.5},
  {...options,level:{roll:3.5,pitch:-3.5}});
 assert.equal(state.ready,true);
 assert.equal(beforePoseState(f,{...options,level:{roll:4.5,pitch:0}}).ready,false);
});
