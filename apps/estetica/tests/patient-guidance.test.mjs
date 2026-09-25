import test from 'node:test';
import assert from 'node:assert/strict';
import {patientInstruction,measureFace,targetForPose,deltaAngle} from '../public/patient-guidance-core.mjs';
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
 assert.equal(targetForPose({kind:'oblique',flip:false}).yaw,35);
 assert.equal(targetForPose({kind:'oblique',flip:true}).yaw,-35);
});
test('eye roll measured in original image coordinates',()=>{
 const points=Array.from({length:478},()=>({x:.5,y:.5}));points[33]={x:.3,y:.35};points[263]={x:.7,y:.45};
 const face=measureFace({faceLandmarks:[points],facialTransformationMatrixes:[{data:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}]},360,480);
 assert.ok(face.roll>0);assert.equal(patientInstruction({...target,roll:face.roll},target).text,'Inclina la testa verso la tua destra');
});
