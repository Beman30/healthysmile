import test from 'node:test';
import assert from 'node:assert/strict';
import {patientInstruction,measureFace,geometryResidual,steadyFace,deltaAngle,eyeAlignmentStatus} from '../public/patient-guidance-core.mjs';
const target={cx:.5,cy:.4,size:.2,yaw:0,pitch:0,roll:0};
test('unmirrored patient directions and distance guidance',()=>{
 const cases=[
  [{cx:.6},'alla tua destra'],[{cx:.4},'alla tua sinistra'],
  [{size:.25},'Allontanati'],[{size:.15},'Avvicinati'],
  [{yaw:10},'verso la tua destra'],[{yaw:-10},'verso la tua sinistra'],
  [{pitch:10},'Solleva'],[{pitch:-10},'Abbassa'],
  [{roll:10},'verso la tua destra'],[{roll:-10},'verso la tua sinistra'],
  [{cy:.5},'più in alto'],[{cy:.3},'più in basso']
 ];
 for(const [change,text]of cases)assert.ok(patientInstruction({...target,...change},target).text.includes(text),JSON.stringify(change));
 assert.equal(patientInstruction(target,target).okay,true);
 const ref={...target,cx:.43,size:.26,yaw:12,pitch:7,roll:-9};
 assert.equal(patientInstruction(ref,ref).okay,true,'match reference, not absolute frontal pose');
 assert.equal(patientInstruction({...target,yaw:20,size:.12},target).key,'yaw1','orientation before size');
});
test('missing, multiple, clipped and excessive pose cannot report a match',()=>{
 for(const face of [measureFace({faceLandmarks:[]},360,480),measureFace({faceLandmarks:[[],[]]},360,480),{...target,clipped:true},{...target,yaw:65}])assert.notEqual(patientInstruction(face,target).okay,true);
 assert.equal(deltaAngle(-179,179),2);

});
test('eye roll measured in original image coordinates',()=>{
 const points=Array.from({length:478},()=>({x:.5,y:.5}));points[33]={x:.3,y:.35};points[263]={x:.7,y:.45};
 const face=measureFace({faceLandmarks:[points],facialTransformationMatrixes:[{data:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}]},360,480);
 assert.ok(face.roll>0);assert.equal(patientInstruction({...target,roll:face.roll},target).text,'Inclina la testa verso la tua destra');
});


test('local facial mismatch and unstable frames do not imply agreement',()=>{
 const anchors=[[.3,.35],[.4,.35],[.6,.35],[.7,.35],[.5,.43],[.5,.46],[.5,.49]];
 const moved=anchors.map(([x,y])=>[x*1.2+.05,y*1.2-.08]);
 assert(geometryResidual(moved,anchors)<1e-8);
 const changed=anchors.map(p=>[...p]);changed[5][0]+=.13;
 assert.equal(patientInstruction({...target,anchors:changed},{...target,anchors}).key,'shape');
 assert.equal(steadyFace(target,target),true);
 assert.equal(steadyFace({...target,cx:.54},target),false);
 assert.equal(steadyFace({...target,pitch:3},target),false);
 assert.equal(steadyFace({error:'missing'},target),false);
});


test('scale and translation remain independent when only one eye is aligned',()=>{
 const ref={...target,cy:.3,anchors:[[.4,.4],[.44,.4],[.56,.4],[.6,.4],[.5,.45],[.5,.48],[.5,.5]]};
 assert.equal(eyeAlignmentStatus(ref,ref).ready,true);
 // Scale about the left eye, preserving that corner exactly. The right eye moves.
 const oneEye={...ref,cx:.52,size:.24,anchors:ref.anchors.map(([x,y])=>[.4+(x-.4)*1.2,y])};
 assert.deepEqual(oneEye.anchors[0],ref.anchors[0]);
 const status=eyeAlignmentStatus(oneEye,ref);
 assert.equal(status.distance.key,'away');assert.equal(status.centering.key,'move');assert.equal(status.ready,false);
 const translated={...ref,cx:.55,anchors:ref.anchors.map(([x,y])=>[x+.05,y])};
 assert.equal(eyeAlignmentStatus(translated,ref).distance.key,'near');assert.equal(eyeAlignmentStatus(translated,ref).ready,false);
 const smaller={...ref,size:.16,anchors:ref.anchors.map(([x,y])=>[.5+(x-.5)*.8,y])};
 assert.equal(eyeAlignmentStatus(smaller,ref).distance.key,'closer');
 const unequal={...ref,anchors:ref.anchors.map(p=>[...p])};unequal.anchors[2][0]+=.05;
 assert.equal(eyeAlignmentStatus(unequal,ref).ready,false,'both inner and outer corners must agree');
});
test('distance is withheld with different head rotation, missing or clipped eyes',()=>{
 for(const live of [{...target,yaw:15,size:.15},{...target,pitch:8},{...target,clipped:true},{...target,size:NaN},{error:'missing'},null]){
  const r=eyeAlignmentStatus(live,target);assert.equal(r.distance.key,'unknown');assert.equal(r.ready,false);
 }
 const tilted={...target,roll:8};assert.equal(eyeAlignmentStatus(tilted,target).distance.key,'near');assert.equal(eyeAlignmentStatus(tilted,target).ready,false);
});
