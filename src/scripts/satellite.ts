import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

// Node names baked into public/models/pixelsat.glb. The model is Y-up, in
// millimetres, with the long axis running from y = 0 (bottom) to y = 300.
const PARTS = [
  "torquers",
  "battery",
  "power",
  "mppt",
  "obc",
  "comms",
  "antenna",
] as const;
type Part = (typeof PARTS)[number];

interface Pose {
  focus: Part[] | "all";
  az: number; // degrees around the long axis
  el: number; // degrees above the horizon
  dist: number; // mm from the focus point
  roll: number; // camera roll in degrees
  panels: number; // 0 = attached, 1 = pulled off
  frame: number; // frame opacity
  side: boolean; // text sits beside the model instead of above it
  lift: Partial<Record<Part, number>>; // mm along the long axis
}

const base = { roll: 0, panels: 1, frame: 0, side: true, lift: {} };

// One pose per [data-chapter], in page order.
export const POSES: Record<string, Pose> = {
  hero: {
    ...base,
    focus: "all",
    az: 38,
    el: 14,
    dist: 1000,
    roll: -62,
    panels: 0,
    frame: 1,
    side: false,
  },
  open: { ...base, focus: "all", az: 20, el: 16, dist: 720, frame: 1 },
  adcs: {
    ...base,
    focus: ["torquers"],
    az: 40,
    el: 30,
    dist: 430,
    lift: { torquers: 40 },
  },
  power: {
    ...base,
    focus: ["battery", "power", "mppt"],
    az: 60,
    el: 26,
    dist: 520,
    lift: {
      torquers: 150,
      battery: 60,
      power: 25,
      obc: -30,
      comms: -50,
      antenna: -70,
    },
  },
  obc: {
    ...base,
    focus: ["obc"],
    az: 25,
    el: 42,
    dist: 400,
    lift: {
      torquers: 220,
      battery: 150,
      power: 110,
      mppt: 85,
      comms: -40,
      antenna: -60,
    },
  },
  comms: {
    ...base,
    focus: ["comms", "antenna"],
    az: 5,
    el: 34,
    dist: 420,
    lift: {
      torquers: 260,
      battery: 190,
      power: 150,
      mppt: 125,
      obc: 60,
      antenna: -35,
    },
  },
  together: {
    ...base,
    focus: "all",
    az: 215,
    el: 16,
    dist: 1000,
    roll: -62,
    panels: 0,
    frame: 1,
    side: false,
  },
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function solarPanelTexture() {
  const w = 256;
  const h = 874; // matches the 82 × 280 mm panel
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#15171c";
  ctx.fillRect(0, 0, w, h);

  // 2 × 3 triple-junction cells with clipped corners and silver fingers.
  const cw = 112;
  const ch = 250;
  const gx = (w - cw * 2) / 3;
  const gy = (h - ch * 3) / 4;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 2; col++) {
      const x = gx + col * (cw + gx);
      const y = gy + row * (ch + gy);
      const c = 12;
      const grad = ctx.createLinearGradient(x, y, x + cw, y + ch);
      grad.addColorStop(0, "#23285a");
      grad.addColorStop(1, "#141838");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(x + c, y);
      ctx.lineTo(x + cw - c, y);
      ctx.lineTo(x + cw, y + c);
      ctx.lineTo(x + cw, y + ch - c);
      ctx.lineTo(x + cw - c, y + ch);
      ctx.lineTo(x + c, y + ch);
      ctx.lineTo(x, y + ch - c);
      ctx.lineTo(x, y + c);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(200, 205, 220, 0.35)";
      for (let fy = y + 10; fy < y + ch - 6; fy += 9) {
        ctx.fillRect(x + 3, fy, cw - 6, 1);
      }
      ctx.fillStyle = "rgba(210, 214, 226, 0.8)";
      ctx.fillRect(x + 4, y + 3, cw - 8, 3);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

// A black room ringed by thin light bands just below the horizon, which is
// where the side panels reflect from the hero shots. Flat panels reflect
// nearly one direction, so thin bands read as crisp streaks that slide along
// them as the camera moves, instead of an evenly lit sheen.
function studioEnvironment(pmrem: THREE.PMREMGenerator) {
  const room = new THREE.Scene();
  const band = (y: number, height: number, brightness: number) => {
    room
      .add(
        new THREE.Mesh(
          new THREE.CylinderGeometry(10, 10, height, 64, 1, true),
          new THREE.MeshBasicMaterial({
            color: new THREE.Color().setScalar(brightness),
            side: THREE.BackSide,
          }),
        ),
      )
      .children.at(-1)!.position.y = y;
  };
  band(-1.8, 0.3, 4);
  band(-3.6, 0.3, 2.5);
  band(6, 4, 0.3);
  return pmrem.fromScene(room, 0.01).texture;
}

// The CAD has no side panels, so four solar panels are built here.
function solarPanels() {
  const map = solarPanelTexture();
  const panels: { mesh: THREE.Mesh; normal: THREE.Vector3 }[] = [];
  const faces = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 0, -1),
  ];
  for (const normal of faces) {
    const material = new THREE.MeshPhysicalMaterial({
      map,
      metalness: 0,
      roughness: 0.35,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      envMapIntensity: 0.8,
      transparent: true,
    });
    const onX = normal.x !== 0;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(onX ? 1.6 : 82, 280, onX ? 82 : 1.6),
      material,
    );
    mesh.position.copy(normal).multiplyScalar(50.4).setY(150);
    mesh.castShadow = mesh.receiveShadow = true;
    panels.push({ mesh, normal });
  }
  return panels;
}

export function mountSatellite(
  canvas: HTMLCanvasElement,
  chapters: HTMLElement[],
  story: HTMLElement,
  onProgress: (fraction: number) => void,
  onReady: () => void,
) {
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const poses = chapters.map((el) => POSES[el.dataset.chapter!]);

  const renderer = new THREE.WebGLRenderer({ canvas });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;

  // The key light follows the camera (see frameAt) so every shot is lit
  // from the upper left, and casts the only shadows.
  const key = new THREE.DirectionalLight(0xffffff, 3.4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.4;
  key.shadow.radius = 6;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 2000;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0x9fb4ff, 1.2);
  rim.position.set(-400, 100, -300);
  scene.add(rim);
  scene.add(new THREE.HemisphereLight(0xe8eeff, 0x1a1a1a, 0.5));

  const camera = new THREE.PerspectiveCamera(28, 1, 5, 5000);

  const composer = new EffectComposer(
    renderer,
    new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: 4,
    }),
  );
  composer.addPass(new RenderPass(scene, camera));
  // Units are millimetres, so the AO radius is a few mm of contact shading.
  const ao = new GTAOPass(scene, camera);
  ao.updateGtaoMaterial({
    radius: 60,
    distanceExponent: 1,
    thickness: 40,
    scale: 3,
    samples: 16,
  });
  composer.addPass(ao);
  composer.addPass(new OutputPass());

  // Meshes that fade out (panels and frame). Their shadows fade with them
  // through a dithered depth material. GTAO ignores opacity, so partly faded
  // meshes are left out of its pass instead of leaving dark outlines behind.
  const faders: THREE.Mesh[] = [];
  const makeFadeable = (mesh: THREE.Mesh) => {
    mesh.material = (mesh.material as THREE.Material).clone();
    mesh.material.transparent = true;
    mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ alphaHash: true });
    faders.push(mesh);
  };
  const setOpacity = (meshes: THREE.Mesh[], opacity: number) => {
    for (const mesh of meshes) {
      (mesh.material as THREE.Material).opacity = opacity;
      mesh.customDepthMaterial!.opacity = opacity;
      mesh.visible = opacity > 0.001;
    }
  };
  const renderAO = ao.render.bind(ao);
  ao.render = (...args: Parameters<GTAOPass["render"]>) => {
    const hidden = faders.filter(
      (m) => m.visible && (m.material as THREE.Material).opacity < 1,
    );
    for (const m of hidden) m.visible = false;
    renderAO(...args);
    for (const m of hidden) m.visible = true;
  };

  const sat = new THREE.Group();
  sat.position.y = -150;
  scene.add(sat);

  const nodes = {} as Record<Part, THREE.Object3D>;
  const restBoxes = {} as Record<Part, THREE.Box3>;
  const restY = {} as Record<Part, number>;
  const frameMeshes: THREE.Mesh[] = [];
  const studio = studioEnvironment(pmrem);
  const panels = solarPanels();
  for (const { mesh } of panels) {
    (mesh.material as THREE.MeshPhysicalMaterial).envMap = studio;
    makeFadeable(mesh);
    sat.add(mesh);
  }

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.load(
    "/models/pixelsat.glb",
    (gltf) => {
      for (const child of [...gltf.scene.children]) {
        child.traverse((o) => (o.castShadow = o.receiveShadow = true));
        if (child.name === "frame") {
          child.traverse((o) => {
            if (!(o instanceof THREE.Mesh)) return;
            makeFadeable(o);
            frameMeshes.push(o);
          });
        } else {
          nodes[child.name as Part] = child;
          restBoxes[child.name as Part] = new THREE.Box3().setFromObject(child);
          // Quantized meshes carry their offset in the node transform.
          restY[child.name as Part] = child.position.y;
        }
        sat.add(child);
      }
      onReady();
    },
    (event) => event.total && onProgress(event.loaded / event.total),
  );

  const centerOf = (focus: Pose["focus"], lift: Pose["lift"]) => {
    if (focus === "all" || !restBoxes[focus[0]])
      return new THREE.Vector3(0, 150, 0);
    const box = new THREE.Box3();
    for (const part of focus) {
      box.union(
        restBoxes[part]
          .clone()
          .translate(new THREE.Vector3(0, lift[part] ?? 0, 0)),
      );
    }
    return box.getCenter(new THREE.Vector3());
  };

  let width = 0;
  let height = 0;
  const resize = () => {
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    renderer.setSize(width, height, false);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  const focusA = new THREE.Vector3();
  const focusB = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const lightDir = new THREE.Vector3();
  let running = false;

  const frameAt = (s: number, time: number) => {
    const i = Math.min(poses.length - 2, Math.floor(s));
    // Hold each pose for the first third of its segment, then move.
    const t = smooth(clamp01((s - i - 0.3) / 0.7));
    const a = poses[i];
    const b = poses[i + 1];

    for (const part of PARTS) {
      const node = nodes[part];
      if (node)
        node.position.y =
          restY[part] + lerp(a.lift[part] ?? 0, b.lift[part] ?? 0, t);
    }

    const panelsOff = lerp(a.panels, b.panels, t);
    for (const { mesh, normal } of panels) {
      mesh.position
        .copy(normal)
        .multiplyScalar(50.4 + panelsOff * 160)
        .setY(150);
    }
    setOpacity(
      panels.map((p) => p.mesh),
      1 - clamp01((panelsOff - 0.35) / 0.65),
    );
    setOpacity(frameMeshes, lerp(a.frame, b.frame, t));

    focusA.copy(centerOf(a.focus, a.lift));
    focusB.copy(centerOf(b.focus, b.lift));
    const focus = focusA.lerp(focusB, t).add(sat.position);

    // Portrait screens can't fit the model as wide, so back off.
    const fit = Math.max(1, 1.25 / camera.aspect) ** 0.8;
    const sway = reducedMotion
      ? 0
      : Math.sin(time / 2400) * 6 * (1 - t) * +(i === 0);
    const az = THREE.MathUtils.degToRad(lerp(a.az, b.az, t) + sway);
    const el = THREE.MathUtils.degToRad(lerp(a.el, b.el, t));
    const dist = lerp(a.dist, b.dist, t) * fit;
    offset.set(
      Math.cos(el) * Math.sin(az),
      Math.sin(el),
      Math.cos(el) * Math.cos(az),
    );
    camera.position.copy(focus).addScaledVector(offset, dist);
    camera.lookAt(focus);

    lightDir.set(-0.6, 1, 0.7).applyQuaternion(camera.quaternion).normalize();
    key.position.copy(focus).addScaledVector(lightDir, 800);
    key.target.position.copy(focus);
    const extent = dist * 0.4;
    Object.assign(key.shadow.camera, {
      left: -extent,
      right: extent,
      top: extent,
      bottom: -extent,
    });
    key.shadow.camera.updateProjectionMatrix();

    camera.rotateZ(THREE.MathUtils.degToRad(lerp(a.roll, b.roll, t)));

    // Shift the projection so the model sits beside (or below) the copy.
    const wide = width >= 900;
    const side = lerp(+a.side, +b.side, t);
    const shiftX = wide ? side * 0.22 : 0;
    const shiftY = lerp(0.25, wide ? 0 : -0.2, side);
    camera.setViewOffset(
      width,
      height,
      -shiftX * width,
      -shiftY * height,
      width,
      height,
    );

    composer.render();
  };

  // Chapter k is fully shown at s = k; its copy fades around that point.
  const updateCopy = (s: number) => {
    chapters.forEach((el, k) => {
      const d = s - k;
      const last = k === chapters.length - 1;
      const opacity =
        k === 0 && d < 0
          ? 1
          : last && d > 0
            ? 1
            : 1 - smooth(clamp01((Math.abs(d) - 0.12) / 0.2));
      el.style.opacity = opacity.toFixed(3);
      el.style.transform = `translate3d(0, ${(-d * 60).toFixed(1)}px, 0)`;
      el.style.visibility = opacity < 0.01 ? "hidden" : "visible";
    });
  };

  const target = () => {
    const segment =
      (story.offsetHeight - window.innerHeight) / (poses.length - 1);
    const scrolled = -story.getBoundingClientRect().top;
    return Math.min(poses.length - 1, Math.max(0, scrolled / segment));
  };

  let s = target();
  const tick = (time: number) => {
    if (!running) return;
    s += (target() - s) * (reducedMotion ? 1 : 0.12);
    updateCopy(s);
    frameAt(s, time);
    requestAnimationFrame(tick);
  };

  new IntersectionObserver(([entry]) => {
    const wasRunning = running;
    running = entry.isIntersecting;
    if (running && !wasRunning) requestAnimationFrame(tick);
  }).observe(story);

  updateCopy(s);
}
