'use strict';
// Cloud persistence replaces device-local sessions. Originals remain untouched.
function saveLocalSession(){return syncCloud();}
const deviceFlow=renderFlow;renderFlow=function(){deviceFlow();$('shootAfter').disabled=!cloud.patient||!visits[0].photos.size||!!pending||importBusy;$('shootAfter').hidden=activeVisit>0;};
function shootAfter(){if(!cloud.patient||!readyToNavigate())return;if(!setView('after'))return;ghostVisible=true;$('opacity').value=40;render();if(!stream)startCamera();}
$('shootAfter').addEventListener('click',shootAfter);
$('tabAfter').addEventListener('click',()=>{if(cloud.patient&&activeVisit>0&&!pending&&!importBusy){ghostVisible=true;render();if(!stream)startCamera();}});
function requestScreen(){try{document.documentElement.requestFullscreen?.()?.catch(()=>{});}catch{}}
function leaveScreen(){try{if(document.fullscreenElement)document.exitFullscreen?.()?.catch(()=>{});}catch{}}
function resetFullScreen(){document.body.classList.remove('comparison-full');$('compareFullscreen').textContent='Schermo intero';}
$('compareFullscreen').addEventListener('click',()=>{if(document.body.classList.contains('comparison-full'))requestScreen();else leaveScreen();});
$('backToPhotos').addEventListener('click',leaveScreen);
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement)resetFullScreen();});
window.addEventListener('keydown',e=>{if(e.key==='Escape'){resetFullScreen();leaveScreen();}});
render();
