'use strict';
function brightnessTarget(){return compareB>0&&compareA!==compareB?visits[compareB]?.photos.get(comparePose):null;}
function paintBrightnessControl(){const photo=brightnessTarget(),value=brightnessPercent(photo);$('afterBrightness').disabled=!photo;$('resetBrightness').disabled=!photo||value===0;$('afterBrightness').value=String(value);$('brightnessValue').textContent=value?`${value>0?'+':''}${value}%`:'Originale';$('brightnessStatus').textContent=photo?(value?'Luminosità del dopo regolata · '+(POSES.find(p=>p.id===comparePose)?.title||''):''):'Scegli due visite diverse e una foto del dopo.';}
function updateAfterBrightness(value){const photo=brightnessTarget();if(!photo)return;const next=brightnessPercent({brightness:Number(value)});if(next===brightnessPercent(photo))return;photo.brightness=next;revision++;
 for(const img of document.querySelectorAll('#comparisonSurface img[data-photo-key]')){const snap=snapshot(img.dataset.photoKey);if(snap.photo)img.style.filter=brightnessFilter(snap.photo);}
 paintBrightnessControl();
}
$('afterBrightness').addEventListener('input',()=>updateAfterBrightness($('afterBrightness').value));
$('afterBrightness').addEventListener('change',()=>{if(typeof saveLocalSession==='function')saveLocalSession();});
$('resetBrightness').addEventListener('click',()=>{updateAfterBrightness(0);if(typeof saveLocalSession==='function')saveLocalSession();});
const renderBeforeBrightness=renderComparison;renderComparison=function(){renderBeforeBrightness();paintBrightnessControl();};
paintBrightnessControl();
