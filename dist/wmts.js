import { USGSThemis, USGS_MATRIX } from './usgs-themis.js';
// Mars EQ products only: planetocentric latitude, east-positive longitude.
export const LAYERS={
 relief:{name:'MOLA + HRSC shaded relief',id:'Mars_MOLA_blend200ppx_HRSC_Shade_clon0dd_200mpp_lzw'},
 roughness:{name:'MOLA surface roughness',id:'mola_roughness'},
 thermal:{name:'THEMIS night infrared · USGS',id:'USGS_THEMIS_Controlled_NIR_COG'},
 minerals:{name:'TES plagioclase abundance',id:'TES_Plagioclase'},
 ctx:{name:'CTX V01 · Caltech / Esri',id:'CTX_V01',url:'https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX1/MapServer'},
 mola:{name:'MOLA colour relief',id:'Mars_MGS_MOLA_ClrShade_merge_global_463m'}
};
export const normalizeLon=lon=>((lon+180)%360+360)%360-180;
export function tilePixel(lat,lon,m){
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat < -90||lat > 90)throw Error('Invalid coordinates');
 const x=(normalizeLon(lon)+180)/360*m.width*m.tw;
 const y=Math.min(m.height*m.th-1e-7,(90-lat)/180*m.height*m.th);
 return {col:Math.floor(x/m.tw),row:Math.floor(y/m.th),x:Math.floor(x%m.tw),y:Math.floor(y%m.th)};
}
export function parseCapabilities(xml){
 const doc=new DOMParser().parseFromString(xml,'application/xml');
 const all=(n,t)=>Array.from(n.getElementsByTagNameNS('*',t));
 const val=(n,t)=>all(n,t)[0]?.textContent.trim();
 if(all(doc,'parsererror').length)throw Error('Invalid WMTS XML');
 const layer=all(doc,'Layer')[0], link=val(layer,'TileMatrixSet');
 const set=all(doc,'TileMatrixSet').find(n=>val(n,'Identifier')===link&&all(n,'TileMatrix').length);
 if(!set||!/(104905|4326|CRS84)/i.test(val(set,'SupportedCRS')))throw Error('Unsupported Mars projection');
 const template=all(layer,'ResourceURL').find(n=>n.getAttribute('resourceType')==='tile')?.getAttribute('template');
 if(!template||!template.startsWith('https://'))throw Error('Missing secure tile template');
 const matrices=all(set,'TileMatrix').map(n=>({id:val(n,'Identifier'),width:+val(n,'MatrixWidth'),height:+val(n,'MatrixHeight'),tw:+val(n,'TileWidth'),th:+val(n,'TileHeight'),origin:val(n,'TopLeftCorner')}));
 for(const m of matrices)if(m.width!==2*m.height||!Number.isInteger(m.width)||m.tw<1||m.th<1||m.origin.split(/\s+/).map(Number).join(',')!=='-180,90')throw Error('Unsupported tile grid');
 return {template,style:val(all(layer,'Style')[0],'Identifier'),set:link,matrices:matrices.sort((a,b)=>a.width-b.width)};
}
export function tileURL(meta,m,row,col){return meta.template.replace(/\{(Style|TileMatrixSet|TileMatrix|TileRow|TileCol)\}/g,(_,k)=>({Style:meta.style,TileMatrixSet:meta.set,TileMatrix:m.id,TileRow:row,TileCol:col}[k]));}


export function parseCTXService(data){
 const t=data.tileInfo;
 if(!t||t.origin.x!==-180||t.origin.y!==90||t.rows!==512||t.cols!==512||t.spatialReference?.wkid!==104971)throw Error('Unsupported CTX V01 tile grid');
 // The source is a 5 m mosaic. Do not use service oversampling levels beyond 12.
 const matrices=t.lods.filter(l=>l.level<=12).map(l=>{const rawWidth=360/(l.resolution*t.cols),rawHeight=180/(l.resolution*t.rows),width=Math.round(rawWidth),height=Math.round(rawHeight);if(Math.abs(rawWidth-width)>1e-5||Math.abs(rawHeight-height)>1e-5||width!==2*height)throw Error('Invalid CTX resolution');return {id:String(l.level),width,height,tw:t.cols,th:t.rows,origin:'-180 90'};}).sort((a,b)=>a.width-b.width);
 if(!matrices.length)throw Error('Missing CTX pyramid');
 return {template:LAYERS.ctx.url+'/tile/{TileMatrix}/{TileRow}/{TileCol}',style:'default',set:'Mars2000',radius:3396190,matrices};
}

// Select by actual screen density, bounded by GPU texture size and tile budget.
export function planMosaic(meta,bounds,pixels=2048,maxTextureSize=4096){
 if(bounds.length!==4||bounds.some(v=>!Number.isFinite(v))||bounds[0]<-180||bounds[2]>180||bounds[1]<-90||bounds[3]>90||bounds[0]>=bounds[2]||bounds[1]>=bounds[3])throw Error('Invalid viewport bounds');
 const span=bounds[2]-bounds[0];
 let index=meta.matrices.findIndex(m=>m.width*m.tw*span/360>=pixels);
 const sourceLimit=index<0;if(sourceLimit)index=meta.matrices.length-1;
 const requestedIndex=index;
 for(;index>=0;index--){
  const m=meta.matrices[index],left=Math.max(0,Math.floor((bounds[0]+180)/360*m.width)),right=Math.min(m.width-1,Math.ceil((bounds[2]+180)/360*m.width)-1),top=Math.max(0,Math.floor((90-bounds[3])/180*m.height)),bottom=Math.min(m.height-1,Math.ceil((90-bounds[1])/180*m.height)-1);
  const cols=right-left+1,rows=bottom-top+1;
  if(cols*rows<=64&&cols*m.tw<=maxTextureSize&&rows*m.th<=maxTextureSize)return {m,left,right,top,bottom,sourceLimit,budgetLimited:index<requestedIndex,metresPerPixel:2*Math.PI*(meta.radius??3389500)/(m.width*m.tw)};
 }
 throw Error('Viewport exceeds texture budget');
}

export class TrekClient{
 constructor(){this.usgs=new USGSThemis();this.metadata=new Map();this.cache=new Map();this.active=0;this.queue=[];}
 async slot(fn){if(this.active>=6)await new Promise(r=>this.queue.push(r));this.active++;try{return await fn();}finally{this.active--;this.queue.shift()?.();}}
 async metadataFor(key){
  if(key==='thermal')return USGS_MATRIX;
  if(!LAYERS[key])throw Error('Unknown layer');
  if(!this.metadata.has(key)){const url=key==='ctx'?LAYERS.ctx.url+'?f=pjson':`https://trek.nasa.gov/tiles/Mars/EQ/${LAYERS[key].id}/1.0.0/WMTSCapabilities.xml`;
   this.metadata.set(key,fetch(url,{signal:AbortSignal.timeout(15000)}).then(r=>{if(!r.ok)throw Error('Capabilities unavailable');return key==='ctx'?r.json():r.text();}).then(data=>key==='ctx'?parseCTXService(data):parseCapabilities(data)).catch(e=>{this.metadata.delete(key);throw e;}));}
  return this.metadata.get(key);
 }
 async tile(key,m,row,col){
  const id=`${key}/${m.id}/${row}/${col}`;
  if(this.cache.has(id)){const p=this.cache.get(id);this.cache.delete(id);this.cache.set(id,p);return p;}
  const p=this.slot(async()=>{if(key==='thermal')return this.usgs.tile(m,row,col);const meta=await this.metadataFor(key),r=await fetch(tileURL(meta,m,row,col),{mode:'cors',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error(`Tile unavailable (${r.status})`);
   const bitmap=await createImageBitmap(await r.blob());const c=document.createElement('canvas');c.width=m.tw;c.height=m.th;const ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0,c.width,c.height);bitmap.close();return {canvas:c};
  }).catch(e=>{this.cache.delete(id);throw e;});this.cache.set(id,p);while(this.cache.size>96)this.cache.delete(this.cache.keys().next().value);return p;
 }
 async mosaic(key,bounds=[-180,-90,180,90],pixels=2048,current=()=>true,options={}){
  const meta=await this.metadataFor(key);if(!current())return null;
  const plan=planMosaic(meta,bounds,pixels,options.maxTextureSize??4096),{m}=plan,range=plan;
  const {left,right,top,bottom}=range,c=document.createElement('canvas');c.width=(right-left+1)*m.tw;c.height=(bottom-top+1)*m.th;const ctx=c.getContext('2d');let loaded=0,total=0;const failures=[];
  const cells=[];for(let row=top;row<=bottom;row++)for(let col=left;col<=right;col++)cells.push({row,col});
  const centreRow=(top+bottom)/2,centreCol=(left+right)/2;
  cells.sort((a,b)=>(a.row-centreRow)**2+(a.col-centreCol)**2-(b.row-centreRow)**2-(b.col-centreCol)**2);
  total=cells.length;let next=0,finished=0,lastUpdate=-Infinity;
  const result=()=>({canvas:c,loaded,total,finished,failures,level:m.id,metresPerPixel:plan.metresPerPixel,sourceLimit:plan.sourceLimit,budgetLimited:plan.budgetLimited,bounds:[left/m.width,1-(bottom+1)/m.height,(right-left+1)/m.width,(bottom-top+1)/m.height]});
  // Only running workers own requests. Superseded views never queue their remaining tiles.
  await Promise.all(Array.from({length:Math.min(6,total)},async()=>{
   while(current()&&next<cells.length){const {row,col}=cells[next++];
    try{const t=await this.tile(key,m,row,col);if(!current())return;ctx.drawImage(t.canvas,(col-left)*m.tw,(row-top)*m.th);loaded++;}
    catch(error){failures.push({row,col,message:error.message});}
    finished++;const now=performance.now();if(current()&&loaded&&(now-lastUpdate>=120||finished===total)){lastUpdate=now;options.onProgress?.(result());}
   }
  }));return current()?result():null;
 }
 async sample(key,lat,lon,level=7){const meta=await this.metadataFor(key),m=meta.matrices[Math.min(level,meta.matrices.length-1)],p=tilePixel(lat,lon,m),t=await this.tile(key,m,p.row,p.col);t.pixels??=t.canvas.getContext('2d').getImageData(0,0,m.tw,m.th).data;const i=(p.y*m.tw+p.x)*4;const rgba=Array.from(t.pixels.slice(i,i+4));return {rgba,valid:rgba[3]===255,level:m.id,metresPerPixel:2*Math.PI*(meta.radius??3389500)/(m.width*m.tw),source: key==='ctx'?LAYERS.ctx.url:LAYERS[key].id,pixel:p};}
}
