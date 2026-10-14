import * as THREE from 'three';
import { Resources } from './resources.js';
import { applyTracks } from './timeline.js';

const colorSlots = new Set(['map','emissiveMap','sheenColorMap','specularColorMap','envMap']);
const colorProps = new Set(['color','emissive','sheenColor','specularColor','attenuationColor']);
const materialProps = new Set(['opacity','transparent','alphaTest','flatShading','roughness','metalness','ior','sheen','clearcoat','thickness','dispersion','iridescence','reflectivity','transmission','aoMapIntensity','iridescenceIOR','sheenRoughness','displacementScale','emissiveIntensity','specularIntensity','clearcoatRoughness','attenuationDistance','envMapIntensity']);

export async function createArtScene({config, cameraId, renderer, scene, signal}) {
  const resources = new Resources(renderer,signal);
  const objects = new Map([[config.rootId,scene]]);
  const mixers = [];
  const targets = [];
  const materials = new Map();
  const physicalMaterials = [];
  // Calibrate modern physical lighting to the supplied high-key visual references.
  // Keep the authored art values intact so these renderer-specific factors are explicit.
  const environmentExposure = .4, sheenResponse = .65;
  try {
    scene.background = config.background ? new THREE.Color(config.background) : null;
    const ambient = config.ambientLight;
    if (ambient?.visible !== false) scene.add(new THREE.AmbientLight(ambient?.color ?? '#ffffff',ambient?.intensity ?? 1));
    if (config.environment) {
      const texture = await resources.texture(config.environment);
      texture.mapping = THREE.EquirectangularReflectionMapping;
      scene.environment = texture;
      scene.environmentIntensity = (config.environment.intensity ?? 1)*environmentExposure;
      scene.environmentRotation.y = config.environment.rotation ?? 0;
    }
    await Promise.all(Object.entries(config.materials).map(async ([id,data]) => {
      const material = data.type === 'physical' ? new THREE.MeshPhysicalMaterial() : new THREE.MeshStandardMaterial();
      material.name = data.name ?? id;
      for (const [key,value] of Object.entries(data)) {
        if (colorProps.has(key)) material[key]?.set(value);
        else if (materialProps.has(key) && key in material) {
          // Reflectivity is a legacy alias that sets IOR in Three.js. An explicit
          // authored IOR takes precedence, independent of JSON property order.
          if (key === 'reflectivity' && data.ior !== undefined) continue;
          material[key] = key === 'attenuationDistance' && value === 0 ? Infinity : value;
        }
      }
      material.side = {front:THREE.FrontSide,back:THREE.BackSide,double:THREE.DoubleSide}[data.side] ?? THREE.FrontSide;
      await Promise.all(Object.entries(data.textures ?? {}).map(async ([slot,descriptor]) => {
        if (descriptor.type === 'embedded') return;
        const texture = await resources.texture(descriptor,colorSlots.has(slot));
        if (slot === 'envMap') { texture.mapping = THREE.EquirectangularReflectionMapping; material.envMapIntensity = descriptor.intensity ?? data.envMapIntensity ?? 1; }
        material[slot] = texture;
      }));
      if (material.isMeshPhysicalMaterial) physicalMaterials.push({material,sheen:data.sheen ?? 0});
      materials.set(id,material); objects.set(id,material);
    }));
    await Promise.all(config.nodes.map(async data => {
      let object;
      switch (data.type) {
        case 'camera':
          object = new THREE.PerspectiveCamera(data.fov ?? 35,1,data.near ?? .1,data.far ?? 2000);
          object.zoom = data.zoom ?? 1;
          break;
        case 'model': {
          object = new THREE.Group();
          const model = await resources.model(data.url);
          const palette = (data.materials ?? []).map(id=>materials.get(id));
          model.scene.traverse(child => {
            if (!child.isMesh) return;
            const replace = (material) => {
              const slot = material.userData.sourceIndex ?? 0;
              const replacement = palette[slot] ?? material;
              const settings = config.materials[data.materials?.[slot]];
              const embedded = Object.entries(settings?.textures ?? {}).filter(([,descriptor]) => descriptor.type === 'embedded');
              if (!embedded.length) return replacement;
              const copy = replacement.clone();
              if (copy.isMeshPhysicalMaterial) physicalMaterials.push({material:copy,source:replacement,sheen:settings.sheen ?? 0});
              for (const [key] of embedded) copy[key] = material[key];
              return copy;
            };
            child.material = Array.isArray(child.material) ? child.material.map(replace) : replace(child.material);
            child.castShadow = data.castShadow ?? false;
            child.receiveShadow = data.receiveShadow ?? false;
          });
          object.add(model.scene);
          if (data.animation && model.animations.length) {
            const clip = model.animations.find(clip=>clip.name===data.animation.clipName) ?? model.animations[0];
            const mixer = new THREE.AnimationMixer(model.scene);
            const action = mixer.clipAction(clip);
            if (data.animation.loop === false) { action.setLoop(THREE.LoopOnce,1); action.clampWhenFinished = true; }
            action.play();
            mixers.push({mixer,speed:data.animation.speed ?? 1});
          }
          break;
        }
        case 'mesh': {
          const g = data.geometry;
          const geometry = g.type === 'sphere' ? new THREE.SphereGeometry(g.radius,g.widthSegments,g.heightSegments,g.phiStart,g.phiLength,g.thetaStart,g.thetaLength) : new THREE.PlaneGeometry(g.width,g.height,g.widthSegments,g.heightSegments);
          object = new THREE.Mesh(geometry,materials.get(data.materialId));
          break;
        }
        case 'light': {
          if (data.lightType === 'spot') {
            object = new THREE.SpotLight(data.color,data.intensity,data.distance,data.angle,data.penumbra,data.decay);
            if (data.map) object.map = await resources.texture(data.map);
          } else if (data.lightType === 'ambient') object = new THREE.AmbientLight(data.color,data.intensity);
          else object = new THREE.DirectionalLight(data.color,data.intensity);
          if (object.target) targets.push(object);
          break;
        }
        case 'group': object = new THREE.Group(); break;
        default: throw new Error(`Unsupported art node: ${data.type}`);
      }
      object.name = data.name ?? data.id;
      object.position.fromArray(data.position ?? [0,0,0]);
      object.rotation.fromArray([...(data.rotation ?? [0,0,0]),'XYZ']);
      object.scale.fromArray(data.scale ?? [1,1,1]);
      object.visible = data.visible !== false;
      object.castShadow = data.castShadow ?? false;
      object.receiveShadow = data.receiveShadow ?? false;
      objects.set(data.id,object);
    }));
    for (const data of config.nodes) {
      const parent = objects.get(data.parent) ?? scene;
      parent.add(objects.get(data.id));
    }
    for (const light of targets) {
      if (light.isDirectionalLight) {
        // Directional art lights aim from their position at the scene origin.
        scene.add(light.target); light.target.position.set(0,0,0);
      } else {
        // Spot projector transforms orient the local -Y axis toward the target.
        light.add(light.target); light.target.position.set(0,-1,0);
      }
    }
    let camera = objects.get(cameraId ?? config.cameraId);
    if (!camera?.isCamera) throw new Error('Scene has no valid camera');
    let cameraData = config.nodes.find(n=>n.id===(cameraId ?? config.cameraId));
    let basePosition = camera.position.clone(), baseRotation = camera.rotation.clone();
    let controls = cameraData.controls;
    return {
      get camera() { return camera; }, resources, config,
      selectCamera(id) {
        const next=objects.get(id);
        if (!next?.isCamera) throw new Error('Unknown art camera');
        camera.position.copy(basePosition); camera.rotation.copy(baseRotation);
        camera=next;cameraData=config.nodes.find(node=>node.id===id);controls=cameraData.controls;
        basePosition=camera.position.clone();baseRotation=camera.rotation.clone();
      },
      update(time,delta,state) {
        camera.position.copy(basePosition); camera.rotation.copy(baseRotation);
        for (const {mixer,speed} of mixers) mixer.setTime(time*speed);
        for (const entry of physicalMaterials) entry.material.sheen=entry.sheen;
        applyTracks(config.tracks ?? [],objects,state.progress);
        for (const entry of physicalMaterials) if (entry.source) entry.material.sheen=entry.source.sheen;
        for (const entry of physicalMaterials) entry.material.sheen*=sheenResponse;
        basePosition.copy(camera.position); baseRotation.copy(camera.rotation);
        if (controls && !state.reducedMotion) {
          if (controls.type === 'tilt') {
            camera.rotation.x += state.pointer.y * (controls.maxRotation?.[0] ?? 0);
            camera.rotation.y += state.pointer.x * (controls.maxRotation?.[1] ?? 0);
          } else if (controls.type === 'pan') {
            camera.position.x += state.pointer.x * (controls.maxDistance?.[0] ?? 0);
            camera.position.y += state.pointer.y * (controls.maxDistance?.[1] ?? 0);
          }
        }
        camera.updateProjectionMatrix();
      },
      resize(width,height) { camera.aspect = width / height; camera.updateProjectionMatrix(); },
      dispose() { for (const {mixer} of mixers) { mixer.stopAllAction(); mixer.uncacheRoot(mixer.getRoot()); } resources.dispose(); }
    };
  } catch (error) { resources.dispose(); throw error; }
}
