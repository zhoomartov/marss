export class MapView {
 constructor(maxZoom=4){this.maxZoom=maxZoom;this.zoom=1;this.x=0;this.y=0;}
 fit(){this.zoom=1;this.x=this.y=0;}
 clamp(){const max=1-1/this.zoom;this.x=Math.max(0,Math.min(max,this.x));this.y=Math.max(0,Math.min(max,this.y));}
 point(x,y){return {x:this.x+x/this.zoom,y:this.y+y/this.zoom};}
 scale(factor,x=.5,y=.5){const p=this.point(x,y);this.zoom=Math.max(1,Math.min(this.maxZoom,this.zoom*factor));this.x=p.x-x/this.zoom;this.y=p.y-y/this.zoom;this.clamp();}
}

export function bindMap(canvas,view,{getGrid,getMode,pick,hover,draw}){
 let drag=null;
 const relative=e=>{const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height};};
 canvas.addEventListener('pointerdown',e=>{if(!getGrid()||getMode()!=='pan')return;drag={x:e.clientX,y:e.clientY,vx:view.x,vy:view.y};canvas.setPointerCapture(e.pointerId);});
 for(const event of ['pointerup','pointercancel'])canvas.addEventListener(event,()=>{drag=null;});
 canvas.addEventListener('pointermove',e=>{if(!getGrid())return;if(drag){const r=canvas.getBoundingClientRect();view.x=drag.vx-(e.clientX-drag.x)/r.width/view.zoom;view.y=drag.vy-(e.clientY-drag.y)/r.height/view.zoom;view.clamp();draw();}const p=relative(e);hover(view.point(p.x,p.y));});
 canvas.addEventListener('click',e=>{if(!getGrid()||getMode()==='pan')return;const p=relative(e);pick(view.point(p.x,p.y));});
 canvas.addEventListener('wheel',e=>{if(!getGrid())return;e.preventDefault();const p=relative(e);view.scale(e.deltaY<0?1.25:.8,p.x,p.y);draw();},{passive:false});
 for(const [id,factor]of [['zoom-in',1.5],['zoom-out',1/1.5]])document.getElementById(id).onclick=()=>{view.scale(factor);draw();};
 document.getElementById('zoom-reset').onclick=()=>{view.fit();draw();};
}
