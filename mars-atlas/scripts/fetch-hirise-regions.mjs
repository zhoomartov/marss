import fs from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {terrain,graph,plan} from '../dist/rover-core.js';
let fromUrl;try{({fromUrl}=await import('geotiff'));}catch{({fromUrl}=await import('../../qa-geotiff/node_modules/geotiff/dist-module/geotiff.js'));}
const root=new URL('../dist/data/',import.meta.url),cache=new URL('../../hirise-range-cache/',import.meta.url);
await fs.mkdir(cache,{recursive:true});
const nativeFetch=globalThis.fetch;let active=0;const queue=[];
// Cache completed byte ranges and keep only three network transfers in flight.
globalThis.fetch=async(url,options={})=>{
 const range=new Headers(options.headers).get('range');if(!range)return nativeFetch(url,options);
 const key=createHash('sha256').update(String(url)+' '+range).digest('hex'),file=new URL(key+'.bin',cache),meta=new URL(key+'.json',cache);
 try{const [b,m]=await Promise.all([fs.readFile(file),fs.readFile(meta,'utf8')]);const h=JSON.parse(m);return new Response(b,{status:h.status,headers:h.headers});}catch{}
 if(active>=3)await new Promise(r=>queue.push(r));active++;
 try{for(let retry=0;;retry++){try{const r=await nativeFetch(url,{...options,signal:AbortSignal.timeout(60000)});if(r.status!==206)throw Error('Expected HTTP 206 for '+range+', got '+r.status);const b=Buffer.from(await r.arrayBuffer());const headers=Object.fromEntries(r.headers);await fs.writeFile(file,b);await fs.writeFile(meta,JSON.stringify({status:r.status,headers}));return new Response(b,{status:r.status,headers});}catch(e){if(retry===4)throw e;console.log('Retry range',range,retry+1,e.message);}}}finally{active--;queue.shift()?.();}
};
const api='https://stac.astrogeology.usgs.gov/api',doc='https://stac.astrogeology.usgs.gov/docs/data/mars/hirise_dtms/';
let features;try{features=JSON.parse(await fs.readFile(new URL('../../hirise-jezero-items.json',import.meta.url))).features;}catch{features=(await(await fetch(api+'/search?collections=mro_hirise_socet_dtms&bbox=77.3,18.3,77.6,18.6&limit=100')).json()).features;}
const selections=[{id:'jezero-delta',name:'Jezero · western delta',description:'Layered delta terrain and scarps',match:'002387',lon:77.405,lat:18.46},{id:'jezero-landing',name:'Jezero · landing plain',description:'Crater-floor terrain near the Perseverance landing area',match:'045994',lon:77.4509,lat:18.4446},{id:'jezero-east',name:'Jezero · eastern floor',description:'Crater-floor ridges and small impact features',match:'048842',lon:77.51,lat:18.445}];
const manifest=[];const n=960,N=2048,R=3396190,K=Math.PI*R/180;
function validateProjection(image){const k=image.getGeoKeys();if(k.GeogSemiMajorAxisGeoKey!==R||k.GeogSemiMinorAxisGeoKey!==R||k.ProjStdParallel1GeoKey!==0||k.ProjCenterLongGeoKey!==0||k.ProjCenterLatGeoKey!==0||k.ProjFalseEastingGeoKey!==0||k.ProjFalseNorthingGeoKey!==0||k.ProjCoordTransGeoKey!==17||k.ProjLinearUnitsGeoKey!==9001||k.GTRasterTypeGeoKey!==1)throw Error('Unsupported projection');const tr=image.fileDirectory.getValue('ModelTransformation');if(tr&&(tr[1]||tr[4]))throw Error('Rotated grid unsupported');const [x,y]=image.getResolution();if(!(x>0&&y<0))throw Error('Not north-up');}
function validateWindow(image,w){if(w[0]<0||w[1]<0||w[2]>image.getWidth()||w[3]>image.getHeight())throw Error('Crop outside source image');}
function crc(b){let c=-1;for(const v of b){c^=v;for(let k=0;k<8;k++)c=c&1?(c>>>1)^0xedb88320:c>>>1;}return(c^-1)>>>0;}
function chunk(t,b){const tag=Buffer.from(t),len=Buffer.alloc(4),c=Buffer.alloc(4);len.writeUInt32BE(b.length);c.writeUInt32BE(crc(Buffer.concat([tag,b])));return Buffer.concat([len,tag,b,c]);}
function png(p,w,h){const head=Buffer.alloc(13);head.writeUInt32BE(w);head.writeUInt32BE(h,4);head[8]=8;head[9]=0;const raw=Buffer.alloc((w+1)*h);for(let y=0;y<h;y++)Buffer.from(p.buffer,p.byteOffset+y*w,w).copy(raw,y*(w+1)+1);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
for(const s of selections){
 console.log('Begin',s.id);const f=features.find(f=>f.id.includes(s.match)),a=f.assets.dtm;
 const t=await fromUrl(a.href,{allowFullFile:false,cacheSize:32});const im=await t.getImage();validateProjection(im);const band=a['raster:bands'][0];if(band.scale!==1||band.offset!==0||im.getSampleFormat(0)!==3||im.getBitsPerSample(0)!==32)throw Error('Expected unscaled Float32 DTM');
 const [rx,ry]=im.getResolution(),[ox,oy]=im.getOrigin(),wx=Math.round((s.lon*K-ox)/rx-n/2),wy=Math.round((s.lat*K-oy)/ry-n/2),window=[wx,wy,wx+n,wy+n];validateWindow(im,window);
 const noData=im.getGDALNoData(),values=Array.from(await im.readRasters({window,samples:[0],interleave:true}),v=>Number.isFinite(v)&&v>-3e38&&v!==noData?v:null);
 const xmin=ox+wx*rx,ymax=oy+wy*ry,xmax=xmin+n*rx,ymin=ymax+n*ry;
 const d={width:n,height:n,x0:xmin+rx/2,y0:ymax+ry/2,dx:rx,dy:ry,values,routeFactor:4,projection:{name:'Mars 2015 Sphere Equirectangular',type:'equirectangular',radius:R,standardParallel:0,centralLongitude:0,centralLatitude:0,falseEasting:0,falseNorthing:0,units:'metres',latitudeType:'planetocentric',longitudeDirection:'east-positive'},bounds:{west:xmin/K,east:xmax/K,south:ymin/K,north:ymax/K},provenance:{title:'NASA MRO HiRISE stereo DTM / USGS ARD · '+f.id,pageUrl:doc,sourceUrl:a.href,stacItem:api+'/collections/mro_hirise_socet_dtms/items/'+f.id,retrievedAt:new Date().toISOString(),sourceWindow:window,sourceNoData:noData,sourceResolutionM:rx,sourceSha256:null,subsetSha256:createHash('sha256').update(JSON.stringify(values)).digest('hex'),processing:'Native COG crop; no smoothing or NoData filling. Four-by-four route aggregation retains maximum native slope.',verticalDatum:'Height above/below Mars aeroid; MOLA-controlled per USGS collection.'}};
 const g=graph(terrain(d,4)),visited=new Uint8Array(g.blocked.length);let best=[];
 for(let i=0;i<visited.length;i++){if(visited[i]||g.blocked[i])continue;const q=[i];visited[i]=1;for(let k=0;k<q.length;k++)for(const[j]of g.neighbours(q[k]))if(!visited[j]){visited[j]=1;q.push(j);}if(q.length>best.length)best=q;}
 if(best.length<100)throw Error('No useful traversable component');const left=best.reduce((a,b)=>g.t.coords[a].lon<g.t.coords[b].lon?a:b),right=best.reduce((a,b)=>g.t.coords[a].lon>g.t.coords[b].lon?a:b);
 d.anchors={start:{...g.t.coords[left],name:'Demonstration departure',meaning:'Scenario waypoint, not a real base'},goal:{...g.t.coords[right],name:'Demonstration science target',meaning:'Scenario waypoint, not a certified site'}};
 const route=plan(g.t,d.anchors.start,d.anchors.goal);if(route.status!=='optimal')throw Error('Default route failed');console.log('DEM',s.id,'valid',values.filter(v=>v!==null).length,'component',best.length,'route km',route.metrics.oneWayKm);
 await fs.writeFile(new URL(s.id+'-dem.json',root),JSON.stringify(d));
 const ortho=Object.values(f.assets).find(a=>/RED_A_01_ORTHO.tif$/.test(a.href)),ot=await fromUrl(ortho.href,{allowFullFile:false,cacheSize:64}),oi=await ot.getImage();validateProjection(oi);const [irx,iry]=oi.getResolution(),[iox,ioy]=oi.getOrigin();
 const ix=Math.floor((xmin-iox)/irx),iy=Math.floor((ymax-ioy)/iry),ix1=Math.ceil((xmax-iox)/irx),iy1=Math.ceil((ymin-ioy)/iry),iw=ix1-ix,ih=iy1-iy;validateWindow(oi,[ix,iy,ix1,iy1]);console.log('Ortho window',iw,ih,'native m/px',irx);
 const raster=await oi.readRasters({window:[ix,iy,ix1,iy1],samples:[0],interleave:true}),nd=oi.getGDALNoData(),sample=[];
 for(let i=0;i<raster.length;i+=17){const v=raster[i];if(Number.isFinite(v)&&v!==nd&&v>0)sample.push(v);}sample.sort((a,b)=>a-b);const lo=sample[Math.floor(sample.length*.01)],hi=sample[Math.floor(sample.length*.99)];if(!(hi>lo))throw Error('No image contrast');
 const pix=new Uint8Array(N*N);let missing=0;
 for(let y=0;y<N;y++)for(let x=0;x<N;x++){const sx=(xmin+(x+.5)*(xmax-xmin)/N-iox)/irx-.5-ix,sy=(ymax+(y+.5)*(ymin-ymax)/N-ioy)/iry-.5-iy,x0=Math.max(0,Math.min(iw-2,Math.floor(sx))),y0=Math.max(0,Math.min(ih-2,Math.floor(sy))),fx=sx-x0,fy=sy-y0,vv=[raster[y0*iw+x0],raster[y0*iw+x0+1],raster[(y0+1)*iw+x0],raster[(y0+1)*iw+x0+1]];if(vv.some(v=>v===nd||!Number.isFinite(v))){missing++;continue;}const v=(vv[0]*(1-fx)+vv[1]*fx)*(1-fy)+(vv[2]*(1-fx)+vv[3]*fx)*fy;pix[y*N+x]=Math.max(0,Math.min(255,Math.round((v-lo)/(hi-lo)*255)));}
 await fs.writeFile(new URL(s.id+'-ortho.png',root),png(pix,N,N));
 manifest.push({id:s.id,name:s.name,description:s.description,dem:'./data/'+s.id+'-dem.json',image:'./data/'+s.id+'-ortho.png',imageResolutionM:(xmax-xmin)/N,nativeImageResolutionM:irx,imageSourceUrl:ortho.href,imagePageUrl:doc,imageWidth:N,imageHeight:N,imageBounds:[xmin,ymin,xmax,ymax],imageProcessing:'RED-band monochrome orthoimage; bilinear sampling to exact DEM footprint; linear 1–99 percentile contrast stretch.',imageMissingPercent:missing/(N*N)*100,sourceItemId:f.id});
 console.log('Image complete',s.id,'missing percent',missing/(N*N)*100);await fs.writeFile(new URL('mission-regions.json',root),JSON.stringify(manifest,null,2));
}
