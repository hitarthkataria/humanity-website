import * as THREE from 'three';
import { createArtScene } from './engine/art-scene.js';
import { createCoinScene } from './scenes/coins.js';
import { createCompositor } from './engine/compositor.js';
import { disposeObject } from './engine/resources.js';

const slug = document.documentElement.dataset.animation;
const status = document.querySelector('[role="status"]');
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
const state = {pointer:{x:0,y:0},progress:0,reducedMotion:reduce.matches};
let renderer, scene, content, compositor, frameId, lastFrame, time=0, playing=!reduce.matches;
let disposed=false, ready=false, renderCount=0, generation=0, variantKey, variantSceneUrl;
const targetPointer={x:0,y:0};
let registry,loadAbort;

async function readJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load scene (${response.status}): ${url}`);
  return response.json();
}
function device() { return innerWidth < 768 ? 'mobile' : innerWidth < 1024 ? 'tablet' : 'desktop'; }
function render(delta=0) {
  if (!ready || disposed || document.hidden) return;
  const smooth = 1-Math.exp(-Math.max(delta,1/60)*8);
  state.pointer.x += (targetPointer.x-state.pointer.x)*smooth;
  state.pointer.y += (targetPointer.y-state.pointer.y)*smooth;
  content.update?.(time,delta,state);
  compositor.render(time);
  renderCount++;
}
function tick(now) {
  if (disposed) return;
  const delta = lastFrame === undefined ? 0 : Math.min((now-lastFrame)/1000,.1);
  lastFrame=now;
  if (playing && !state.reducedMotion && !document.hidden && ready) { time+=delta;render(delta); }
  frameId=requestAnimationFrame(tick);
}
function clearScene() {
  content?.dispose?.(); compositor?.dispose();
  if (scene) { disposeObject(scene); scene.clear(); }
  content=null; compositor=null;
}
async function load() {
  const token=++generation;
  loadAbort?.abort();
  loadAbort=new AbortController();
  ready=false;
  clearScene();
  const nextScene=new THREE.Scene();
  let nextContent;
  let camera=new THREE.PerspectiveCamera(35,innerWidth/innerHeight,.1,2000);
  const record=registry.scenes[slug];
  if (record) {
    const variant=record.variants[device()] ?? record.variants.desktop;
    variantKey=JSON.stringify(variant);
    variantSceneUrl=variant.sceneUrl;
    const config=await readJSON(variant.sceneUrl);
    if (disposed || token!==generation) return;
    nextContent=await createArtScene({config,cameraId:variant.cameraId,renderer,scene:nextScene,signal:loadAbort.signal});
  } else {
    const info=await readJSON('/scenes.json');
    const metadata=info.find(item=>item.slug===slug);
    if (!metadata || metadata.type!=='spline') throw new Error(`Unknown animation: ${slug}`);
    nextContent=await createCoinScene({...metadata,renderer,scene:nextScene,camera,assets:'/assets/coins/'});
  }
  if (disposed || token!==generation) {nextContent?.dispose?.();disposeObject(nextScene);return;}
  content=nextContent;scene=nextScene;
  camera=content.camera ?? camera;
  compositor=createCompositor(renderer,scene,camera,content.config?.effects);
  ready=true;
  resizeCanvas();
  content.resources?.setPlaying(playing && !reduce.matches);
  render();
  status.hidden=true;
  document.documentElement.dataset.ready='true';
}
function resizeCanvas() {
  const width=Math.max(1,innerWidth),height=Math.max(1,innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.setSize(width,height);
  content?.resize?.(width,height);
  compositor?.resize(width,height);
}
let resizeSerial=Promise.resolve();
function resize() {
  resizeCanvas();
  const variant=registry?.scenes[slug]?.variants[device()];
  if (variant && JSON.stringify(variant)!==variantKey) {
    if (variant.sceneUrl===variantSceneUrl && content?.selectCamera) {
      content.selectCamera(variant.cameraId);
      variantKey=JSON.stringify(variant);
      compositor.dispose();compositor=createCompositor(renderer,scene,content.camera,content.config?.effects);
      resizeCanvas();render();
    } else {
      ready=false;
      resizeSerial=resizeSerial.then(()=>{if(!disposed)return load();}).catch(fail);
    }
  } else render();
}
function pointer(event) { targetPointer.x=event.clientX/innerWidth*2-1;targetPointer.y=1-event.clientY/innerHeight*2; if (!playing) render(); }
function resetPointer(){targetPointer.x=0;targetPointer.y=0;}
function visibility(){lastFrame=undefined;content?.resources?.setPlaying(playing && !document.hidden && !state.reducedMotion);if(!document.hidden)render();}
function motion() {state.reducedMotion=reduce.matches;playing=!reduce.matches;content?.resources?.setPlaying(playing);render();}
function scroll(){const height=document.documentElement.scrollHeight-innerHeight;if(height>0)state.progress=Math.max(0,Math.min(1,scrollY/height));if(!playing)render();}
function message(event) {
  // Embedders may control only the public animation timeline, never evaluate code.
  if (event.source!==parent || !event.data || event.data.type!=='humanity-animation') return;
  if (event.data.action==='progress') api.setProgress(event.data.value);
  if (event.data.action==='pause') api.pause();
  if (event.data.action==='play') api.play();
}
function fail(error) {if(disposed)return;console.error(error);ready=false;status.hidden=false;status.textContent='This animation could not load. Please reload the page.';document.documentElement.dataset.ready='error';}
const api = {
  engine:'humanity-three',scene:slug,
  get ready(){return ready;},get time(){return time;},get playing(){return playing;},get disposed(){return disposed;},get renderCount(){return renderCount;},
  async seek(seconds) {if(disposed)return;api.pause();time=Math.max(0,Number(seconds)||0);await content?.resources?.seek(time);render();},
  setProgress(value) {if(disposed)return;state.progress=Math.max(0,Math.min(1,Number(value)||0));render();},
  play() {if(disposed)return;playing=!state.reducedMotion;lastFrame=undefined;content?.resources?.setPlaying(playing);},
  pause(){playing=false;content?.resources?.setPlaying(false);},
  dispose(){if(disposed)return;disposed=true;ready=false;playing=false;generation++;loadAbort?.abort();cancelAnimationFrame(frameId);clearScene();renderer?.dispose();renderer?.domElement.remove();for(const [type,handler] of listeners)window.removeEventListener(type,handler);document.removeEventListener('visibilitychange',visibility);reduce.removeEventListener('change',motion);}
};
window.__humanityAnimation=api;
const listeners=[['resize',resize],['pointermove',pointer],['pointerleave',resetPointer],['scroll',scroll],['message',message],['pagehide',()=>api.dispose()]];
try {
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.NoToneMapping;
  renderer.domElement.setAttribute('aria-label',document.title);
  renderer.domElement.setAttribute('role','img');
  document.body.append(renderer.domElement);
  resizeCanvas();
  registry=await readJSON('/src/scenes/peach/registry.json');
  if (!disposed) await load();
  if (!disposed) {
  for(const [type,handler] of listeners)window.addEventListener(type,handler,{passive:type!=='message'});
  document.addEventListener('visibilitychange',visibility);
  reduce.addEventListener('change',motion);
  frameId=requestAnimationFrame(tick);
  }
} catch(error) { fail(error); }
