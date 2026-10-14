import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

export class Resources {
  constructor(renderer,signal) {
    this.renderer = renderer;
    this.manager = new THREE.LoadingManager();
    this.signal = signal;
    this.onAbort = () => this.dispose();
    this.pendingVideos = new Set();
    this.textures = new Map();
    this.models = new Map();
    this.videos = new Set();
    this.disposed = false;
    this.draco = new DRACOLoader(this.manager).setDecoderPath('/vendor/addons/libs/draco/gltf/').setWorkerLimit(2);
    this.ktx = new KTX2Loader(this.manager).setTranscoderPath('/vendor/addons/libs/basis/').setWorkerLimit(2).detectSupport(renderer);
    this.gltf = new GLTFLoader(this.manager).setDRACOLoader(this.draco).setKTX2Loader(this.ktx).setMeshoptDecoder(MeshoptDecoder);
    signal?.addEventListener('abort',this.onAbort,{once:true});
    if (signal?.aborted) this.dispose();
  }
  async model(url) {
    if (this.disposed) throw new Error('Resource loading canceled');
    if (!this.models.has(url)) this.models.set(url, (async () => {
      const response = await fetch(url,{signal:this.signal});
      if (!response.ok) throw new Error(`Model failed (${response.status}): ${url}`);
      const bytes = await response.arrayBuffer();
      return this.gltf.parseAsync(bytes,new URL('.',new URL(url,location.href)).href);
    })().then(model => {
      model.scene.traverse(object => {
        for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
          if (material) material.userData.sourceIndex = model.parser.associations.get(material)?.materials ?? 0;
        }
      });
      return model;
    }));
    const model = await this.models.get(url);
    return {scene: clone(model.scene), animations: model.animations};
  }
  async texture(descriptor, color = true) {
    if (!descriptor?.url) return null;
    const key = JSON.stringify([descriptor,color]);
    if (!this.textures.has(key)) this.textures.set(key, this.loadTexture(descriptor, color));
    return this.textures.get(key);
  }
  async loadTexture(d, color) {
    if (this.disposed) throw new Error('Resource loading canceled');
    let texture;
    if (d.type === 'video') {
      const video = document.createElement('video');
      video.muted = true; video.loop = d.loop !== false; video.playsInline = true; video.preload = 'auto';
      this.videos.add(video);
      await new Promise((resolve,reject) => {
        const finish = error => {clearTimeout(timeout);this.pendingVideos.delete(cancel);error ? reject(error) : resolve();};
        const cancel = () => finish(new Error('Video loading canceled'));
        const timeout = setTimeout(() => finish(new Error(`Video timed out: ${d.url}`)), 30000);
        this.pendingVideos.add(cancel);
        video.addEventListener('loadeddata',()=>finish(),{once:true});
        video.addEventListener('error',()=>finish(new Error(`Video failed: ${d.url}`)),{once:true});
        video.src = d.url; video.load();
      });
      texture = new THREE.VideoTexture(video);
    } else if (d.type === 'hdr' || /\.hdr$/i.test(d.url)) {
      texture = await new HDRLoader(this.manager).loadAsync(d.url);
    } else {
      texture = await new THREE.TextureLoader(this.manager).loadAsync(d.url);
    }
    if (color && d.type !== 'hdr' && !/\.hdr$/i.test(d.url)) texture.colorSpace = THREE.SRGBColorSpace;
    const vector = (value) => Array.isArray(value) ? value : [value.x,value.y];
    for (const prop of ['repeat','offset','center']) if (d[prop]) texture[prop].fromArray(vector(d[prop]));
    const wrapping = {repeat: THREE.RepeatWrapping, clamp: THREE.ClampToEdgeWrapping, mirror: THREE.MirroredRepeatWrapping};
    for (const prop of ['wrapS','wrapT']) if (d[prop]) texture[prop] = wrapping[d[prop]] ?? THREE.ClampToEdgeWrapping;
    if (d.rotation) texture.rotation = d.rotation;
    if (d.flipY !== undefined) texture.flipY = d.flipY;
    if (this.disposed) texture.dispose();
    return texture;
  }
  setPlaying(playing) {
    for (const video of this.videos) {
      if (playing) video.play().catch(()=>{}); else video.pause();
    }
  }
  async seek(time) {
    await Promise.all([...this.videos].map(video => new Promise((resolve,reject) => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) return resolve();
      const target = time % video.duration;
      if (Math.abs(target-video.currentTime) < .005) return resolve();
      const finish = error => {
        clearTimeout(timeout);video.removeEventListener('seeked',onSeeked);
        error ? reject(error) : resolve();
      };
      const onSeeked = () => finish(Math.abs(video.currentTime-target) > .05
        ? new Error('Video seek failed. The asset server must support byte-range requests.') : undefined);
      const timeout = setTimeout(()=>finish(new Error('Video seek timed out.')),5000);
      video.addEventListener('seeked',onSeeked,{once:true});
      video.currentTime = target;
    })));
    // A paused VideoTexture's frame callback may run after `seeked`. Mark the
    // decoded frame for upload before the caller renders its deterministic seek.
    await Promise.all([...this.textures.values()].map(async pending => {
      const texture=await pending;
      if (texture.isVideoTexture && !this.disposed) texture.needsUpdate=true;
    }));
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.signal?.removeEventListener('abort',this.onAbort);
    this.manager.abort();
    for (const cancel of this.pendingVideos) cancel();
    this.pendingVideos.clear();
    for (const video of this.videos) { video.pause(); video.removeAttribute('src'); video.load(); }
    this.videos.clear();
    for (const promise of this.textures.values()) promise.then(t=>t.dispose()).catch(()=>{});
    for (const promise of this.models.values()) promise.then(({scene})=>disposeObject(scene)).catch(()=>{});
    this.draco.dispose(); this.ktx.dispose();
  }
}
export function disposeObject(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}
