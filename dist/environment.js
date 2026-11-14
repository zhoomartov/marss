import {distance,routePoints} from './route.js';
export const FIELDS={
 airTemperatureK:{label:'Air temperature · 2 m',unit:'°C',range:[-140,10],convert:v=>v-273.15},
 surfacePressurePa:{label:'Surface pressure',unit:'Pa',range:[0,1500],convert:v=>v},
 windSpeedMs:{label:'Wind speed · 2 m',unit:'m/s',range:[0,80],convert:v=>v},
 dustOpticalDepth:{label:'Dust optical depth · monthly mean',unit:'τ (visible)',range:[0,1.1],convert:v=>v}
};
export function validateClimate(data){
 if(data.version!=='MCD 6.2'||data.type!=='climatology-model')throw Error('Unknown climate data product');
 for(const key of Object.keys(FIELDS)){const g=data.grids?.[key];if(!g||g.lon.length!==64||g.lat.length!==48||g.values.length!==3072||g.values.some(v=>!Number.isFinite(v)))throw Error('Invalid climate grid');for(const axis of [g.lon,g.lat])if(axis.some((v,i)=>!Number.isFinite(v)||(i&&v<=axis[i-1])))throw Error('Invalid coordinates');}
 return data;
}
export function nearestIndex(axis,value){let best=0;for(let i=1;i<axis.length;i++)if(Math.abs(axis[i]-value)<Math.abs(axis[best]-value))best=i;return best;}
export function sampleClimate(data,lat,lon){
 if(!Number.isFinite(lat)||Math.abs(lat)>90||!Number.isFinite(lon))throw Error('Invalid location');
 lon=((lon+180)%360+360)%360-180;const g=data.grids.airTemperatureK,x=nearestIndex(g.lon,lon),y=nearestIndex(g.lat,lat),index=x*g.lat.length+y;
 return {lat,lon,gridLat:g.lat[y],gridLon:g.lon[x],cell:`${x}:${y}`,type:'climatology-model',solarLongitude:data.solarLongitude,localSolarHour:data.localSolarHour,values:Object.fromEntries(Object.entries(FIELDS).map(([k,f])=>[k,f.convert(data.grids[k].values[index])])),offsetKm:distance({lat,lon},{lat:g.lat[y],lon:g.lon[x]})};
}
const stops=[[24,36,95],[29,104,170],[62,180,180],[232,204,105],[212,70,43]];
export function colour(value,min,max){const t=Math.max(0,Math.min(1,(value-min)/(max-min)))*(stops.length-1),i=Math.min(stops.length-2,Math.floor(t)),f=t-i;return stops[i].map((v,j)=>Math.round(v+(stops[i+1][j]-v)*f));}
export function climateCanvas(data,key){
 const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=512;const ctx=canvas.getContext('2d'),img=ctx.createImageData(canvas.width,canvas.height),g=data.grids[key],field=FIELDS[key];
 const xs=Array.from({length:canvas.width},(_,x)=>nearestIndex(g.lon,(x+.5)/canvas.width*360-180)),ys=Array.from({length:canvas.height},(_,y)=>nearestIndex(g.lat,90-(y+.5)/canvas.height*180));
 for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){const rgb=colour(field.convert(g.values[xs[x]*g.lat.length+ys[y]]),...field.range),i=(y*canvas.width+x)*4;img.data.set([...rgb,255],i);}ctx.putImageData(img,0,0);return canvas;
}
export function routeEnvironment(data,start,end){const points=routePoints(start,end,129),samples=points.map(p=>sampleClimate(data,p.lat,p.lon));return {type:'climatology-model',source:data.source,scenario:data.scenario,solarLongitude:data.solarLongitude,localSolarHour:data.localSolarHour,gridCells:new Set(samples.map(p=>p.cell)).size,sampledPoints:samples.length,ranges:Object.fromEntries(Object.keys(FIELDS).map(key=>{const values=samples.map(p=>p.values[key]);return [key,{min:Math.min(...values),max:Math.max(...values)}];})),operationalSafety:'unknown',limitations:'Coarse seasonal climatology at fixed local solar time, not a simultaneous weather forecast. No slope, obstacles, shelter, spacesuit, radiation or storm validation.'};}
export function timeBudget(lengthKm,speedKmh,autonomyHours,reservePercent,roundTrip=true,stopHours=0){
 if(![lengthKm,speedKmh,autonomyHours,reservePercent,stopHours].every(Number.isFinite)||lengthKm<0||speedKmh<=0||autonomyHours<=0||reservePercent<0||reservePercent>=100||stopHours<0)throw Error('Enter valid planning assumptions');
 const travelHours=lengthKm*(roundTrip?2:1)/speedKmh,plannedHours=travelHours+stopHours,usableHours=autonomyHours*(1-reservePercent/100);return {travelHours,plannedHours,usableHours,marginHours:usableHours-plannedHours,withinEnteredBudget:plannedHours<=usableHours,assumptions:{speedKmh,autonomyHours,reservePercent,roundTrip,stopHours},meaning:'User-entered time budget only; not an oxygen model or EVA clearance.'};
}
export function ageDays(date,now=Date.now()){const t=Date.parse(date);return Number.isFinite(t)?Math.max(0,Math.floor((now-t)/86400000)):null;}
export function numericValue(value){if(value==null||String(value).trim()===''||value==='--')return null;const n=Number(value);return Number.isFinite(n)?n:null;}
