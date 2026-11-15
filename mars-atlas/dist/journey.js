import { createMarsMoons, MOONS } from './moons.js';
import * as THREE from 'three';
import { TrekClient, LAYERS } from './wmts.js';
import { createFlight, GALAXY_SCALE } from './flight.js';
import { OrbitControls } from './assets/OrbitControls.js';

const clamp=THREE.MathUtils.clamp;
const smooth=(a,b,t)=>{const x=clamp((t-a)/(b-a),0,1);return x*x*x*(x*(x*6-15)+10);};
const R=.25;
export const mapPoint=(lat,lon)=>new THREE.Vector3(lon/180*Math.PI*R,lat/90*Math.PI*R/2,0);
export const uvCoordinate=(x,y)=>({lon:clamp(x/(Math.PI*R)*180,-180,180),lat:clamp(y/(Math.PI*R/2)*90,-90,90)});

export async function createUniverse(host, callbacks={}){
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance',alpha:false});
 renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));renderer.setClearColor(0x03060b);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
 host.append(renderer.domElement);
 const scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera(43,innerWidth/innerHeight,.015,1500);
 const controls=new OrbitControls(camera,renderer.domElement);controls.enabled=false;controls.enableDamping=true;controls.dampingFactor=.065;controls.enablePan=false;controls.rotateSpeed=.35;controls.zoomSpeed=.55;
 const textures={};let completed=0;const failed=[];
 const files={galaxy:'milkyway.jpg',mars:'8k_mars.jpg',viking:'mars.jpg',sun:'8k_sun.jpg',mercury:'2k_mercury.jpg',venus:'2k_venus_atmosphere.jpg',earth:'8k_earth_daymap.jpg',clouds:'2k_earth_clouds.jpg',moon:'2k_moon.jpg',jupiter:'8k_jupiter.jpg',saturn:'8k_saturn.jpg',rings:'8k_saturn_ring_alpha.png',uranus:'2k_uranus.jpg',neptune:'2k_neptune.jpg',sky:'2k_stars_milky_way.jpg'};
 await Promise.all(Object.entries(files).map(async([key,name])=>{try{const tex=await new THREE.TextureLoader().loadAsync('./assets/'+name);if(tex.image.width>4096&&key!=='mars'&&key!=='rings'){const resized=document.createElement('canvas');resized.width=4096;resized.height=Math.round(tex.image.height*4096/tex.image.width);resized.getContext('2d').drawImage(tex.image,0,0,resized.width,resized.height);tex.image=resized;tex.needsUpdate=true;}tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());textures[key]=tex;}catch{failed.push(key);}finally{callbacks.loading?.(++completed,Object.keys(files).length);}}));
 if(!textures.mars)textures.mars=textures.viking;if(!textures.mars||!textures.galaxy){renderer.dispose();throw Error('Essential imagery could not be loaded. Please reload to retry.');}
 const galaxy=new THREE.Group();scene.add(galaxy);galaxy.position.set(0,1,-8);galaxy.rotation.set(1.06,0,-.22);

 // Reconstruct an illustrative volume from the NASA concept: no image plane.
 const sample=document.createElement('canvas');sample.width=sample.height=512;
 const ctx=sample.getContext('2d',{willReadFrequently:true});ctx.drawImage(textures.galaxy.image,0,0,512,512);
 const pixels=ctx.getImageData(0,0,512,512).data;
 let seed=45612;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const gaussian=()=>Math.sqrt(-2*Math.log(Math.max(rand(),.00001)))*Math.cos(rand()*Math.PI*2);
 const galaxyMaterials=[];
 function volume(count,cloud){
  const positions=[],colors=[],sizes=[];
  for(let i=0;i<count;i++){
   const u=rand(),v=rand(),x=(u-.5)*38,y=(.5-v)*38,r=Math.hypot(x,y);
   if(r>18)continue;
   const k=(Math.floor(v*511)*512+Math.floor(u*511))*4;
   const lum=(pixels[k]+pixels[k+1]+pixels[k+2])/765;
   if(lum<.05||rand()>Math.pow(lum,cloud?1.25:1.4))continue;
   const bulge=Math.exp(-r*r/13),thickness=.22+bulge*1.9;
   const warp=.16*Math.sin(Math.atan2(y,x)*2)*Math.pow(r/18,2);
   positions.push(x,y,gaussian()*thickness*(cloud?1.2:1)+warp);
   const core=Math.exp(-r*r/12);colors.push(pixels[k]/255*(1+core*.28),pixels[k+1]/255*(1+core*.12),pixels[k+2]/255*(1-core*.18));
   sizes.push(cloud?.24+rand()*.38:.012+Math.pow(rand(),4)*.065);
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.setAttribute('size',new THREE.Float32BufferAttribute(sizes,1));
  const mat=new THREE.ShaderMaterial({uniforms:{fade:{value:1},viewport:{value:innerHeight*renderer.getPixelRatio()},cloud:{value:cloud?1:0},gain:{value:1},time:{value:0}},vertexShader:'attribute float size; varying vec3 c; varying float depth; varying float lengthScale; uniform float viewport;uniform float time; void main(){c=color; lengthScale=length(modelMatrix[0].xyz); vec3 drift=position;drift.z+=.015*sin(time*.3+position.x*.7+position.y*.4);vec4 p=modelViewMatrix*vec4(drift,1.); depth=-p.z; gl_Position=projectionMatrix*p; gl_PointSize=clamp(size*length(modelMatrix[0].xyz)*viewport*projectionMatrix[1][1]/max(.1,depth),1.,180.);}',fragmentShader:'uniform float fade; uniform float gain; uniform float cloud; varying vec3 c; varying float depth; varying float lengthScale; void main(){float r=length(gl_PointCoord-.5)*2.; if(r>1.)discard; float a=exp(-r*r*mix(7.,4.,cloud))*(1.-smoothstep(.7,1.,r)); a*=smoothstep(.08,.7,depth/lengthScale); gl_FragColor=vec4(c*mix(1.5,1.,cloud),a*fade*gain*mix(.35,.035,cloud));}',vertexColors:true,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending});
  galaxyMaterials.push(mat);galaxy.add(new THREE.Points(geo,mat));
 }
 volume(260000,false);volume(150000,true);
 // Warm ellipsoidal stellar bulge and a faint extended halo, with real depth.
 const coreGeo=new THREE.BufferGeometry(),corePos=[],coreCol=[],coreSize=[];
 for(let i=0;i<14000;i++){const x=gaussian()*1.4,y=gaussian()*.7,z=gaussian()*.55;corePos.push(x*.72-y*.7,x*.7+y*.72,z);coreCol.push(1,.72+rand()*.13,.42+rand()*.16);coreSize.push(.10+rand()*.24);}
 coreGeo.setAttribute('position',new THREE.Float32BufferAttribute(corePos,3));coreGeo.setAttribute('color',new THREE.Float32BufferAttribute(coreCol,3));coreGeo.setAttribute('size',new THREE.Float32BufferAttribute(coreSize,1));
 const coreMaterial=galaxyMaterials[1].clone();coreMaterial.uniforms.cloud.value=1;coreMaterial.uniforms.gain.value=.16;galaxyMaterials.push(coreMaterial);galaxy.add(new THREE.Points(coreGeo,coreMaterial));
 // Illustrative Local/Orion Spur location, away from the central bulge.
 const orionLocal=new THREE.Vector3(-3.5,-8.2,.3);
 galaxy.updateMatrixWorld(true);const orionOffset=galaxy.localToWorld(orionLocal.clone());
 const galaxyOrigin=galaxy.position.clone().sub(orionOffset).multiplyScalar(GALAXY_SCALE);galaxy.position.copy(galaxyOrigin);galaxy.scale.setScalar(GALAXY_SCALE);const orionWorld=new THREE.Vector3();
 const beacon=new THREE.Mesh(new THREE.RingGeometry(.15,.18,48),new THREE.MeshBasicMaterial({color:0xf0d2a0,transparent:true,opacity:.8,side:THREE.DoubleSide,depthWrite:false}));beacon.position.copy(orionLocal);galaxy.add(beacon);
 const starPositions=[],starColors=[];for(let i=0;i<2600;i++){const theta=rand()*Math.PI*2,z=rand()*2-1,r=45+rand()*120,s=Math.sqrt(1-z*z);starPositions.push(r*s*Math.cos(theta),r*z,r*s*Math.sin(theta));const b=.2+rand()*.65;starColors.push(b*.88,b*.94,b);}
 const skyGeo=new THREE.BufferGeometry();skyGeo.setAttribute('position',new THREE.Float32BufferAttribute(starPositions,3));skyGeo.setAttribute('color',new THREE.Float32BufferAttribute(starColors,3));const skyPoints=new THREE.Points(skyGeo,new THREE.PointsMaterial({size:.085,vertexColors:true,transparent:true,opacity:.8,sizeAttenuation:true}));scene.add(skyPoints);
 if(textures.sky){const sky=new THREE.Mesh(new THREE.SphereGeometry(450,32,24),new THREE.MeshBasicMaterial({map:textures.sky,side:THREE.BackSide,color:0x30363f,depthWrite:false}));sky.rotation.z=.8;scene.add(sky);}
 const system=new THREE.Group();scene.add(system);
 const ambient=new THREE.AmbientLight(0xb9c8dc,.22);scene.add(ambient);const sunlight=new THREE.PointLight(0xfff2dc,38,0,1);system.add(sunlight);
 const sun=new THREE.Mesh(new THREE.SphereGeometry(.68,64,48),new THREE.MeshBasicMaterial({map:textures.sun,color:0xffe4b8,toneMapped:false}));system.add(sun);
 const c=document.createElement('canvas');c.width=c.height=256;const cx=c.getContext('2d');let g=cx.createRadialGradient(128,128,10,128,128,128);g.addColorStop(0,'rgba(255,241,201,1)');g.addColorStop(.2,'rgba(255,202,118,.45)');g.addColorStop(.5,'rgba(244,142,53,.08)');g.addColorStop(1,'rgba(200,90,20,0)');cx.fillStyle=g;cx.fillRect(0,0,256,256);const glowMap=new THREE.CanvasTexture(c);const corona=new THREE.Sprite(new THREE.SpriteMaterial({map:glowMap,color:0xffc483,transparent:true,opacity:.7,depthWrite:false,blending:THREE.AdditiveBlending}));corona.scale.set(4.8,4.8,1);system.add(corona);
 const galacticGlow=new THREE.Sprite(new THREE.SpriteMaterial({map:glowMap,color:0xffd6a0,transparent:true,opacity:.55,depthWrite:false,blending:THREE.AdditiveBlending}));galacticGlow.scale.set(5,3.3,1);galaxy.add(galacticGlow);
 const orbitalMeshes=[],planetMeshes=[],cloudLayers=[];
 const bodies={sun:{object:sun,size:.68,name:'Sun'}};
 let selectedMoon=null;
 let showOrbits=true,viewMotion=null,selectedBody='overview';
 function atmosphere(planet,size,color){const material=new THREE.ShaderMaterial({uniforms:{tint:{value:new THREE.Color(color)}},side:THREE.BackSide,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,vertexShader:'varying vec3 n;varying vec3 v;void main(){vec4 p=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);v=normalize(-p.xyz);gl_Position=projectionMatrix*p;}',fragmentShader:'uniform vec3 tint;varying vec3 n;varying vec3 v;void main(){float rim=pow(1.-abs(dot(normalize(n),normalize(v))),2.6);gl_FragColor=vec4(tint,rim*.36);}'});planet.add(new THREE.Mesh(new THREE.SphereGeometry(size*1.035,64,48),material));}
 atmosphere(sun,.68,0xff8b32);
 const specs=[['mercury',1.65,.09,-.7],['venus',2.6,.155,2.7],['earth',3.65,.17,-2.15],['mars',5,.25,.45],['jupiter',7.3,.56,1.9],['saturn',9.7,.48,-1.05],['uranus',12.1,.34,-2.55],['neptune',14.5,.32,-1.75]];
 const marsCenter=new THREE.Vector3();
 const tilts={earth:.41,saturn:.47,uranus:1.71,neptune:.49};
 for(const [name,orbit,size,angle]of specs){const pts=[];for(let j=0;j<=256;j++){const a=j/256*Math.PI*2;pts.push(new THREE.Vector3(Math.cos(a)*orbit,0,Math.sin(a)*orbit));}const ring=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:name==='mars'?0xab9472:0x63758c,transparent:true,opacity:name==='mars'?.3:.13}));system.add(ring);orbitalMeshes.push(ring);const pos=new THREE.Vector3(Math.cos(angle)*orbit,0,Math.sin(angle)*orbit);if(name==='mars'){marsCenter.copy(pos);continue;}const mat=new THREE.MeshStandardMaterial({map:textures[name],roughness:name==='earth'?.62:(name==='uranus'||name==='neptune')?.85:1,color:0xffffff});const planet=new THREE.Mesh(new THREE.SphereGeometry(size,96,64),mat);planet.position.copy(pos);planet.rotation.z=tilts[name]??.08;system.add(planet);planetMeshes.push(planet);bodies[name]={object:planet,size,name:name[0].toUpperCase()+name.slice(1)};if(name==='earth')atmosphere(planet,size,0x4d9fff);if(name==='venus')atmosphere(planet,size,0xe8bd82);if(name==='uranus')atmosphere(planet,size,0x8be4f5);if(name==='neptune')atmosphere(planet,size,0x4b7dff);if(name==='earth'&&textures.clouds){const clouds=new THREE.Mesh(new THREE.SphereGeometry(size*1.012,48,32),new THREE.MeshStandardMaterial({map:textures.clouds,alphaMap:textures.clouds,transparent:true,opacity:.7,depthWrite:false}));planet.add(clouds);cloudLayers.push(clouds);}if(name==='saturn'){const rings=new THREE.Mesh(new THREE.RingGeometry(size*1.25,size*2.05,128),new THREE.ShaderMaterial({uniforms:{map:{value:textures.rings}},side:THREE.DoubleSide,transparent:true,depthWrite:false,vertexShader:'varying vec3 p;void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'uniform sampler2D map;varying vec3 p;void main(){float r=clamp((length(p.xy)-.6)/.384,0.,1.);vec4 c=texture2D(map,vec2(r,.5));gl_FragColor=vec4(c.rgb*.85,c.a*.9);\n#include <colorspace_fragment>\n}'}));rings.rotation.x=1.2;planet.add(rings);}if(name==='uranus'){const uRing=new THREE.Mesh(new THREE.RingGeometry(size*1.42,size*1.82,96),new THREE.ShaderMaterial({side:THREE.DoubleSide,transparent:true,depthWrite:false,uniforms:{inner:{value:size*1.42},outer:{value:size*1.82}},vertexShader:'varying vec3 p;void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'uniform float inner;uniform float outer;varying vec3 p;void main(){float t=clamp((length(p.xy)-inner)/(outer-inner),0.,1.);float band=.55+.45*sin(t*25.);float alpha=sin(t*3.14159265)*band*.28;gl_FragColor=vec4(.68,.88,.95,alpha);\n#include <colorspace_fragment>\n}'}));uRing.rotation.x=Math.PI/2;planet.add(uRing);}}
 const earthMoonGroup=new THREE.Group();earthMoonGroup.position.copy(bodies.earth.object.position);earthMoonGroup.rotation.z=.09;system.add(earthMoonGroup);
 const moonOrbitRadius=.52,moonSize=.047,moonOrbitPts=[];for(let j=0;j<=128;j++){const a=j/128*Math.PI*2;moonOrbitPts.push(new THREE.Vector3(Math.cos(a)*moonOrbitRadius,0,Math.sin(a)*moonOrbitRadius));}
 const earthMoonOrbit=new THREE.Line(new THREE.BufferGeometry().setFromPoints(moonOrbitPts),new THREE.LineBasicMaterial({color:0x8fa4bc,transparent:true,opacity:.24}));earthMoonGroup.add(earthMoonOrbit);orbitalMeshes.push(earthMoonOrbit);
 const moonMesh=new THREE.Mesh(new THREE.SphereGeometry(moonSize,64,48),new THREE.MeshStandardMaterial({map:textures.moon,roughness:.95,metalness:0,color:0xc8c9cd}));
 let moonAngle=2.2;const syncEarthMoon=()=>{moonMesh.position.set(Math.cos(moonAngle)*moonOrbitRadius,0,Math.sin(moonAngle)*moonOrbitRadius);moonMesh.rotation.y=-moonAngle+Math.PI;};syncEarthMoon();earthMoonGroup.add(moonMesh);bodies.moon={object:moonMesh,size:moonSize,name:'Moon'};
 const moons=await createMarsMoons(system,marsCenter,Math.min(8,renderer.capabilities.getMaxAnisotropy()));
 // The same UV-parametrized mesh remains on screen from orbit to flat atlas.
 const marsRoot=new THREE.Group();marsRoot.position.copy(marsCenter);system.add(marsRoot);
 const surfaceGeo=new THREE.PlaneGeometry(1,1,192,96);
 const emptyTexture=new THREE.Texture();
 const uniforms={scienceLayer:{value:0},detail:{value:emptyTexture},detailBounds:{value:new THREE.Vector4(0,0,1,1)},hasDetail:{value:0},map:{value:textures.mars},unfold:{value:0},rotation:{value:0},grid:{value:0},radius:{value:R},light:{value:new THREE.Vector3(-1,.25,.65).normalize()}};
 const surfaceMaterial=new THREE.ShaderMaterial({uniforms,side:THREE.DoubleSide,vertexShader:`uniform float unfold;uniform float rotation;uniform float radius;varying vec2 vUv;varying vec3 vNormal;void main(){vUv=uv;float lon=(uv.x-.5)*6.2831853+rotation*(1.-unfold);float lat=(uv.y-.5)*3.14159265;vec3 n=vec3(sin(lon)*cos(lat),sin(lat),cos(lon)*cos(lat));vec3 s=n*radius;vec3 planarPosition=vec3((uv.x-.5)*6.2831853*radius,(uv.y-.5)*3.14159265*radius,0.);vec3 p=mix(s,planarPosition,unfold);vNormal=normalize(mix(n,vec3(0.,0.,1.),unfold));gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,fragmentShader:`uniform sampler2D map;uniform float scienceLayer;uniform sampler2D detail;uniform vec4 detailBounds;uniform float hasDetail;uniform float unfold;uniform float grid;uniform vec3 light;varying vec2 vUv;varying vec3 vNormal;void main(){float hatch=step(.5,fract((gl_FragCoord.x+gl_FragCoord.y)/12.));vec3 backdrop=mix(vec3(.018,.024,.032),vec3(.035,.044,.055),hatch);vec4 globalPixel=texture2D(map,vUv);vec3 c=globalPixel.rgb+backdrop*(1.-globalPixel.a);vec2 duv=(vUv-detailBounds.xy)/detailBounds.zw;if(hasDetail>.5&&all(greaterThanEqual(duv,vec2(0.)))&&all(lessThanEqual(duv,vec2(1.)))){vec4 d=texture2D(detail,duv);c=d.rgb+backdrop*(1.-d.a);}float diffuse=max(0.,dot(normalize(vNormal),light));float shade=mix(.10+.90*pow(diffuse,.7),1.,unfold);if(scienceLayer<.5)c=mix(vec3(dot(c,vec3(.2126,.7152,.0722))),c,.76);c*=shade;vec2 cell=abs(fract(vUv*vec2(12.,6.)-.5)-.5)/max(fwidth(vUv*vec2(12.,6.)),vec2(.0001));float line=1.-min(min(cell.x,cell.y),1.);c=mix(c,vec3(.7,.76,.8),line*.28*grid*unfold);gl_FragColor=vec4(c,1.);\n#include <colorspace_fragment>\n}`});
 const mars=new THREE.Mesh(surfaceGeo,surfaceMaterial);mars.frustumCulled=false;marsRoot.add(mars);bodies.mars={object:marsRoot,size:R,name:'Mars'};
 const halo=new THREE.Mesh(new THREE.SphereGeometry(R*1.025,64,48),new THREE.ShaderMaterial({uniforms:{opacity:{value:.24}},side:THREE.BackSide,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,vertexShader:'varying vec3 n;varying vec3 v;void main(){vec4 p=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);v=normalize(-p.xyz);gl_Position=projectionMatrix*p;}',fragmentShader:'varying vec3 n;varying vec3 v;uniform float opacity;void main(){float f=pow(1.-abs(dot(normalize(n),normalize(v))),3.);gl_FragColor=vec4(.72,.36,.17,f*opacity);}'}));marsRoot.add(halo);
 const marker=new THREE.Mesh(new THREE.RingGeometry(.008,.012,32),new THREE.MeshBasicMaterial({color:0xf7dfad,side:THREE.DoubleSide,depthTest:false}));marker.visible=false;marker.renderOrder=10;marsRoot.add(marker);
 let renderAt=0,interactionUntil=0,dirtyUntil=0;
 const trek=new TrekClient();let layerKey='visual',layerEpoch=0,viewEpoch=0,detailTimer,baseTexture,detailTexture;
 const routeGroup=new THREE.Group();marsRoot.add(routeGroup);
 function updateRoute(points=[]){for(const child of [...routeGroup.children]){child.geometry.dispose();child.material.dispose();routeGroup.remove(child);}let segment=[];const flush=()=>{if(segment.length>1){const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(segment),new THREE.LineBasicMaterial({color:0xe9bd75,depthTest:false}));line.renderOrder=12;routeGroup.add(line);}segment=[];};for(let i=0;i<points.length;i++){if(i&&Math.abs(points[i].lon-points[i-1].lon)>180)flush();const p=mapPoint(points[i].lat,points[i].lon);p.z=0;segment.push(p);}flush();dirtyUntil=performance.now()+600;}
 async function setLayer(key){
  if(key!=='visual'&&key!=='nasa'&&!LAYERS[key])return;layerKey=key;uniforms.scienceLayer.value=LAYERS[key]?1:0;const epoch=++layerEpoch;++viewEpoch;clearTimeout(detailTimer);uniforms.hasDetail.value=0;
  if(key==='visual'||key==='nasa'){uniforms.map.value=key==='visual'?textures.mars:(textures.viking||textures.mars);baseTexture?.dispose();baseTexture=null;detailTexture?.dispose();detailTexture=null;uniforms.detail.value=emptyTexture;dirtyUntil=performance.now()+600;callbacks.tiles?.({status:'local',key});scheduleDetail();return;}
  // Neutral background distinguishes unavailable imagery from actual NASA pixels.
  const blank=document.createElement('canvas');blank.width=2;blank.height=1;const bc=blank.getContext('2d');bc.fillStyle='#17202a';bc.fillRect(0,0,2,1);
  baseTexture?.dispose();baseTexture=new THREE.CanvasTexture(blank);uniforms.map.value=baseTexture;dirtyUntil=performance.now()+600;callbacks.tiles?.({status:'loading',key});
  try{const result=await trek.mosaic(key,undefined,1024,()=>epoch===layerEpoch);if(epoch!==layerEpoch||!result)return;
   baseTexture.dispose();baseTexture=new THREE.CanvasTexture(result.canvas);baseTexture.colorSpace=THREE.SRGBColorSpace;baseTexture.premultiplyAlpha=true;uniforms.map.value=baseTexture;dirtyUntil=performance.now()+600;
   callbacks.tiles?.({status:result.loaded===result.total?'ready':'partial',key,...result});scheduleDetail();
  }catch(e){if(epoch===layerEpoch)callbacks.tiles?.({status:'error',key,message:e.message});}
 }
 function scheduleDetail(){if(mapMode){const halfH=Math.tan(camera.fov*Math.PI/360)*Math.abs(camera.position.z-marsCenter.z),latitude=clamp((controls.target.y-marsCenter.y)/(Math.PI*R/2)*90,-90,90);callbacks.scale?.({metresPerPixel:2*halfH/(Math.PI*R)*Math.PI*3389500/host.clientHeight,latitude});}clearTimeout(detailTimer);const view=++viewEpoch;if(!mapMode||morphMotion||(!LAYERS[layerKey]&&layerKey!=='visual'&&layerKey!=='nasa')){if(!mapMode&&(layerKey==='visual'||layerKey==='nasa'))uniforms.hasDetail.value=0;return;}detailTimer=setTimeout(async()=>{
  const distance=Math.abs(camera.position.z-marsCenter.z),halfH=Math.tan(camera.fov*Math.PI/360)*distance,halfW=halfH*camera.aspect;
  const cx=controls.target.x-marsCenter.x,cy=controls.target.y-marsCenter.y;
  const bounds=[clamp((cx-halfW)/(Math.PI*R)*180,-180,180),clamp((cy-halfH)/(Math.PI*R/2)*90,-90,90),clamp((cx+halfW)/(Math.PI*R)*180,-180,180),clamp((cy+halfH)/(Math.PI*R/2)*90,-90,90)];
  if(bounds[0]>=bounds[2]||bounds[1]>=bounds[3])return;
  const overview=layerKey==='visual'||layerKey==='nasa',sourceKey=overview?'ctx':layerKey;
  if(overview){const image=uniforms.map.value.image,sourcePixels=image.width*(2*halfW/(Math.PI*R)*180)/360;
   if(sourcePixels>=host.clientWidth*renderer.getPixelRatio()/1.25){uniforms.hasDetail.value=0;uniforms.scienceLayer.value=0;dirtyUntil=performance.now()+600;callbacks.tiles?.({status:'local',key:layerKey});return;}}
  const epoch=layerEpoch;callbacks.tiles?.({status:'detail-loading',key:sourceKey,baseKey:overview?layerKey:null});const screenFraction=(bounds[2]-bounds[0])/(2*halfW/(Math.PI*R)*180);
  const current=()=>epoch===layerEpoch&&view===viewEpoch;let displayedCanvas=null;
  const display=(result,complete=false)=>{if(!result||!current())return;
   if(displayedCanvas!==result.canvas){detailTexture?.dispose();detailTexture=new THREE.CanvasTexture(result.canvas);detailTexture.colorSpace=THREE.SRGBColorSpace;detailTexture.premultiplyAlpha=true;detailTexture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());uniforms.detail.value=detailTexture;uniforms.detailBounds.value.fromArray(result.bounds);displayedCanvas=result.canvas;}else detailTexture.needsUpdate=true;
   uniforms.hasDetail.value=1;uniforms.scienceLayer.value=1;dirtyUntil=performance.now()+600;
   callbacks.tiles?.({status:complete?(result.loaded===result.total?'ready':'partial'):'streaming',key:sourceKey,baseKey:overview?layerKey:null,...result});
  };
  try{const result=await trek.mosaic(sourceKey,bounds,Math.max(1,host.clientWidth*renderer.getPixelRatio()*screenFraction),current,{maxTextureSize:Math.min(4096,renderer.capabilities.maxTextureSize),onProgress:display});display(result,true);}catch(e){if(current())callbacks.tiles?.({status:'error',key:sourceKey,baseKey:overview?layerKey:null,message:e.message});}
 },140);}
 controls.addEventListener('change',scheduleDetail);

 let progress=0,transition=null,flightPaused=false,ready=false,mode='galaxy',mapMode=false,morph=0,morphMotion=null,rotation=0,spin=!reduced.matches,last=performance.now(),clock=0,frameCount=0,frameTotal=0;
 let selected=null;const pointer=new THREE.Vector2(),ray=new THREE.Raycaster(),plane=new THREE.Plane(new THREE.Vector3(0,0,1),-marsCenter.z),hit=new THREE.Vector3();
 const sampleFlight=createFlight(orionOffset,marsCenter);
 function notify(){callbacks.state?.({mode,progress,mapMode,travelling:!!transition,paused:flightPaused,ready,spin,selectedBody,selectedMoon});}

 // Off-axis projection keeps the composition without moving the orbit pivot.
 let compositionAmount=0;
 function composition(amount){compositionAmount=amount;const w=host.clientWidth,h=host.clientHeight;if(amount<.0001)camera.clearViewOffset();else camera.setViewOffset(w,h,innerWidth<650?0:-w*.12*amount,innerWidth<650?(selectedMoon?h*.08:-h*.12)*amount:0,w,h);}
 function setView(p){
  progress=p;galaxy.visible=p<.58;
  for(const m of galaxyMaterials)m.uniforms.fade.value=1-smooth(.40,.58,p);
  galacticGlow.material.opacity=.55*(1-smooth(.30,.48,p));
  beacon.material.opacity=.8*(1-smooth(.10,.22,p));
  system.scale.setScalar(1);
  const {eye,focus}=sampleFlight(p);
  if(innerWidth<650)eye.sub(focus).multiplyScalar(1.4).add(focus);
  camera.near=Math.max(.015,eye.length()*.00001);camera.far=Math.max(1500,eye.length()*12);camera.updateProjectionMatrix();
  camera.position.copy(eye);camera.lookAt(focus);controls.target.copy(focus);composition(smooth(.8,1,p));
  const next=p<.35?'galaxy':p<.82?'solar':'mars';if(next!==mode){mode=next;notify();}
  for(const r of orbitalMeshes)r.material.opacity=(r===orbitalMeshes[3]?.3:r===earthMoonOrbit?.24:.13)*(1-smooth(.82,.98,p));
  for(const m of planetMeshes)m.visible=p<.96;earthMoonGroup.visible=p<.96;sun.visible=corona.visible=p<.96;
 }
 function mapCamera(){const mobile=innerWidth<650;const w=innerWidth-(mobile?30:340);const h=innerHeight-(mobile?440:240);const distance=Math.max(Math.PI*R/(Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*(w/innerHeight)),Math.PI*R/2/(Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*(h/innerHeight)))*1.12;const target=marsCenter.clone().add(new THREE.Vector3(mobile?0:.23,mobile?-.25:.02,0));return {position:target.clone().add(new THREE.Vector3(0,0,distance)),target};}
 function configureStop(){
  controls.enabled=true;controls.enableRotate=true;controls.enablePan=false;controls.autoRotate=false;controls.mouseButtons.LEFT=THREE.MOUSE.ROTATE;
  controls.minPolarAngle=.08;controls.maxPolarAngle=Math.PI-.08;
  if(progress===0){controls.target.copy(galaxy.position);controls.minDistance=85000;controls.maxDistance=800000;}
  else if(progress===.53){controls.target.set(0,0,0);controls.minDistance=4;controls.maxDistance=65;}
  else {controls.target.copy(marsCenter);controls.minDistance=.48;controls.maxDistance=3;}
  camera.lookAt(controls.target);controls.update();
 }
 function inspectBody(name){if(transition||mode!=='solar')return;clearInertia();selectedBody=name;controls.enabled=false;
  const body=bodies[name];if(body)body.object.updateWorldMatrix(true,false);
  const target=body?body.object.getWorldPosition(new THREE.Vector3()):new THREE.Vector3();
  const mult=name==='saturn'?2.7:name==='uranus'?2.2:name==='moon'?3.3:name==='earth'?3.6:1.8;
  const direction=name==='earth'?new THREE.Vector3(.55,1.35,2.45):new THREE.Vector3(.7,.35,2.6);
  const position=body?target.clone().add(direction.multiplyScalar(body.size*mult)):sampleFlight(.53).eye;
  if(innerWidth<650&&body)position.sub(target).multiplyScalar(1.4).add(target);
  viewMotion={fromFraming:compositionAmount,from:camera.position.clone(),fromTarget:controls.target.clone(),position,target,start:clock,duration:reduced.matches?0:1.6,min:body?body.size*1.7:4,max:body?body.size*22:65,framing:body?1:0};notify();
 }
 function inspectMoon(name){
  if(transition||morphMotion||mapMode||mode!=='mars'||(name!==null&&!MOONS[name]))return;
  clearInertia();selectedMoon=name;controls.enabled=false;
  moons.root.updateMatrixWorld(true);
  const target=name?moons.bodies[name].getWorldPosition(new THREE.Vector3()):marsCenter.clone();
  const radius=name?MOONS[name].radius:R;
  // View the lit hemisphere with a little limb shadow; keep the moon framed.
  const offset=name?new THREE.Vector3(-1,.35,1.7).normalize().multiplyScalar(radius*5.5):sampleFlight(1).eye.sub(marsCenter);
  if(innerWidth<650)offset.multiplyScalar(name?1.65:1.4);
  camera.near=name?.0005:.015;camera.updateProjectionMatrix();
  viewMotion={fromFraming:compositionAmount,from:camera.position.clone(),fromTarget:controls.target.clone(),position:target.clone().add(offset),target,start:clock,duration:reduced.matches?0:1.5,min:name?radius*2:.48,max:name?radius*20:3,framing:1};notify();
 }
 function galaxyView(top=false){if(transition||mode!=='galaxy')return;clearInertia();controls.enabled=false;const target=galaxy.position.clone();const direction=top?new THREE.Vector3(0,0,1).applyQuaternion(galaxy.quaternion):new THREE.Vector3(-.03,.2,1).normalize();viewMotion={fromFraming:compositionAmount,from:camera.position.clone(),fromTarget:controls.target.clone(),position:target.clone().addScaledVector(direction,360000),target,start:clock,duration:reduced.matches?0:1.8,min:85000,max:800000,framing:0};}
 function clearInertia(){controls.enableDamping=false;controls.update();controls.enableDamping=true;}
 function travel(to,duration=13){if(!ready)return;clearInertia();selectedMoon=null;viewMotion=null;selectedBody='overview';pendingMap=false;mapMode=false;morphMotion=null;morph=0;uniforms.unfold.value=0;halo.visible=true;marker.visible=false;routeGroup.visible=false;controls.enabled=false;controls.enableRotate=true;controls.mouseButtons.LEFT=THREE.MOUSE.ROTATE;flightPaused=false;transition={from:progress,to,start:clock,duration:reduced.matches?0:duration,eye:camera.position.clone(),focus:controls.target.clone(),framing:compositionAmount};notify();}
 function finishAtMars(){travel(1,1.6);}
 function unfold(value=true){if(!ready)return;if(progress<.999){travel(1,1.6);pendingMap=value;return;}if(transition)return;clearInertia();selectedMoon=null;viewMotion=null;mapMode=value;controls.autoRotate=false;controls.enabled=false;const end=value?mapCamera():{position:sampleFlight(1).eye,target:sampleFlight(1).focus};if(!value&&innerWidth<650){end.position.sub(end.target).multiplyScalar(1.4).add(end.target);}morphMotion={from:morph,to:value?1:0,start:clock,duration:reduced.matches?0:2.4,position:camera.position.clone(),target:controls.target.clone(),end};notify();}
 let pendingMap=false;
 function select(lat,lon,name='Selected location',focus=false){selected={lat,lon,name};marker.position.copy(mapPoint(lat,lon));marker.position.z=0;marker.visible=mapMode;callbacks.select?.(selected);if(focus&&mapMode&&!morphMotion){const offset=mapPoint(lat,lon);const target=marsCenter.clone().add(offset);target.z=marsCenter.z;const distance=Math.max(.4,camera.position.distanceTo(controls.target)*.65);camera.position.copy(target).add(new THREE.Vector3(0,0,distance));controls.target.copy(target);controls.update();}}
 // Rotation preference persists across orbit interaction and atlas visits.
 let down=null;host.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY};});host.addEventListener('pointerup',e=>{if(!down||Math.hypot(e.clientX-down.x,e.clientY-down.y)>5)return;down=null;if(!mapMode||morph<.999)return;const box=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-box.left)/box.width*2-1,-(e.clientY-box.top)/box.height*2+1);ray.setFromCamera(pointer,camera);if(ray.ray.intersectPlane(plane,hit)){hit.sub(marsCenter);if(Math.abs(hit.x)<=Math.PI*R&&Math.abs(hit.y)<=Math.PI*R/2){const {lat,lon}=uvCoordinate(hit.x,hit.y);select(lat,lon);}}});
 const resize=()=>{dirtyUntil=performance.now()+600;renderer.setSize(host.clientWidth,host.clientHeight);camera.aspect=host.clientWidth/host.clientHeight;camera.updateProjectionMatrix();for(const m of galaxyMaterials)m.uniforms.viewport.value=host.clientHeight*renderer.getPixelRatio();composition(progress===1?1-morph:mode==='solar'&&selectedBody!=='overview'?1:smooth(.8,1,progress));if(mapMode&&!morphMotion){const v=mapCamera();camera.position.copy(v.position);controls.target.copy(v.target);controls.update();}else if(selectedMoon)inspectMoon(selectedMoon);else if(!controls.enabled)setView(progress);};new ResizeObserver(resize).observe(host);resize();setView(0);
 // Upload images and compile both stages before the visitor starts moving.
 system.scale.setScalar(1);galaxy.visible=true;await renderer.compileAsync(scene,camera);for(const tex of Object.values(textures))renderer.initTexture(tex);setView(0);renderer.render(scene,camera);ready=true;configureStop();notify();callbacks.ready?.(failed);
 function tick(now){
 if(document.hidden){last=now;return;}
 const interactive=!!transition||!!morphMotion||!!viewMotion||now<interactionUntil;
 const animate=!reduced.matches&&(!mapMode)&&(mode!=='mars'||spin);
 if(!interactive&&!animate&&now>dirtyUntil){last=now;return;}
 const interval=interactive?1000/60:1000/30;
 if(now-renderAt<interval-.5)return;
 renderAt=now;
 const dt=Math.min((now-last)/1000,.05);last=now;if(document.hidden)return;clock+=dt;frameCount++;frameTotal+=dt;if(frameCount===150&&frameTotal/150>.03&&renderer.getPixelRatio()>1){renderer.setPixelRatio(1);resize();}if(transition&&!flightPaused){const t=transition.duration?clamp((clock-transition.start)/transition.duration,0,1):1;const eased=smooth(0,1,t);setView(THREE.MathUtils.lerp(transition.from,transition.to,eased));const join=smooth(0,.22,t);composition(THREE.MathUtils.lerp(transition.framing,compositionAmount,join));camera.position.lerpVectors(transition.eye,camera.position.clone(),join);controls.target.lerpVectors(transition.focus,controls.target.clone(),join);camera.lookAt(controls.target);callbacks.progress?.(progress);if(t===1){transition=null;configureStop();if(progress===1){controls.enabled=true;controls.target.copy(marsCenter);controls.minDistance=.48;controls.maxDistance=3;controls.enablePan=false;controls.autoRotate=false;mode='mars';}notify();if(pendingMap){pendingMap=false;unfold(true);}}}else if(transition&&flightPaused){transition.start+=dt;}
 if(morphMotion){const t=morphMotion.duration?clamp((clock-morphMotion.start)/morphMotion.duration,0,1):1,p=smooth(0,1,t);morph=THREE.MathUtils.lerp(morphMotion.from,morphMotion.to,p);uniforms.unfold.value=morph;composition(1-morph);camera.position.lerpVectors(morphMotion.position,morphMotion.end.position,p);controls.target.lerpVectors(morphMotion.target,morphMotion.end.target,p);camera.lookAt(controls.target);halo.material.uniforms.opacity.value=.24*(1-morph);marker.visible=!!selected&&morph>.99;routeGroup.visible=morph>.99;if(t===1){morphMotion=null;controls.enabled=true;controls.enableRotate=!mapMode;controls.enablePan=mapMode;controls.screenSpacePanning=true;controls.mouseButtons.LEFT=mapMode?THREE.MOUSE.PAN:THREE.MOUSE.ROTATE;controls.minDistance=mapMode?.00008:.48;camera.near=mapMode?.000001:.015;camera.updateProjectionMatrix();controls.maxDistance=mapMode?5:3;notify();scheduleDetail();}}
 if(viewMotion){const t=viewMotion.duration?clamp((clock-viewMotion.start)/viewMotion.duration,0,1):1,p=smooth(0,1,t);camera.position.lerpVectors(viewMotion.from,viewMotion.position,p);controls.target.lerpVectors(viewMotion.fromTarget,viewMotion.target,p);camera.lookAt(controls.target);composition(THREE.MathUtils.lerp(viewMotion.fromFraming,viewMotion.framing,p));if(t===1){controls.minDistance=viewMotion.min;controls.maxDistance=viewMotion.max;controls.enabled=true;viewMotion=null;}}
 if(controls.enabled){controls.update();if(mapMode){controls.target.x=clamp(controls.target.x,marsCenter.x-1,marsCenter.x+1);controls.target.y=clamp(controls.target.y,-.8,.8);}}if(!mapMode&&spin&&!transition&&progress===1){rotation+=dt*.032;uniforms.rotation.value=rotation;}if(progress<1){camera.near=Math.max(.015,camera.position.distanceTo(controls.target)*.00001);camera.far=Math.max(1500,camera.position.length()*12);camera.updateProjectionMatrix();}for(const r of orbitalMeshes)r.visible=showOrbits;const ambientDt=!reduced.matches&&mode==='solar'?dt:0;
 for(const cloud of cloudLayers)cloud.rotation.y+=ambientDt*.045;
 moons.update(!reduced.matches&&!mapMode&&!transition&&!viewMotion&&!selectedMoon&&(mode==='solar'||spin)?dt:0,!mapMode&&morph===0,showOrbits&&!selectedMoon);
 sun.rotation.y+=ambientDt*.03;for(const m of planetMeshes)m.rotation.y+=ambientDt*.075;if(ambientDt&&selectedBody!=='moon'){moonAngle+=ambientDt*.22;syncEarthMoon();}
 if(galaxy.visible&&!reduced.matches)for(const material of galaxyMaterials)material.uniforms.time.value=clock;
 if(mode==='solar'&&!reduced.matches)corona.material.opacity=.7+.025*Math.sin(clock*.7);
 if(galaxy.visible){const anchor=orionWorld.clone().project(camera);callbacks.orion?.({x:(anchor.x*.5+.5)*host.clientWidth,y:(.5-anchor.y*.5)*host.clientHeight});}
 if(marker.visible){const unitsPerPixel=2*Math.tan(camera.fov*Math.PI/360)*Math.abs(camera.position.z-marsCenter.z)/host.clientHeight;marker.scale.setScalar(10*unitsPerPixel/.012);}
 renderer.render(scene,camera);}
 // Input wakeups keep static maps and paused/reduced-motion views idle.
 const wake=()=>{dirtyUntil=performance.now()+700;};
 const active=()=>{interactionUntil=performance.now()+450;wake();};
 controls.addEventListener('start',active);controls.addEventListener('change',active);controls.addEventListener('end',active);
 document.addEventListener('click',wake);document.addEventListener('change',wake);document.addEventListener('keydown',wake);
 host.addEventListener('pointermove',e=>{if(e.buttons)active();});host.addEventListener('wheel',active,{passive:true});
 document.addEventListener('visibilitychange',()=>{last=performance.now();if(document.hidden)renderer.setAnimationLoop(null);else{wake();renderer.setAnimationLoop(tick);}});
 wake();renderer.setAnimationLoop(tick);setLayer('visual');
 renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();callbacks.error?.('Graphics context lost. Reload the page to restore the scene.');});
 return {setEnvironmentMap(canvas){layerKey='climate';++layerEpoch;++viewEpoch;clearTimeout(detailTimer);uniforms.hasDetail.value=0;uniforms.scienceLayer.value=1;baseTexture?.dispose();baseTexture=new THREE.CanvasTexture(canvas);baseTexture.colorSpace=THREE.SRGBColorSpace;baseTexture.magFilter=THREE.NearestFilter;uniforms.map.value=baseTexture;dirtyUntil=performance.now()+700;},travel,unfold,inspectBody,inspectMoon,galaxyView,setOrbits(value){showOrbits=value;},skip:finishAtMars,select, pause(){flightPaused=!flightPaused;notify();},spin(){spin=!spin;notify();},zoom(factor){if(!controls.enabled)return;const offset=camera.position.clone().sub(controls.target);offset.setLength(clamp(offset.length()*factor,controls.minDistance,controls.maxDistance));camera.position.copy(controls.target).add(offset);controls.update();},reset(){clearInertia();if(mode==='galaxy'){galaxyView(false);return;}if(mode==='solar'){inspectBody('overview');return;}if(mapMode){const v=mapCamera();camera.position.copy(v.position);controls.target.copy(v.target);controls.update();}else{rotation=0;uniforms.rotation.value=0;inspectMoon(null);}},setGrid(value){uniforms.grid.value=value?1:0;},setLayer,trek,updateRoute,get state(){return {mode,progress,mapMode,ready,travelling:!!transition};}};
}
