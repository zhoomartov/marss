import {terrain,planRoute} from './rover-core.js';
let grid=null;
self.onmessage=({data})=>{try{if(data.type==='init'){grid=terrain(data.dem,data.dem.routeFactor||2);self.postMessage({type:'ready',grid});}else if(data.type==='plan'){if(!grid)throw Error('Terrain is not ready');const start=performance.now(),report=planRoute(grid,data.waypoints,data.parameters,data.exclusions);self.postMessage({type:'result',id:data.id,report,elapsedMs:performance.now()-start});}}catch(e){self.postMessage({type:'error',id:data.id,message:e.message});}};
