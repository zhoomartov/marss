// All costs refer to this explicit rover scenario, not a validated flight vehicle.
export const DEFAULTS = Object.freeze({massKg:1200,speedKmh:5,rolling:.08,efficiency:.65,hotelW:600,thermalWPerK:8,cabinC:20,ambientC:-60,batteryKwh:20,autonomyHours:8,reservePercent:30,stopHours:.5,maxSlopeDeg:12,roundTrip:true});
const RAD=Math.PI/180, G=3.71;
export function parameters(input={}) {
 const p={...DEFAULTS,...input};
 const ranges={massKg:[1,100000],speedKmh:[.1,30],rolling:[.001,.5],efficiency:[.01,1],hotelW:[0,100000],thermalWPerK:[0,1000],cabinC:[-20,40],ambientC:[-160,40],batteryKwh:[.01,10000],autonomyHours:[.01,10000],reservePercent:[0,99],stopHours:[0,10000],maxSlopeDeg:[.1,35]};
 for(const [k,[lo,hi]] of Object.entries(ranges))if(!Number.isFinite(p[k])||p[k]<lo||p[k]>hi)throw Error(`Invalid ${k}: expected ${lo}–${hi}`);
 if(typeof p.roundTrip!=='boolean')throw Error('Invalid return option');
 return p;
}
export function coordinates(d,x,y){const p=d.projection;return {lon:p.centralLongitude+(d.x0+x*d.dx)/(p.radius*Math.cos(p.standardParallel*RAD))/RAD,lat:(d.y0+y*d.dy)/p.radius/RAD};}
export function gridPosition(d,p){const r=d.projection;return {x:((p.lon-r.centralLongitude)*RAD*r.radius*Math.cos(r.standardParallel*RAD)-d.x0)/d.dx,y:(p.lat*RAD*r.radius-d.y0)/d.dy};}
export function metres(a,b,r){const h=Math.sin((a.lat-b.lat)*RAD/2)**2+Math.cos(a.lat*RAD)*Math.cos(b.lat*RAD)*Math.sin((a.lon-b.lon)*RAD/2)**2;return 2*r*Math.asin(Math.sqrt(Math.min(1,h)));}
export function validateDEM(d){
 if(!Number.isInteger(d.width)||!Number.isInteger(d.height)||d.width<3||d.height<3||d.width*d.height>2000000||d.values?.length!==d.width*d.height)throw Error('Invalid numerical DEM grid');
 if(!(d.dx>0&&d.dy<0)||![d.x0,d.y0,d.dx,d.dy,d.projection?.radius,d.projection?.standardParallel,d.projection?.centralLongitude].every(Number.isFinite)||d.projection.radius<=0||Math.abs(d.projection.standardParallel)>=90)throw Error('Unsupported DEM georeferencing');
 if(d.values.some(v=>v!==null&&!Number.isFinite(v)))throw Error('Invalid DEM elevations');
 return d;
}
// Max native slope and strict no-data aggregation preserve exclusions when planning at 40 m.
export function terrain(d,factor=2){
 validateDEM(d);if(!Number.isInteger(factor)||factor<1||factor>10)throw Error('Invalid aggregation');
 const native=new Float32Array(d.values.length).fill(NaN),w=d.width,h=d.height;
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
  const i=y*w+x,z=d.values[i];if(z===null)continue;
  const c=coordinates(d,x,y),east=metres(c,coordinates(d,x+1,y),d.projection.radius),north=metres(c,coordinates(d,x,y+1),d.projection.radius);
  let max=0,valid=true;
  for(let yy=-1;yy<=1;yy++)for(let xx=-1;xx<=1;xx++){if(!xx&&!yy)continue;const v=d.values[i+yy*w+xx];if(v===null){valid=false;continue;}max=Math.max(max,Math.abs(v-z)/Math.hypot(xx*east,yy*north));}
  if(valid){const gx=(d.values[i+1]-d.values[i-1])/(2*east),gy=(d.values[i+w]-d.values[i-w])/(2*north);native[i]=Math.atan(Math.max(max,Math.hypot(gx,gy)))/RAD;}
 }
 const out={width:Math.floor(w/factor),height:Math.floor(h/factor),dx:d.dx*factor,dy:d.dy*factor,x0:d.x0+(factor-1)*d.dx/2,y0:d.y0+(factor-1)*d.dy/2,projection:d.projection,provenance:d.provenance,factor};
 out.values=new Float64Array(out.width*out.height).fill(NaN);out.slopes=new Float32Array(out.values.length).fill(NaN);
 out.coords=Array.from({length:out.values.length},(_,i)=>coordinates(out,i%out.width,Math.floor(i/out.width)));
 for(let y=0;y<out.height;y++)for(let x=0;x<out.width;x++){
  let sum=0,max=0,valid=true;
  for(let yy=0;yy<factor;yy++)for(let xx=0;xx<factor;xx++){const i=(y*factor+yy)*w+x*factor+xx;if(d.values[i]===null||!Number.isFinite(native[i]))valid=false;else{sum+=d.values[i];max=Math.max(max,native[i]);}}
  if(valid){out.values[y*out.width+x]=sum/(factor*factor);out.slopes[y*out.width+x]=max;}
 }
 return out;
}
export function nodeAt(t,p){const q=gridPosition(t,p),x=Math.round(q.x),y=Math.round(q.y);if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>=t.width||y>=t.height)throw Error('Point outside the numerical DEM. Choose a location inside the Jezero map.');return y*t.width+x;}
export function graph(t,input={},exclusions=[]){
 const p=parameters(input),blocked=new Uint8Array(t.values.length);
 for(let i=0;i<blocked.length;i++){
  blocked[i]=!Number.isFinite(t.values[i])||!Number.isFinite(t.slopes[i])||t.slopes[i]>p.maxSlopeDeg?1:0;
  for(const zone of exclusions){if(!Number.isFinite(zone.lat)||!Number.isFinite(zone.lon)||!Number.isFinite(zone.radiusM)||zone.radiusM<=0)throw Error('Invalid exclusion zone');if(metres(t.coords[i],zone,t.projection.radius)<=zone.radiusM+Math.hypot(t.dx,t.dy)/2)blocked[i]=1;}
 }
 const multiplier=p.roundTrip?2:1,hotelW=p.hotelW+p.thermalWPerK*Math.max(0,p.cabinC-p.ambientC);
 function edge(a,b){
  if(blocked[a]||blocked[b])return null;
  const ax=a%t.width,ay=Math.floor(a/t.width),bx=b%t.width,by=Math.floor(b/t.width),xx=bx-ax,yy=by-ay;
  if(Math.abs(xx)>1||Math.abs(yy)>1||(!xx&&!yy))return null;
  if(xx&&yy&&(blocked[ay*t.width+bx]||blocked[by*t.width+ax]))return null;
  const horizontal=metres(t.coords[a],t.coords[b],t.projection.radius),dz=t.values[b]-t.values[a],grade=Math.atan2(Math.abs(dz),horizontal)/RAD;
  if(grade>p.maxSlopeDeg)return null;
  const length=Math.hypot(horizontal,dz),hours=multiplier*length/(p.speedKmh*1000)*(1+2*(grade/p.maxSlopeDeg)**2);
  const rolling=p.massKg*G*p.rolling*horizontal*multiplier/p.efficiency/3600000;
  const climb=p.massKg*G*(p.roundTrip?Math.abs(dz):Math.max(0,dz))/p.efficiency/3600000;
  const hotel=hotelW*hours/1000;
  return {energy:rolling+climb+hotel,hours,lengthM:length,horizontalM:horizontal,ascentM:Math.max(0,dz),descentM:Math.max(0,-dz),grade,rolling,climb,hotel};
 }
 function neighbours(i){const out=[],x=i%t.width,y=Math.floor(i/t.width);for(let yy=-1;yy<=1;yy++)for(let xx=-1;xx<=1;xx++){if((xx||yy)&&x+xx>=0&&x+xx<t.width&&y+yy>=0&&y+yy<t.height){const j=i+yy*t.width+xx,e=edge(i,j);if(e)out.push([j,e]);}}return out;}
 const stopEnergy=hotelW*p.stopHours/1000,energyBudget=p.batteryKwh*(1-p.reservePercent/100),timeBudget=p.autonomyHours*(1-p.reservePercent/100);
 return {t,p,blocked,edge,neighbours,multiplier,stopEnergy,energyBudget,timeBudget,hotelW,
  lowerBound(a,b){const d=metres(t.coords[a],t.coords[b],t.projection.radius);return multiplier*d*(p.massKg*G*p.rolling/p.efficiency/3600000+hotelW/1000/(p.speedKmh*1000));},
  minTime(a,b){return multiplier*metres(t.coords[a],t.coords[b],t.projection.radius)/(p.speedKmh*1000);}};
}
class Heap{
 constructor(){this.a=[];}get size(){return this.a.length;}
 push(v){const a=this.a;a.push(v);let i=a.length-1;while(i){const p=(i-1)>>1;if(a[p].priority<=v.priority)break;a[i]=a[p];i=p;}a[i]=v;}
 pop(){const a=this.a,top=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&a[c+1].priority<a[c].priority)c++;if(a[c].priority>=last.priority)break;a[i]=a[c];i=c;}a[i]=last;}return top;}
}
export function metrics(g,path){
 const m={energy:g.stopEnergy,hours:g.p.stopHours,lengthM:0,ascentM:0,descentM:0,maxSlopeDeg:0,rolling:0,climb:0,hotel:g.stopEnergy};
 for(let i=0;i<path.length;i++){m.maxSlopeDeg=Math.max(m.maxSlopeDeg,g.t.slopes[path[i]]);if(!i)continue;const e=g.edge(path[i-1],path[i]);if(!e)throw Error('Path crosses blocked terrain');for(const k of ['energy','hours','lengthM','ascentM','descentM','rolling','climb','hotel'])m[k]+=e[k];m.maxSlopeDeg=Math.max(m.maxSlopeDeg,e.grade);}
 m.missionKm=m.lengthM*g.multiplier/1000;m.oneWayKm=m.lengthM/1000;m.energyMargin=g.energyBudget-m.energy;m.timeMargin=g.timeBudget-m.hours;return m;
}
// Scalar graph shortest path; also used as an independent zero-heuristic verifier.
export function shortest(g,start,goal,{objective='energy',heuristic=true}={}){
 if(g.blocked[start]||g.blocked[goal])return {status:'blocked-endpoint',path:[]};
 const n=g.t.values.length,dist=new Float64Array(n).fill(Infinity),prev=new Int32Array(n).fill(-1),closed=new Uint8Array(n),heap=new Heap();dist[start]=0;
 const h=i=>objective==='energy'&&heuristic?g.lowerBound(i,goal):0;heap.push({node:start,cost:0,priority:h(start)});let expanded=0;
 while(heap.size){const cur=heap.pop(),i=cur.node;if(closed[i]||cur.cost!==dist[i])continue;closed[i]=1;expanded++;if(i===goal){const path=[];for(let at=i;at!==-1;at=prev[at])path.push(at);path.reverse();return {status:'optimal',path,cost:dist[i],expanded,visited:closed};}
  for(const [j,e] of g.neighbours(i)){const value=dist[i]+(objective==='distance'?e.lengthM:e.energy);if(value<dist[j]){dist[j]=value;prev[j]=i;heap.push({node:j,cost:value,priority:value+h(j)});}}
 }
 return {status:'no-path',path:[],expanded,visited:closed};
}
// Exact energy/time Pareto labels. No epsilon dominance or arbitrary time bins.
// On limits, return an explicit incomplete result instead of claiming infeasibility.
export function constrained(g,start,goal,{maxLabels=350000}={}){
 if(g.blocked[start]||g.blocked[goal])return {status:'blocked-endpoint',path:[]};
 const labels=Array.from({length:g.t.values.length},()=>[]),heap=new Heap(),all=[],visited=new Uint8Array(g.t.values.length);let expanded=0;
 const root={node:start,energy:g.stopEnergy,hours:g.p.stopHours,parent:-1,active:true,id:0,priority:g.stopEnergy+g.lowerBound(start,goal)};all.push(root);labels[start].push(root);heap.push(root);
 while(heap.size){const cur=heap.pop();if(!cur.active)continue;if(cur.energy>g.energyBudget||cur.hours>g.timeBudget)continue;visited[cur.node]=1;expanded++;
  if(cur.node===goal){const path=[];for(let at=cur;at;at=at.parent<0?null:all[at.parent])path.push(at.node);return {status:'optimal',path:path.reverse(),cost:cur.energy,expanded,labelCount:all.length,visited,lowerBound:cur.energy,gap:0,method:'Resource-constrained A* / Pareto labels'};}
  for(const [node,e] of g.neighbours(cur.node)){
   const energy=cur.energy+e.energy,hours=cur.hours+e.hours,priority=energy+g.lowerBound(node,goal);
   if(priority>g.energyBudget||hours+g.minTime(node,goal)>g.timeBudget)continue;
   const list=labels[node];if(list.some(l=>l.active&&l.energy<=energy&&l.hours<=hours))continue;
   for(const l of list)if(l.active&&energy<=l.energy&&hours<=l.hours)l.active=false;
   if(all.length>=maxLabels)return {status:'search-limit',path:[],expanded,labelCount:all.length,visited};
   const next={node,energy,hours,priority,parent:cur.id,active:true,id:all.length};all.push(next);list.push(next);heap.push(next);
  }
 }
 return {status:'infeasible',path:[],expanded,labelCount:all.length,visited};
}
export function straightPath(t,a,b){
 const ax=a%t.width,ay=Math.floor(a/t.width),bx=b%t.width,by=Math.floor(b/t.width),steps=Math.max(Math.abs(bx-ax),Math.abs(by-ay)),path=[];
 for(let k=0;k<=steps;k++){const f=steps?k/steps:0,i=Math.round(ay+(by-ay)*f)*t.width+Math.round(ax+(bx-ax)*f);if(path.at(-1)!==i)path.push(i);}return path;
}
export function plan(t,startPoint,endPoint,input={},exclusions=[],options={}){
 const g=graph(t,input,exclusions),start=nodeAt(t,startPoint),goal=nodeAt(t,endPoint),base={start,goal,assumptions:g.p,energyBudget:g.energyBudget,timeBudget:g.timeBudget,blocked:g.blocked,domain:{width:t.width,height:t.height,stepM:t.dx},snapMetres:{start:metres(startPoint,t.coords[start],t.projection.radius),goal:metres(endPoint,t.coords[goal],t.projection.radius)}};
 const direct=straightPath(t,start,goal),bad=direct.findIndex((n,i)=>g.blocked[n]||(i&&!g.edge(direct[i-1],n)));
 base.direct={path:direct,status:bad<0?'traversable':'blocked',metrics:bad<0?metrics(g,direct):null};
 if(g.blocked[start]||g.blocked[goal])return {...base,status:'blocked-endpoint',path:[]};
 if(g.stopEnergy>g.energyBudget||g.p.stopHours>g.timeBudget)return {...base,status:'infeasible',path:[],reason:'Science stop alone exceeds the reserved mission budget.'};
 const energy=shortest(g,start,goal),short=shortest(g,start,goal,{objective:'distance',heuristic:false});
 base.shortest={path:short.path,status:short.status,metrics:short.path.length?metrics(g,short.path):null};
 if(energy.status!=='optimal')return {...base,...energy};
 const em=metrics(g,energy.path);
 if(em.energy>g.energyBudget)return {...base,status:'infeasible',path:[],reason:'Even the minimum-energy route exceeds available energy.',minimumRequiredEnergy:em.energy};
 let result;
 if(em.hours<=g.timeBudget){const verifier=shortest(g,start,goal,{heuristic:false});if(!Number.isFinite(verifier.cost)||Math.abs(energy.cost-verifier.cost)>1e-9)throw Error('Optimality verification failed');result={...energy,method:'A* + Dijkstra verification',verification:{energyAStar:em.energy,energyDijkstra:verifier.cost+g.stopEnergy,delta:Math.abs(energy.cost-verifier.cost),expandedDijkstra:verifier.expanded},lowerBound:em.energy,gap:0};}
 else result=constrained(g,start,goal,options);
 return {...base,...result,metrics:result.path.length?metrics(g,result.path):null,profile:result.path.map(i=>({...t.coords[i],elevationM:t.values[i],slopeDeg:t.slopes[i]})),minimumUnconstrained:em};
}
