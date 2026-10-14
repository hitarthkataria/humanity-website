import * as THREE from 'three';

const TAU = Math.PI * 2;
const RAD = Math.PI / 180;
const ASSET_URL = '/assets/coins/scene-art.json';

// Revolve a newly authored cross-section. The recessed faces and raised rim are
// actual geometry, so the coin stays solid when the animation turns edge-on.
function coinGeometry() {
  const section = [
    [0, -.071], [.923, -.071], [.938, -.075], [.947, -.087],
    [.952, -.0956], [.982, -.0956], [.994, -.089], [1, -.078],
    [1, .078], [.994, .089], [.982, .0956], [.952, .0956],
    [.947, .087], [.938, .075], [.923, .071], [0, .071],
  ];
  const geometry = new THREE.LatheGeometry(section.map(p => new THREE.Vector2(...p)), 160);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

function markGeometry(contours) {
  const shapes = contours.map(points => {
    const shape = new THREE.Shape();
    shape.moveTo(...points[0][0]);
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      shape.bezierCurveTo(...a[2], ...b[1], ...b[0]);
    }
    shape.closePath();
    return shape;
  });
  return new THREE.ExtrudeGeometry(shapes, { depth: .019, bevelEnabled: false, curveSegments: 8 });
}

// An original orange-metal shader, with broad studio illumination and a warm
// dark reflection. It needs no environment download or vendor material system.
function coinMaterial(single) {
  return new THREE.ShaderMaterial({
    uniforms: {
      orange: { value: new THREE.Color('#ef4f00') },
      red: { value: new THREE.Color('#aa0000') },
      single: { value: single ? 1 : 0 },
    },
    vertexShader: `
      varying vec3 vNormal, vLocalNormal, vViewLocal, vLocal;
      void main() {
        vNormal = normalize(mat3(modelMatrix) * normal);
        vLocalNormal = normal;
        vViewLocal = mat3(modelViewMatrix) * position / length(modelMatrix[0].xyz);
        vLocal = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 orange, red;
      uniform float single;
      varying vec3 vNormal, vLocalNormal, vViewLocal, vLocal;
      void main() {
        vec3 n = normalize(vNormal);
        float face = smoothstep(.9, .995, abs(normalize(vLocalNormal).z));
        // Two broad studio reflections: a red wall and its diagonal floor edge.
        // Coordinates follow the view, keeping the light fixed as the coin turns.
        float diagonal = vViewLocal.x * .7 - vViewLocal.y * .9;
        float floorReflection = .35 * smoothstep(-.9, .7, diagonal)
          + .65 * smoothstep(.22, .48, diagonal);
        float turnReflection = smoothstep(.05, .25, n.x);
        float floorWeight = 1. - smoothstep(.08, .35, abs(n.x));
        float tokenReflection = max(turnReflection, floorWeight * floorReflection * face);
        // The loop artwork uses a narrower red studio panel. Its reflection
        // travels over the rim continuously as each coin follows the orbit.
        float phase = mod(atan(-n.y, n.z / .70710678) + .48, 3.14159265);
        float front = step(0., vLocal.z);
        float panelEnd = mix(.86, 2.00, front);
        float panelStart = mix(.66, .82, front);
        float panel = smoothstep(.02, .17, phase) * (1. - smoothstep(panelStart, panelEnd, phase));
        float radius = length(vLocal.xy);
        float edge = (1. - face) * smoothstep(.985, .997, radius);
        float edgePanel = smoothstep(.25, .38, cos(atan(n.y, n.x) * 6. + .55));
        float reflection = mix(mix(panel, tokenReflection, single), edgePanel, edge * single);
        vec3 color = mix(orange, red, clamp(reflection, 0., 1.));
        float innerRim = exp(-pow((radius - .944) / .005, 2.));
        color = mix(color, red, innerRim * .6);
        float subtleShade = 1. - .035 * smoothstep(-.8, .9, diagonal) * face;
        color *= subtleShade;
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}

function markMaterial(single, optimized) {
  if (optimized) return new THREE.MeshBasicMaterial({ color: '#d1edc0' });
  return new THREE.ShaderMaterial({
    uniforms: {
      cream: { value: new THREE.Color('#ffffe8') },
      gold: { value: new THREE.Color('#a5a573') },
      single: { value: single ? 1 : 0 },
    },
    vertexShader: `
      varying vec3 vNormal, vLocalNormal;
      void main() {
        vNormal = normalize(mat3(modelMatrix) * normal);
        vLocalNormal = normal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 cream, gold;
      uniform float single;
      varying vec3 vNormal, vLocalNormal;
      void main() {
        vec3 n = normalize(vNormal);
        float loopShade = (1. - smoothstep(-.70, .25, n.y)) * .96;
        float tokenShade = smoothstep(.10, .90, -n.x) * .48;
        float edgeShade = (1. - abs(normalize(vLocalNormal).z)) * .65;
        float shade = max(mix(loopShade, tokenShade, single), edgeShade);
        gl_FragColor = vec4(mix(cream, gold, shade), 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}

function cubicEase(progress) {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  // Art-directed spin easing. Solve the time coordinate of its Bezier curve.
  const x1 = .6455859375, y1 = .0287109375;
  const x2 = .3534375, y2 = .9955729167;
  const cubic = (t, a, b) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
  let lo = 0, hi = 1;
  for (let i = 0; i < 15; i++) {
    const mid = (lo + hi) / 2;
    if (cubic(mid, x1, x2) < progress) lo = mid; else hi = mid;
  }
  return cubic((lo + hi) / 2, y1, y2);
}

/** Three.js-only implementation of the three Humanity coin artworks. */
export async function createCoinScene({ id, slug, scene, renderer }) {
  const response = await fetch(ASSET_URL);
  if (!response.ok) throw new Error(`Coin artwork could not be loaded (${response.status}).`);
  const art = await response.json();
  const single = slug === 'h-token' || id.startsWith('htoken-');
  const optimized = slug === 'h-coins-loop-optimized' || id.startsWith('hcoinsloopoptimized-');
  const source = art.scenes[id];
  if (!source) throw new Error(`Unknown coin artwork: ${id}`);

  const root = new THREE.Group();
  root.name = single ? 'Humanity token' : 'Humanity coin orbit';
  scene.add(root);
  if (single) scene.background = new THREE.Color('#ffe3b8');
  else scene.background = null;
  renderer.setClearAlpha(single ? 1 : 0);

  const bodyGeometry = coinGeometry();
  const logoGeometry = markGeometry(art.mark);
  const bodyMaterial = coinMaterial(single);
  const logoMaterial = markMaterial(single, optimized);
  const coins = [];
  const count = single ? 1 : 10;
  for (let i = 0; i < count; i++) {
    const coin = new THREE.Group();
    coin.name = `Humanity coin ${i + 1}`;
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.name = 'Recessed orange metal';
    coin.add(body);
    for (const side of [-1, 1]) {
      const logo = new THREE.Mesh(logoGeometry, logoMaterial);
      logo.position.z = side * .072;
      if (side === -1) logo.rotation.y = Math.PI;
      logo.name = 'Humanity mark';
      coin.add(logo);
    }
    coin.scale.setScalar(single ? 1.86347209 : .8783);
    root.add(coin);
    coins.push(coin);
  }

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 100);
  camera.position.fromArray(source.camera.position).multiplyScalar(.01);
  camera.rotation.set(...source.camera.rotation.map(n => n * RAD));
  // Preserve the authored CSS-pixel scale. Narrow embeds crop the orbit just
  // as the hosted artwork does; changing to contain-fit alters its composition.
  function resize(width, height) {
    const aspect = Math.max(width, 1) / Math.max(height, 1);
    const viewHeight = Math.max(height, 1) / (100 * source.camera.zoom);
    camera.left = -viewHeight * aspect / 2;
    camera.right = viewHeight * aspect / 2;
    camera.top = viewHeight / 2;
    camera.bottom = -viewHeight / 2;
    camera.updateProjectionMatrix();
  }
  const size = renderer.getSize(new THREE.Vector2());
  resize(size.x, size.y);

  const planeRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 27.0442326778 * RAD, 0));
  function update(time, _delta, state = {}) {
    const t = state.reducedMotion ? 0 : Math.max(0, time);
    if (single) {
      coins[0].rotation.y = -TAU * cubicEase((t % 3) / 3);
      return;
    }
    // A full 10-second circuit, with one coin-spacing traversed per second.
    // The coin tilt follows its orbital angle without animation data interpreters,
    // frame accumulators or hidden state, so seeking is exact.
    for (let i = 0; i < coins.length; i++) {
      const angle = Math.PI - TAU * (i / count + t / 10);
      const coin = coins[i];
      coin.position.set(Math.cos(angle), Math.sin(angle), 0)
        .multiplyScalar(2.6651453863).applyQuaternion(planeRotation);
      coin.rotation.set(angle - .48, -Math.PI / 4, 0, 'YXZ');
    }
  }
  update(0, 0, {});
  let disposed = false;
  return {
    camera, update, resize,
    dispose() {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      bodyGeometry.dispose(); logoGeometry.dispose();
      bodyMaterial.dispose(); logoMaterial.dispose();
    },
  };
}
