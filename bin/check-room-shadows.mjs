// Conservative per-light invalidation: old and new boxes, removals, and off-light retention.
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import {BoxGeometry,DirectionalLight,Mesh,MeshStandardMaterial,Scene,SpotLight} from 'three';
const dir=mkdtempSync(join(tmpdir(),'room-shadow-unit-'));
try{
  const source=readFileSync(new URL('../src/scripts/room-shadows.ts',import.meta.url),'utf8').replace("from 'three'",`from ${JSON.stringify(import.meta.resolve('three'))}`);
  const path=join(dir,'room-shadows.mjs');writeFileSync(path,ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext}}).outputText);
  const {roomShadows}=await import(pathToFileURL(path).href);
  const scene=new Scene(),sun=new DirectionalLight(),left=new SpotLight(0xffffff,1,10,.35),right=new SpotLight(0xffffff,1,10,.35);
  sun.position.set(0,6,0);sun.target.position.set(0,0,0);Object.assign(sun.shadow.camera,{left:-10,right:10,top:10,bottom:-10,near:.1,far:20});sun.shadow.camera.updateProjectionMatrix();
  left.position.set(-3,3,0);left.target.position.set(-3,0,0);right.position.set(3,3,0);right.target.position.set(3,0,0);
  const lights=[sun,left,right];for(const light of lights){light.castShadow=true;light.shadow.map={};scene.add(light,light.target);}
  const object=new Mesh(new BoxGeometry(.2,.2,.2),new MeshStandardMaterial());object.castShadow=true;object.position.set(-3,0,0);scene.add(object);scene.updateMatrixWorld(true);
  for(const light of lights)light.shadow.updateMatrices(light);
  const tracker=roomShadows(scene,lights),clear=()=>lights.forEach(l=>tracker.rendered(l));
  tracker.observe();assert(lights.every(l=>tracker.needs(l)));clear();
  object.position.x=0;tracker.observe();assert(tracker.needs(sun)&&tracker.needs(left)&&!tracker.needs(right),'Leaving a cone must invalidate its old shadow only');clear();
  object.position.x=3;tracker.observe();assert(tracker.needs(sun)&&!tracker.needs(left)&&tracker.needs(right),'Entering a cone must invalidate its new shadow only');clear();
  left.intensity=0;object.position.x=-3;tracker.observe();assert(tracker.needs(left)&&tracker.needs(right));tracker.rendered(sun);tracker.rendered(right);assert(tracker.needs(left),'Off-light dirtiness was lost');tracker.rendered(left);
  scene.remove(object);tracker.observe();assert(tracker.needs(left)&&!tracker.needs(right),'Removing an object must invalidate its old shadow');clear();
  scene.add(object);tracker.observe();clear();
  const position=object.geometry.getAttribute('position');position.setX(0,position.getX(0)+.05);position.needsUpdate=true;
  tracker.observe();assert(tracker.needs(left)&&!tracker.needs(right),'Vertex edits must invalidate the affected light');clear();
  object.material.visible=false;tracker.observe();assert(tracker.needs(left)&&!tracker.needs(right),'Hiding a material must invalidate its old shadow');clear();
  left.position.x=-2;tracker.observe();assert(tracker.needs(left)&&!tracker.needs(right),'A moved light must invalidate its own projection');
  console.log('PASS: old/new bounds, cone selection, off-light dirtiness, removals, vertex/material changes and light movement');
}finally{rmSync(dir,{recursive:true,force:true});}
