import * as THREE from './assets/three.module.js';

const ease=t=>{t=THREE.MathUtils.clamp(t,0,1);return t*t*t*(t*(t*6-15)+10);};
export const GALAXY_SCALE=8000;

// One coordinate system: the Sun is already at the destination inside Orion.
// Only the camera moves. No cross-fade between unrelated camera paths or planet scaling.
export function createFlight(orionOffset, marsCenter){
 const start=new THREE.Vector3(-1,8,33).sub(orionOffset).multiplyScalar(GALAXY_SCALE);
 const startFocus=new THREE.Vector3(-4,1,-5).sub(orionOffset).multiplyScalar(GALAXY_SCALE);
 const solarEye=new THREE.Vector3(4,8,17);
 const finalEye=marsCenter.clone().add(new THREE.Vector3(0,.1,1.13));
 const solarCurve=new THREE.CatmullRomCurve3([solarEye,new THREE.Vector3(7,5,10),marsCenter.clone().add(new THREE.Vector3(1,1,3)),finalEye],false,'centripetal');
 const focusCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(),marsCenter.clone().multiplyScalar(.7),marsCenter.clone(),marsCenter.clone()],false,'centripetal');
 return p=>{
  if(p<=.53){
   const t=ease(p/.53);
   const direction=start.clone().normalize().lerp(solarEye.clone().normalize(),t).normalize();
   const distance=Math.exp(THREE.MathUtils.lerp(Math.log(start.length()),Math.log(solarEye.length()),t));
   return {eye:direction.multiplyScalar(distance),focus:startFocus.clone().multiplyScalar(1-ease(Math.min(1,p/.24)))};
  }
  const t=ease((p-.53)/.47);
  return {eye:solarCurve.getPoint(t),focus:focusCurve.getPoint(t)};
 };
}
