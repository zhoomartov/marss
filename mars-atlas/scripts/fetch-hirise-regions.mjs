import fs from 'node:fs/promises';
import {fromUrl} from 'geotiff';
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {terrain, graph, plan, coordinates} from '../dist/rover-core.js';
// Bound concurrent COG range requests; public S3 endpoints can time out under fan-out.
const nativeFetch=globalThis.fetch;let activeFetches=0;const fetchQueue=[];
globalThis.fetch=async(...args)=>{if(activeFetches>=4)await new Promise(resolve=>fetchQueue.push(resolve));activeFetches++;try{for(let attempt=0;;attempt++){try{return await nativeFetch(...args);}catch(error){if(attempt>=3)throw error;await new Promise(r=>setTimeout(r,500*(attempt+1)));}}}finally{activeFetches--;fetchQueue.shift()?.();}};
const root=new URL('../dist/data/',import.meta.url);
const api='https://stac.astrogeology.usgs.gov/api';
const doc='https://stac.astrogeology.usgs.gov/docs/data/mars/hirise_dtms/';
const features=(await(await fetch(api+'/search?collections=mro_hirise_socet_dtms&bbox=77.3,18.3,77.6,18.6&limit=100')).json()).features;
const selections=[{id:'jezero-delta',name:'Jezero · western delta',description:'Layered delta terrain and scarps',match:'002387',lon:77.405,lat:18.46},{id:'jezero-landing',name:'Jezero · landing plain',description:'Crater-floor terrain near the Perseverance landing area',match:'045994',lon:77.4509,lat:18.4446},{id:'jezero-east',name:'Jezero · eastern floor',description:'Crater-floor ridges and small impact features',match:'048842',lon:77.51,lat:18.445}];
const manifest=[];const n=960,N=2048,R=3396190,K=Math.PI*R/180;
function validateProjection(image){const k=image.getGeoKeys();if(k.GeogSemiMajorAxisGeoKey!==R||k.GeogSemiMinorAxisGeoKey!==R||k.ProjStdParallel1GeoKey!==0||k.ProjCenterLongGeoKey!==0||k.ProjCenterLatGeoKey!==0||k.ProjFalseEastingGeoKey!==0||k.ProjFalseNorthingGeoKey!==0||k.ProjCoordTransGeoKey!==17||k.ProjLinearUnitsGeoKey!==9001||k.GTRasterTypeGeoKey!==1)throw Error('Unsupported projection');const tr=image.fileDirectory.getValue('ModelTransformation');if(tr&&(tr[1]||tr[4]))throw Error('Rotated grid unsupported');const [x,y]=image.getResolution();if(!(x>0&&y<0))throw Error('Not north-up');}
function validateWindow(image,window){if(window[0]<0||window[1]<0||window[2]>image.getWidth()||window[3]>image.getHeight())throw Error('Crop extends outside image');}
function crc(b){let c=-1;for(const v of b){c^=v;for(let k=0;k<8;k++)c=c&1?(c>>>1)^0xedb88320:c>>>1;}return(c^-1)>>>0;}
function chunk(t,b){const tag=Buffer.from(t),len=Buffer.alloc(4),c=Buffer.alloc(4);len.writeUInt32BE(b.length);c.writeUInt32BE(crc(Buffer.concat([tag,b])));return Buffer.concat([len,tag,b,c]);}
function png(pixels,w,h){const head=Buffer.alloc(13);head.writeUInt32BE(w);head.writeUInt32BE(h,4);head[8]=8;head[9]=0;const raw=Buffer.alloc((w+1)*h);for(let y=0;y<h;y++)Buffer.from(pixels.buffer,pixels.byteOffset+y*w,w).copy(raw,y*(w+1)+1);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
for(const selection of selections){
 console.log('begin',selection.id);const f=features.find(f=>f.id.includes(selection.match));const a=f.assets.dtm;
 const t=await fromUrl(a.href,{allowFullFile:false,cacheSize:32});const im=await t.getImage();validateProjection(im);const band=a['raster:bands'][0];if(band.scale!==1||band.offset!==0||im.getSampleFormat(0)!==3||im.getBitsPerSample(0)!==32)throw Error('Expected unscaled Float32 elevations');const [rx,ry]=im.getResolution(),[ox,oy]=im.getOrigin();
 const wx=Math.round((selection.lon*K-ox)/rx-n/2),wy=Math.round((selection.lat*K-oy)/ry-n/2);
 validateWindow(im,[wx,wy,wx+n,wy+n]);const noData=im.getGDALNoData();
 const values=Array.from(await im.readRasters({window:[wx,wy,wx+n,wy+n],samples:[0],interleave:true}),v=>Number.isFinite(v)&&v>-3e38&&v!==noData?v:null);
 const xmin=ox+wx*rx,ymax=oy+wy*ry,xmax=xmin+n*rx,ymin=ymax+n*ry;
 const d={width:n,height:n,x0:xmin+rx/2,y0:ymax+ry/2,dx:rx,dy:ry,values,routeFactor:4,projection:{name:'Mars 2015 Sphere Equirectangular',type:'equirectangular',radius:R,standardParallel:0,centralLongitude:0,centralLatitude:0,falseEasting:0,falseNorthing:0,units:'metres',latitudeType:'planetocentric',longitudeDirection:'east-positive'},bounds:{west:xmin/K,east:xmax/K,south:ymin/K,north:ymax/K},provenance:{title:'NASA MRO HiRISE stereo DTM / USGS ARD · '+f.id,pageUrl:doc,sourceUrl:a.href,stacItem:api+'/collections/mro_hirise_socet_dtms/items/'+f.id,retrievedAt:new Date().toISOString(),sourceWindow:[wx,wy,wx+n,wy+n],sourceNoData:im.getGDALNoData(),sourceResolutionM:rx,sourceSha256:null,subsetSha256:createHash('sha256').update(JSON.stringify(values)).digest('hex'),processing:'Native COG crop; no smoothing or NoData filling. Four-by-four route aggregation retains maximum native slope.',verticalDatum:'Height above/below Mars aeroid; MOLA-controlled per USGS collection.'}};
 const g=graph(terrain(d,4));let best=[];const visited=new Uint8Array(g.blocked.length);
 for(let i=0;i<visited.length;i++){if(visited[i]||g.blocked[i])continue;const q=[i];visited[i]=1;for(let k=0;k<q.length;k++)for(const[j]of g.neighbours(q[k]))if(!visited[j]){visited[j]=1;q.push(j);}if(q.length>best.length)best=q;}
 if(best.length<100)throw Error('No useful traversable component '+selection.id);
 const left=best.reduce((a,b)=>g.t.coords[a].lon<g.t.coords[b].lon?a:b),right=best.reduce((a,b)=>g.t.coords[a].lon>g.t.coords[b].lon?a:b);
 d.anchors={start:{...g.t.coords[left],name:'Demonstration departure',meaning:'Scenario waypoint, not a real base'},goal:{...g.t.coords[right],name:'Demonstration science target',meaning:'Scenario waypoint, not a certified landing or science site'}};
 const route=plan(g.t,d.anchors.start,d.anchors.goal);if(route.status!=='optimal')throw Error('Default route failed');console.log('DEM',selection.id,'valid',values.filter(v=>v!==null).length,'component',best.length,'route',route.status,route.metrics?.oneWayKm);
 await fs.writeFile(new URL(selection.id+'-dem.json',root),JSON.stringify(d));
 const ortho=Object.values(f.assets).find(a=>/RED_A_01_ORTHO.tif$/.test(a.href));
 const ot=await fromUrl(ortho.href,{allowFullFile:false,cacheSize:64});const oi=await ot.getImage();validateProjection(oi);const [irx,iry]=oi.getResolution(),[iox,ioy]=oi.getOrigin();
 const ix=Math.floor((xmin-iox)/irx),iy=Math.floor((ymax-ioy)/iry),ix1=Math.ceil((xmax-iox)/irx),iy1=Math.ceil((ymin-ioy)/iry),iw=ix1-ix,ih=iy1-iy;
 validateWindow(oi,[ix,iy,ix1,iy1]);
 const raster=await oi.readRasters({window:[ix,iy,ix1,iy1],samples:[0],interleave:true,fillValue:0});const nd=oi.getGDALNoData();
 const samp=[];for(let i=0;i<raster.length;i+=17){const v=raster[i];if(Number.isFinite(v)&&v!==nd&&v>0)samp.push(v);}samp.sort((a,b)=>a-b);const lo=samp[Math.floor(samp.length*.01)],hi=samp[Math.floor(samp.length*.99)];if(!(hi>lo))throw Error('Imagery no usable contrast');
 const pix=new Uint8Array(N*N);let missing=0;
 for(let y=0;y<N;y++)for(let x=0;x<N;x++){const sx=(xmin+(x+.5)*(xmax-xmin)/N-iox)/irx-.5-ix,sy=(ymax+(y+.5)*(ymin-ymax)/N-ioy)/iry-.5-iy;const x0=Math.max(0,Math.min(iw-2,Math.floor(sx))),y0=Math.max(0,Math.min(ih-2,Math.floor(sy))),fx=sx-x0,fy=sy-y0;const vals=[raster[y0*iw+x0],raster[y0*iw+x0+1],raster[(y0+1)*iw+x0],raster[(y0+1)*iw+x0+1]];if(vals.some(v=>v===nd||!Number.isFinite(v))){missing++;continue;}const v=(vals[0]*(1-fx)+vals[1]*fx)*(1-fy)+(vals[2]*(1-fx)+vals[3]*fx)*fy;pix[y*N+x]=Math.max(0,Math.min(255,Math.round((v-lo)/(hi-lo)*255)));}
 await fs.writeFile(new URL(selection.id+'-ortho.png',root),png(pix,N,N));
 manifest.push({id:selection.id,name:selection.name,description:selection.description,dem:'./data/'+selection.id+'-dem.json',image:'./data/'+selection.id+'-ortho.png',imageResolutionM:(xmax-xmin)/N,nativeImageResolutionM:irx,imageSourceUrl:ortho.href,imagePageUrl:doc,imageWidth:N,imageHeight:N,imageBounds:[xmin,ymin,xmax,ymax],imageProcessing:'RED-band monochrome orthoimage. Bilinear sampling to exact DEM footprint; linear 1–99 percentile contrast stretch.',imageMissingPercent:missing/(N*N)*100,sourceItemId:f.id});
 console.log('image',selection.id,'native',irx,'display',(xmax-xmin)/N,'missing',missing/(N*N)*100);
 await fs.writeFile(new URL('mission-regions.json',root),JSON.stringify(manifest,null,2));
}
