import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// The art uses a light, high-key glow. Operate on bounded display colors so
// strong authored lights cannot wash out the whole frame in an HDR bloom pass.
export function createCompositor(renderer,scene,camera,effects={}) {
  if (!effects.bloom && !effects.grain) return {
    render:()=>renderer.render(scene,camera), resize(){}, dispose(){}
  };
  // Canvas antialiasing does not apply to the composer's offscreen targets.
  const target = new THREE.WebGLRenderTarget(1,1,{
    type:THREE.UnsignedByteType,
    samples:effects.antialias === false ? 0 : Math.min(4,renderer.capabilities.maxSamples)
  });
  const composer = new EffectComposer(renderer,target);
  composer.addPass(new RenderPass(scene,camera));
  composer.addPass(new OutputPass());
  const finish = new ShaderPass({
    uniforms:{
      tDiffuse:{value:null}, grain:{value:effects.grain?.opacity ?? 0}, phase:{value:0},
      glow:{value:(effects.bloom?.strength ?? 0)*.6},
      threshold:{value:effects.bloom?.threshold ?? .9},
      smoothing:{value:Math.max(.0001,effects.bloom?.smoothing ?? .025)},
      pixel:{value:new THREE.Vector2(1,1)},radius:{value:4+(effects.bloom?.radius ?? 0)*32},
      softness:{value:effects.bloom ? .75 : 0},
      midtonePower:{value:effects.bloom ? .45 : 1}
    },
    vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:`uniform sampler2D tDiffuse; uniform float grain,phase,glow,threshold,smoothing,radius,softness,midtonePower; uniform vec2 pixel; varying vec2 vUv;
      vec3 highlight(vec2 uv){vec3 color=texture2D(tDiffuse,uv).rgb;return color*smoothstep(threshold,threshold+smoothing,dot(color,vec3(.2126,.7152,.0722)));}
      void main(){
        vec4 source=texture2D(tDiffuse,vUv);vec3 halo=vec3(0.0);
        // A compact Gaussian lens diffusion softens the image as well as its glow.
        // Weights sum to one, preserving flat backgrounds and the overall exposure.
        vec3 soft=source.rgb*.25;
        for(int y=-1;y<=1;y++){for(int x=-1;x<=1;x++){
          if(x==0 && y==0) continue;
          float weight=(x==0 || y==0) ? .125 : .0625;
          soft+=texture2D(tDiffuse,vUv+vec2(float(x),float(y))*pixel*softness).rgb*weight;
        }}
        for(int y=-2;y<=2;y++){for(int x=-2;x<=2;x++){
          float weight=exp(-float(x*x+y*y)*.5);
          halo+=highlight(vUv+vec2(float(x),float(y))*pixel*radius)*weight;
        }}
        halo=clamp(halo/6.1689*glow,0.0,0.65);
        // Calibrated display curve: lift shaded surfaces without changing RGB
        // ratios or pushing already-bright skin/highlights beyond white.
        float peak=max(soft.r,max(soft.g,soft.b));
        soft*=mix(1.0,pow(max(peak,.001),midtonePower-1.0),1.0-smoothstep(.5,.85,peak));
        vec3 color=1.0-(1.0-soft)*(1.0-halo);
        float noise=fract(sin(dot(gl_FragCoord.xy+phase,vec2(12.9898,78.233)))*43758.5453);
        color=clamp(color+grain*(noise-0.5)*1.8*color*(1.0-color),0.0,1.0);
        gl_FragColor=vec4(color,source.a);
      }`
  });
  composer.addPass(finish);
  return {
    render(time) { finish.uniforms.phase.value=Math.floor(time*24); composer.render(); },
    resize(width,height) {
      composer.setPixelRatio(renderer.getPixelRatio());composer.setSize(width,height);
      // Optical radii are CSS pixels, independent of Retina/device pixel ratio.
      finish.uniforms.pixel.value.set(1/width,1/height);
    },
    dispose() { for (const pass of composer.passes) pass.dispose?.(); composer.dispose(); }
  };
}
