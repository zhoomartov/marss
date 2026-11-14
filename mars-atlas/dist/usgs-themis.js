// USGS Mars 2015 sphere / equirectangular, central longitude 0, metres.
const METRES_PER_DEGREE=Math.PI*3396190/180;
export function tileBounds(m,row,col){return [-180+col*360/m.width,90-(row+1)*180/m.height,-180+(col+1)*360/m.width,90-row*180/m.height];}
export function intersectPixels(bounds,source,width=256,height=256){
 const dx=(bounds[2]-bounds[0])/width,dy=(bounds[3]-bounds[1])/height;
 const x0=Math.max(0,Math.ceil((source[0]-bounds[0])/dx-.5)),x1=Math.min(width,Math.ceil((source[2]-bounds[0])/dx-.5));
 const y0=Math.max(0,Math.ceil((bounds[3]-source[3])/dy-.5)),y1=Math.min(height,Math.ceil((bounds[3]-source[1])/dy-.5));
 return x1>x0&&y1>y0?{x0,x1,y0,y1,bbox:[bounds[0]+x0*dx,bounds[3]-y1*dy,bounds[0]+x1*dx,bounds[3]-y0*dy].map(v=>v*METRES_PER_DEGREE)}:null;
}
export class USGSThemis {
 constructor(){this.files=new Map();this.catalogPromise=null;}
 async catalog(){if(!this.catalogPromise)this.catalogPromise=fetch('./usgs-themis-catalog.json').then(r=>{if(!r.ok)throw Error('USGS catalog unavailable');return r.json();}).catch(e=>{this.catalogPromise=null;throw e;});return this.catalogPromise;}
 async open(url){
  if(!this.files.has(url))this.files.set(url,(async()=>{await import('./assets/geotiff.js');return globalThis.GeoTIFF.fromUrl(url,{allowFullFile:false,cacheSize:32,blockSize:65536});})().catch(e=>{this.files.delete(url);throw e;}));
  return this.files.get(url);
 }
 async tile(m,row,col){
  const bounds=tileBounds(m,row,col),pixels=new Uint8ClampedArray(m.tw*m.th*4);
  const catalog=await this.catalog();
  for(const source of catalog){
   const part=intersectPixels(bounds,source.bounds,m.tw,m.th);if(!part)continue;
   const file=await this.open(source.url),image=await file.getImage();
   const noData=image.getGDALNoData(),width=part.x1-part.x0,height=part.y1-part.y0;
   const values=await file.readRasters({bbox:part.bbox,width,height,samples:[0],interleave:true,resampleMethod:'nearest',fillValue:noData??0,signal:AbortSignal.timeout(20000)});
   for(let y=0;y<height;y++)for(let x=0;x<width;x++){const v=values[y*width+x];if(v===noData||!Number.isFinite(v))continue;const i=((y+part.y0)*m.tw+x+part.x0)*4;pixels[i]=pixels[i+1]=pixels[i+2]=v;pixels[i+3]=255;}
  }
  const canvas=document.createElement('canvas');canvas.width=m.tw;canvas.height=m.th;canvas.getContext('2d').putImageData(new ImageData(pixels,m.tw,m.th),0,0);
  return {canvas,pixels};
 }
}
export const USGS_MATRIX={source:'USGS COG',matrices:Array.from({length:10},(_,i)=>({id:String(i),width:2**(i+1),height:2**i,tw:256,th:256}))};
