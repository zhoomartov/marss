// Reproduce the bundled native-resolution Jezero terrain subset.
// Requires Node 22+ and geotiff@3.0.5 (npm install --no-save geotiff@3.0.5).
// Existing workspace qa-geotiff installation is also supported.
import fs from 'node:fs/promises';
import {createReadStream, createWriteStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
let geotiff;
try { geotiff = await import('geotiff'); }
catch { geotiff = await import('../../qa-geotiff/node_modules/geotiff/dist-module/geotiff.js'); }

const sourceUrl='https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXDEM_20m.tif';
const pageUrl='https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic';
const cacheDir=path.join(tmpdir(),'ares-jezero-dem');
const sourcePath=path.join(cacheDir,'M20_JezeroCrater_CTXDEM_20m.tif');
const infoPath=path.join(cacheDir,'source.json');
const output=fileURLToPath(new URL('../dist/data/jezero-dem.json',import.meta.url));
await fs.mkdir(cacheDir,{recursive:true});
let source;
try { source=JSON.parse(await fs.readFile(infoPath,'utf8')); await fs.access(sourcePath); }
catch {
  const response=await fetch(sourceUrl,{signal:AbortSignal.timeout(180000)});
  if(!response.ok)throw Error(`DEM download HTTP ${response.status}`);
  const temporary=sourcePath+'.partial';
  await pipeline(Readable.fromWeb(response.body),createWriteStream(temporary));
  const length=Number(response.headers.get('content-length'));
  if(length&&(await fs.stat(temporary)).size!==length)throw Error('Incomplete DEM download');
  await fs.rename(temporary,sourcePath);
  source={url:sourceUrl,retrievedAt:new Date().toISOString(),etag:response.headers.get('etag'),lastModified:response.headers.get('last-modified'),bytes:(await fs.stat(sourcePath)).size};
  await fs.writeFile(infoPath,JSON.stringify(source,null,2));
}
const sha=createHash('sha256');for await (const chunk of createReadStream(sourcePath))sha.update(chunk);
const sourceSha256=sha.digest('hex');
const expectedSha256='ba7f706ea1b5d63a562f28a7dcf7a7f3c79bce7f048e6974b57e8a33c30d1ba2';
if(sourceSha256!==expectedSha256)throw Error('Source DEM SHA-256 changed; inspect the new product before regenerating the bundled data');
const tiff=await geotiff.fromFile(sourcePath);
try {
  const image=await tiff.getImage(),geo=image.getGeoKeys(),res=image.getResolution(),origin=image.getOrigin();
  if(geo.ProjCoordTransGeoKey!==17||geo.GeogSemiMajorAxisGeoKey!==3396190||geo.GeogSemiMinorAxisGeoKey!==3396190||geo.ProjStdParallel1GeoKey!==18.4663||geo.ProjCenterLongGeoKey!==0||geo.ProjCenterLatGeoKey!==0||geo.ProjLinearUnitsGeoKey!==9001||geo.GTRasterTypeGeoKey!==1||res[0]!==20||res[1]!==-20||image.getSamplesPerPixel()!==1)throw Error('Unexpected DEM grid / projection; review before extraction');
  const projection={name:'Jezero_Crater_Projection',type:'equirectangular',radius:3396190,standardParallel:18.4663,centralLongitude:0,centralLatitude:0,falseEasting:0,falseNorthing:0,units:'metres',latitudeType:'planetocentric',longitudeDirection:'east-positive'};
  const rad=Math.PI/180,cos=Math.cos(projection.standardParallel*rad);
  const project=(lat,lon)=>[projection.radius*lon*rad*cos,projection.radius*lat*rad];
  const unproject=(x,y)=>({lat:y/projection.radius/rad,lon:x/projection.radius/rad/cos});
  const center=project(18.4523,77.425),width=500,height=500;
  const col=Math.round((center[0]-origin[0])/res[0]-width/2),row=Math.round((origin[1]-center[1])/-res[1]-height/2);
  if(col<0||row<0||col+width>image.getWidth()||row+height>image.getHeight())throw Error('Subset outside source extent');
  const raster=await image.readRasters({window:[col,row,col+width,row+height],samples:[0],interleave:true});
  const nodata=image.getGDALNoData();
  const values=Array.from(raster,value=>Number.isFinite(value)&&value!==nodata?value:null);
  const valid=values.filter(v=>v!==null);
  if(valid.length<values.length*.95)throw Error('Insufficient DEM coverage in demo area');
  const x0=origin[0]+(col+.5)*res[0],y0=origin[1]+(row+.5)*res[1];
  const sw=unproject(x0-res[0]/2,y0+(height-.5)*res[1]);
  const ne=unproject(x0+(width-.5)*res[0],y0-res[1]/2);
  const data={version:1,id:'jezero-ctx-20m-native-subset',width,height,x0,y0,dx:res[0],dy:res[1],projection,values,
    valueUnit:'metres',layout:'row-major, north-to-south; x0/y0 are first pixel centre; null means no data',
    bounds:{west:sw.lon,south:sw.lat,east:ne.lon,north:ne.lat},
    coverage:{validCells:valid.length,totalCells:values.length,fraction:valid.length/values.length},
    provenance:{title:'Mars 2020 Science Investigation CTX DEM Mosaic',credit:'NASA/JPL-Caltech/USGS; CTX stereo DEM mosaic',sourceUrl,pageUrl,sourceSha256,...source,nativeResolutionM:20,extraction:'Exact 500×500 source-pixel window; no resampling, smoothing, interpolation, hole filling or quantisation. Original float32 values retained as JSON numbers.',sourceWindow:[col,row,col+width,row+height],sourceWidth:image.getWidth(),sourceHeight:image.getHeight(),sourceGeoKeys:geo,sourceNoData:nodata,verticalReference:'USGS describes added DEMs as vertically localised to MOLA. The GeoTIFF does not specify a vertical CRS; absolute vertical datum and uncertainty are not independently certified here.',coordinateNote:'The GeoTIFF sphere radius is 3396190 m and its standard parallel is 18.4663°. These raster keys, not generic catalogue radii or equatorial scaling, define this subset.',scienceReference:'https://doi.org/10.1126/science.abl4051',supportingDataReference:'https://data.caltech.edu/records/stqse-yay61',limitations:['20 m terrain cannot resolve individual rocks, wheel-scale hazards, soft sand, or soil bearing capacity.','DEM grid spacing is not vertical accuracy.','Geographic alignment with other map products is not independently validated.','These are measured terrain elevations, not evidence of operational rover or crew safety.']},
    anchors:{start:{lat:18.4446,lon:77.4509,name:'Perseverance landing reference / illustrative departure',source:'https://ntrs.nasa.gov/citations/20210024644',meaning:'Historical landing reference, used only as a demonstration departure; no crew base is claimed.'},goal:{lat:18.46,lon:77.40,name:'Western delta area / illustrative science target',source:'https://www.jpl.nasa.gov/news/press_kits/mars_2020/landing/mission/landing_site/',meaning:'User-adjustable illustrative target in the western delta area, not a certified way-point, shelter, or resource deposit.'}}
  };
  data.coverage.minElevationM=valid.reduce((a,b)=>Math.min(a,b),Infinity);
  data.coverage.maxElevationM=valid.reduce((a,b)=>Math.max(a,b),-Infinity);
  await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(data));
  console.log(JSON.stringify({output,width,height,bounds:data.bounds,coverage:data.coverage,sourceSha256,sourceWindow:data.provenance.sourceWindow,anchors:data.anchors},null,2));
} finally {await tiff.close();}
