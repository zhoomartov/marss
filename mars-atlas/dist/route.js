import {normalizeLon} from './wmts.js';
const rad=Math.PI/180,R=3389.5;
export function distance(a,b){const dlat=(b.lat-a.lat)*rad,dlon=normalizeLon(b.lon-a.lon)*rad;const h=Math.sin(dlat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dlon/2)**2;return 2*R*Math.asin(Math.sqrt(Math.min(1,Math.max(0,h))));}
export function routePoints(a,b,count=65){
 const vector=p=>[Math.cos(p.lat*rad)*Math.cos(p.lon*rad),Math.cos(p.lat*rad)*Math.sin(p.lon*rad),Math.sin(p.lat*rad)];const x=vector(a),y=vector(b),angle=distance(a,b)/R;
 if(angle>Math.PI-1e-5)throw Error('Antipodal endpoints: choose an intermediate destination');
 return Array.from({length:count},(_,i)=>{const t=i/(count-1),u=angle<1e-9?1-t:Math.sin((1-t)*angle)/Math.sin(angle),v=angle<1e-9?t:Math.sin(t*angle)/Math.sin(angle),p=x.map((n,j)=>u*n+v*y[j]);return {lat:Math.atan2(p[2],Math.hypot(p[0],p[1]))/rad,lon:normalizeLon(Math.atan2(p[1],p[0])/rad)};});
}
export function summarize(samples,length){const covered=samples.filter(s=>s.ctx?.valid&&s.mola?.valid).length;return {length,covered,total:samples.length,coverage:covered/samples.length,safety:'unknown',reason:'Rendered WMTS imagery has no calibrated elevation or slope. Physical safety cannot be inferred from RGB.',samples};}
export async function analyzeRoute(client,a,b,current=()=>true){const points=routePoints(a,b),samples=[];for(let i=0;i<points.length;i+=6){if(!current())return null;const batch=await Promise.all(points.slice(i,i+6).map(async p=>{const values=await Promise.allSettled(['ctx','mola'].map(k=>client.sample(k,p.lat,p.lon)));return {...p,ctx:values[0].status==='fulfilled'?values[0].value:null,mola:values[1].status==='fulfilled'?values[1].value:null};}));samples.push(...batch);}return summarize(samples,distance(a,b));}
