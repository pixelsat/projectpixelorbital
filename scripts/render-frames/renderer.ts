import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";

import {
  PARTS,
  POSE_LIST,
  clamp01,
  lerp,
  type Part,
  type Pose,
} from "../../src/scripts/story.ts";

// Renders the satellite story offline, for render-frames.mjs. The page plays
// the resulting frames back (src/scripts/story-player.ts) instead of running
// any of this.

// Low-discrepancy sequence in [0, 1): successive samples fill the gaps left
// by earlier ones.
const halton = (i: number, base: number) => {
  let r = 0;
  for (let f = 1 / base; i > 0; i = Math.floor(i / base), f /= base)
    r += f * (i % base);
  return r;
};

// Side panel PCB in mm. Texture maps are drawn in these units, top of the
// panel at y = 0.
const PANEL = { w: 82, h: 280, thickness: 1.6 };
const PX_PER_MM = 8;

// Anything drawn on the panel sets all three maps at once: albedo, a packed
// surface map (R = coverglass, which drives clearcoat; G = roughness;
// B = metalness), and a height map turned into normals.
interface Finish {
  color: string;
  coat: number;
  rough: number;
  metal: number;
  height: number;
}
const SOLDERMASK: Finish = {
  color: "#0c0d10",
  coat: 0,
  rough: 0.55,
  metal: 0,
  height: 0.2,
};
const SILVER: Finish = {
  color: "#c4c7cf",
  coat: 0,
  rough: 0.3,
  metal: 1,
  height: 0.8,
};

export function solarPanelMaps(anisotropy: number) {
  const layer = () => {
    const canvas = document.createElement("canvas");
    canvas.width = PANEL.w * PX_PER_MM;
    canvas.height = PANEL.h * PX_PER_MM;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(PX_PER_MM, PX_PER_MM);
    return ctx;
  };
  const albedo = layer();
  const surface = layer();
  const height = layer();
  const byte = (v: number) => Math.round(v * 255);
  const paint = (f: Finish, path: (ctx: CanvasRenderingContext2D) => void) => {
    const layers: [CanvasRenderingContext2D, string][] = [
      [albedo, f.color],
      [surface, `rgb(${byte(f.coat)},${byte(f.rough)},${byte(f.metal)})`],
      [height, `rgb(${byte(f.height)},0,0)`],
    ];
    for (const [ctx, style] of layers) {
      ctx.fillStyle = style;
      ctx.beginPath();
      path(ctx);
      ctx.fill();
    }
  };
  const rect =
    (x: number, y: number, w: number, h: number) =>
    (ctx: CanvasRenderingContext2D) =>
      ctx.rect(x, y, w, h);
  // Cells are cut two to a round wafer, so the two corners on the wafer's
  // edge are cropped.
  const croppedCell =
    (x: number, y: number, w: number, h: number, c: number) =>
    (ctx: CanvasRenderingContext2D) => {
      ctx.moveTo(x + c, y);
      ctx.lineTo(x + w - c, y);
      ctx.lineTo(x + w, y + c);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x, y + h);
      ctx.lineTo(x, y + c);
      ctx.closePath();
    };
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  paint(SOLDERMASK, rect(0, 0, PANEL.w, PANEL.h));

  // Four triple-junction cells in series filling the panel end to end, with
  // welded silver interconnects across each gap.
  const gap = 2.5;
  const cell = { w: PANEL.w, h: (PANEL.h - 3 * gap) / 4, crop: 5 };
  const tabs = [12, 38.5, 65];
  for (let i = 0; i < 4; i++) {
    const y = i * (cell.h + gap);
    const lightness = 12 + (random() - 0.5) * 1.6;
    const hue = 231 + (random() - 0.5) * 6;
    const glass = 0.35;
    paint(
      { color: "#161a2c", coat: 1, rough: 0.05, metal: 0, height: 0.62 },
      croppedCell(
        -glass,
        y - glass,
        cell.w + glass * 2,
        cell.h + glass * 2,
        cell.crop + glass,
      ),
    );
    paint(
      {
        color: `hsl(${hue} 52% ${lightness}%)`,
        coat: 1,
        rough: 0.1,
        metal: 0,
        height: 0.6,
      },
      croppedCell(0, y, cell.w, cell.h, cell.crop),
    );
    // Grid fingers are microns wide and sit under the coverglass, so they
    // only faintly tint the cell. Giving them height or metalness puts
    // sub-pixel ridges in the normal map, which alias into corrugated stripes.
    const finger = {
      color: "rgba(150, 156, 180, 0.12)",
      coat: 1,
      rough: 0.1,
      metal: 0,
      height: 0.6,
    };
    for (let fx = 1.2; fx < cell.w - 1; fx += 1.4) {
      const top = fx < cell.crop || fx > cell.w - cell.crop;
      paint(finger, rect(fx, y + (top ? cell.crop : 0.8), 0.12, cell.h - 2.6));
    }
    // Busbar along the uncropped edge, and the bypass diode sitting in a
    // cropped corner.
    paint(
      { ...SILVER, coat: 1, height: 0.66 },
      rect(1, y + cell.h - 2, cell.w - 2, 1.4),
    );
    paint(
      { color: "#1b1b1f", coat: 0, rough: 0.35, metal: 0.3, height: 0.7 },
      rect(0.6, y + 0.6, 2.2, 2.2),
    );
    paint(SILVER, rect(2.8, y + 1.3, 2, 0.8));
    if (i === 3) continue;
    // Interconnects from this cell's busbar down to the next cell, which
    // covers their far ends.
    for (const tx of tabs) {
      paint(SILVER, rect(tx, y + cell.h - 2, 5, gap + 4));
      // Stress-relief loop in the middle of the gap.
      paint(
        { ...SILVER, color: "#8f929a", height: 0.95 },
        rect(tx, y + cell.h + gap / 2 - 0.4, 5, 0.8),
      );
    }
  }

  // Faint grain so large flat areas don't look like vector art.
  const noisy = albedo.getImageData(
    0,
    0,
    albedo.canvas.width,
    albedo.canvas.height,
  );
  for (let i = 0; i < noisy.data.length; i += 4) {
    const n = (random() - 0.5) * 3;
    noisy.data[i] += n;
    noisy.data[i + 1] += n;
    noisy.data[i + 2] += n;
  }
  albedo.putImageData(noisy, 0, 0);

  // Height to tangent-space normals. Canvas y points down the panel, while
  // the texture's v points up (flipY), which flips the sign of dy.
  const { width, height: rows } = height.canvas;
  const h = height.getImageData(0, 0, width, rows).data;
  const normals = new ImageData(width, rows);
  const strength = 3 / 255;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < width; x++) {
      const at = (xx: number, yy: number) =>
        h[
          (Math.min(rows - 1, Math.max(0, yy)) * width +
            Math.min(width - 1, Math.max(0, xx))) *
            4
        ];
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * width + x) * 4;
      normals.data[i] = byte((-dx / len + 1) / 2);
      normals.data[i + 1] = byte((dy / len + 1) / 2);
      normals.data[i + 2] = byte((1 / len + 1) / 2);
      normals.data[i + 3] = 255;
    }
  }
  height.putImageData(normals, 0, 0);

  const texture = (ctx: CanvasRenderingContext2D, srgb = false) => {
    const t = new THREE.CanvasTexture(ctx.canvas);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = anisotropy;
    return t;
  };
  return {
    map: texture(albedo, true),
    surface: texture(surface),
    normalMap: texture(height),
  };
}

// A black photo studio, laid out around a camera on +z looking at the
// origin; frameAt turns it with the camera so every shot is lit the same way.
// The shapes matter more than the amounts of light: metal and glass show
// little but reflections of them.
function studioEnvironment(pmrem: THREE.PMREMGenerator) {
  const room = new THREE.Scene();
  const emitter = (brightness: number) =>
    new THREE.MeshBasicMaterial({
      color: new THREE.Color().setScalar(brightness),
      side: THREE.DoubleSide,
    });

  // Faint fill that brightens towards the ceiling, so upward faces read as
  // lit. The camera looks slightly down, so vertical faces (the frame rails,
  // the side panels) reflect the floor on the camera's side: a broad glow
  // there gives the rough rails a soft sheen, while the coverglass, which
  // reflects only a few percent head-on, barely picks it up.
  const dome = new THREE.SphereGeometry(20, 64, 32);
  const shade = dome.attributes.position.array.map((_, i, p) => {
    const up = p[i - (i % 3) + 1] / 20;
    const front = p[i - (i % 3) + 2] / 20;
    const floor = Math.exp(-(((up + 0.3) / 0.3) ** 2));
    return (
      0.015 +
      0.08 * Math.max(0, up) ** 1.2 +
      0.25 * floor * (0.25 + 0.75 * Math.max(0, front))
    );
  });
  dome.setAttribute("color", new THREE.BufferAttribute(shade, 3));
  room.add(
    new THREE.Mesh(
      dome,
      new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide }),
    ),
  );

  // Softboxes, all above the horizon: a big one overhead; a tall strip at the
  // key light's side (upper left, in front) that runs down the frame rails;
  // a cooler strip behind for rim highlights; and a wide sweep behind the
  // model that horizontal boards reflect as a gloss across their tops.
  const softbox = (
    [x, y, z]: number[],
    w: number,
    h: number,
    brightness: number,
  ) => {
    const box = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      emitter(brightness),
    );
    box.position.set(x, y, z);
    box.lookAt(0, 0, 0);
    room.add(box);
    return box;
  };
  softbox([0, 10, 0], 10, 10, 1.2);
  softbox([-7, 5, 7], 3, 8, 3);
  softbox([8, 5, -6], 2, 8, 1.5).material.color.setRGB(1.2, 1.4, 1.8);
  softbox([0, 5.5, -10], 14, 5, 0.6);

  // Thin bands just below the horizon, which is where the side panels
  // reflect from the hero shots. Flat panels reflect nearly one direction,
  // so thin bands read as crisp streaks that slide along them as the camera
  // moves. They see them at a grazing angle, where the coverglass reflects
  // most of what it sees; any wider or brighter and they wash the dark cells
  // out to a pale grey.
  for (const [y, brightness] of [
    [-1.8, 0.65],
    [-3.6, 1.3],
  ]) {
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(10, 10, 0.2, 64, 1, true),
      emitter(brightness),
    );
    band.position.y = y;
    room.add(band);
  }
  return pmrem.fromScene(room, 0.01).texture;
}

// The CAD has no side panels, so four solar panels are built here.
function solarPanels(anisotropy: number) {
  const { map, surface, normalMap } = solarPanelMaps(anisotropy);
  // The cells sit under smooth coverglass with an anti-reflective coating:
  // they reflect little (specularIntensity) apart from sharp glints off the
  // glass (clearcoat), so they stay a deep blue-black.
  const front = new THREE.MeshPhysicalMaterial({
    map,
    normalMap,
    roughnessMap: surface,
    metalnessMap: surface,
    clearcoatMap: surface,
    roughness: 1,
    metalness: 1,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    specularIntensity: 0.25,
  });
  const back = new THREE.MeshStandardMaterial({
    color: 0x0f1013,
    roughness: 0.6,
  });
  const edge = new THREE.MeshStandardMaterial({
    color: 0x6b6245,
    roughness: 0.8,
  });
  const panels: { mesh: THREE.Mesh; normal: THREE.Vector3 }[] = [];
  const faces = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 0, -1),
  ];
  for (const normal of faces) {
    const onX = normal.x !== 0;
    // BoxGeometry groups run +x, -x, +y, -y, +z, -z.
    const outer = onX ? (normal.x > 0 ? 0 : 1) : normal.z > 0 ? 4 : 5;
    const materials = Array<THREE.Material>(6).fill(edge);
    materials[outer] = front;
    materials[outer ^ 1] = back;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(
        onX ? PANEL.thickness : PANEL.w,
        PANEL.h,
        onX ? PANEL.w : PANEL.thickness,
      ),
      materials,
    );
    mesh.position.copy(normal).multiplyScalar(50.4).setY(150);
    mesh.castShadow = mesh.receiveShadow = true;
    panels.push({ mesh, normal });
  }
  return panels;
}

// The CAD export only distinguishes materials by colour, and gives every
// KiCad part the same matte plastic. Plating is picked out by KiCad's
// standard colours so pins and pads read as metal.
// Header pins, and the solder pads, part terminations and the LoRa module's
// shield can. Similar colours (a yellow part body, the FR4 board edge) are
// left alone.
const GOLD_PLATING =
  /^Opaque\((212,176,56|212,173,56|219,188,126|165,132,0)\)$/;
const TIN_PLATING = /^Opaque\((188,188,188|210,209,199|165,158,150)\)$/;
const SOLDERMASK_GREEN = "Opaque(80,124,105)";

function finishMaterial(m: THREE.MeshStandardMaterial) {
  if (GOLD_PLATING.test(m.name) || TIN_PLATING.test(m.name)) {
    m.metalness = 1;
    m.roughness = 0.3;
  } else if (m.name === SOLDERMASK_GREEN) {
    m.roughness = 0.4;
  } else if (m.name.startsWith("Aluminum")) {
    // Bead-blasted rails: a darker, rougher metal picks up gradients from the
    // environment instead of reflecting it as one flat grey.
    m.color.setRGB(0.62, 0.63, 0.65);
    m.metalness = 1;
    m.roughness = 0.45;
  }
}

export interface RenderOptions {
  // Frame size in pixels. The frame is centred on the focus point.
  width: number;
  height: number;
  // Pixels per viewport height at fit = 1: the frame spans height / base
  // viewport heights, so it can include what portrait screens or shifted
  // layouts see beyond a landscape viewport.
  base: number;
}

export async function createRenderer(
  canvas: HTMLCanvasElement,
  { width, height, base }: RenderOptions,
) {
  const poses = POSE_LIST;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // GTAO renders the scene a second time; without this the shadow map would
  // be redrawn for it too. frameAt flags the one update per frame.
  renderer.shadowMap.autoUpdate = false;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = studioEnvironment(pmrem);

  // The key light follows the camera (see frameAt) so every shot is lit
  // from the upper left, and casts the only shadows.
  const key = new THREE.DirectionalLight(0xffffff, 3.4);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
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

  // The page's camera has a 28° vertical field of view across one viewport
  // height; the frame spans height / base of those.
  const camera = new THREE.PerspectiveCamera(
    THREE.MathUtils.radToDeg(
      2 * Math.atan((height / base) * Math.tan(THREE.MathUtils.degToRad(14))),
    ),
    width / height,
    5,
    5000,
  );

  // The composer draws one linear HDR sample of the scene with AO. Samples
  // are taken with the camera, key light and AO noise jittered, and averaged
  // into `accumulated`: this smooths edges and thin parts well beyond MSAA,
  // turns the key light's single shadow into a soft area-light one, and
  // dissolves AO noise. Tone mapping happens once, on the average.
  const composer = new EffectComposer(
    renderer,
    new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      samples: 4,
    }),
  );
  composer.renderToScreen = false;
  composer.setPixelRatio(1);
  composer.setSize(width, height);
  composer.addPass(new RenderPass(scene, camera));
  // Units are millimetres, so the AO radius is a few mm of contact shading.
  const ao = new GTAOPass(scene, camera, width, height);
  ao.updateGtaoMaterial({
    radius: 60,
    distanceExponent: 1,
    thickness: 40,
    scale: 3,
    samples: 16,
  });
  composer.addPass(ao);

  const target = () =>
    new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
    });
  const accumulated = target();
  // Blends a sample in with weight w: a running average when w = 1 / n.
  const accumulateMaterial = new THREE.ShaderMaterial({
    uniforms: { tSample: { value: null }, weight: { value: 1 } },
    vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }`,
    fragmentShader: /* glsl */ `
        uniform sampler2D tSample;
        uniform float weight;
        varying vec2 vUv;
        void main() {
          gl_FragColor = vec4(texture2D(tSample, vUv).rgb, weight);
        }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const accumulate = new FullScreenQuad(accumulateMaterial);
  const output = new OutputPass();
  output.renderToScreen = true;

  // GTAO and its denoiser pick sample directions from small tiled noise
  // textures. Rolling them to a new offset per sample decorrelates the noise
  // so averaging removes it.
  const noises = [ao.gtaoNoiseTexture, ao.pdNoiseTexture].map((texture) => ({
    texture,
    original: (texture.image.data as Uint8Array).slice(),
  }));
  let rolled = 0;
  const rollNoise = (k: number) => {
    if (k === rolled) return;
    rolled = k;
    for (const { texture, original } of noises) {
      const n = texture.image.width;
      const dx = (k * 7) % n;
      const dy = (k * 3 + Math.floor(k / n)) % n;
      const data = texture.image.data as Uint8Array;
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++)
          data.set(
            original.subarray(
              (((y + dy) % n) * n + ((x + dx) % n)) * 4,
              (((y + dy) % n) * n + ((x + dx) % n)) * 4 + 4,
            ),
            (y * n + x) * 4,
          );
      texture.needsUpdate = true;
    }
  };

  // Meshes that fade out (panels and frame). Their shadows fade with them
  // through a dithered depth material. GTAO ignores opacity, so while they're
  // partly faded it runs with and without them, and the two are crossfaded.
  const faders: THREE.Mesh[] = [];
  const materialsOf = (mesh: THREE.Mesh) =>
    [mesh.material].flat() as THREE.Material[];
  const makeFadeable = (mesh: THREE.Mesh) => {
    const clones = new Map<THREE.Material, THREE.Material>();
    const clone = (m: THREE.Material) => {
      if (!clones.has(m)) clones.set(m, m.clone());
      return clones.get(m)!;
    };
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(clone)
      : clone(mesh.material);
    for (const m of materialsOf(mesh)) m.transparent = true;
    mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ alphaHash: true });
    faders.push(mesh);
  };
  const setOpacity = (meshes: THREE.Mesh[], opacity: number) => {
    for (const mesh of meshes) {
      for (const m of materialsOf(mesh)) m.opacity = opacity;
      mesh.customDepthMaterial!.opacity = opacity;
      mesh.visible = opacity > 0.001;
    }
  };
  const renderAO = ao.render.bind(ao);
  const withoutFaders = target();
  ao.render = (renderer, writeBuffer, ...rest) => {
    renderAO(renderer, writeBuffer, ...rest);
    const partial = faders.filter(
      (m) => m.visible && materialsOf(m)[0].opacity < 1,
    );
    if (!partial.length) return;
    for (const m of partial) m.visible = false;
    renderAO(renderer, withoutFaders, ...rest);
    for (const m of partial) m.visible = true;
    const opacity = Math.min(...partial.map((m) => materialsOf(m)[0].opacity));
    accumulateMaterial.uniforms.tSample.value = withoutFaders.texture;
    accumulateMaterial.uniforms.weight.value = 1 - opacity;
    renderer.autoClear = false;
    renderer.setRenderTarget(writeBuffer);
    accumulate.render(renderer);
    renderer.autoClear = true;
  };

  const sat = new THREE.Group();
  sat.position.y = -150;
  scene.add(sat);

  const nodes = {} as Record<Part, THREE.Object3D>;
  const restBoxes = {} as Record<Part, THREE.Box3>;
  const restY = {} as Record<Part, number>;
  const frameMeshes: THREE.Mesh[] = [];
  const panels = solarPanels(renderer.capabilities.getMaxAnisotropy());
  for (const { mesh } of panels) {
    makeFadeable(mesh);
    sat.add(mesh);
  }

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync("/models/pixelsat.glb");
  const finished = new Set<THREE.Material>();
  gltf.scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    for (const m of materialsOf(o)) {
      if (finished.has(m)) continue;
      finished.add(m);
      finishMaterial(m as THREE.MeshStandardMaterial);
    }
  });
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

  const focusA = new THREE.Vector3();
  const focusB = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const lightDir = new THREE.Vector3();
  const disc = new THREE.Vector3();

  // Draws sample k of segment i at progress t (k = 0 is unjittered) and
  // blends it into the running average with the given weight.
  // Poses the scene and camera for sample k of segment i at progress t.
  const place = (i: number, t: number, k: number) => {
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

    const az = THREE.MathUtils.degToRad(lerp(a.az, b.az, t));
    scene.environmentRotation.y = az;
    const el = THREE.MathUtils.degToRad(lerp(a.el, b.el, t));
    const dist = lerp(a.dist, b.dist, t);
    offset.set(
      Math.cos(el) * Math.sin(az),
      Math.sin(el),
      Math.cos(el) * Math.cos(az),
    );
    camera.position.copy(focus).addScaledVector(offset, dist);
    camera.lookAt(focus);

    // Jittering the key light's direction across a small disc, sample by
    // sample, averages its hard shadow into a soft area-light one.
    const spread = k ? 0.07 * Math.sqrt(halton(k, 5)) : 0;
    const turn = 2 * Math.PI * halton(k, 7);
    lightDir
      .set(-0.6, 1, 0.7)
      .normalize()
      .add(disc.set(Math.cos(turn), Math.sin(turn), 0).multiplyScalar(spread))
      .applyQuaternion(camera.quaternion)
      .normalize();
    key.position.copy(focus).addScaledVector(lightDir, 800);
    key.target.position.copy(focus);
    // Cover the whole frame, not just one viewport's worth of it.
    const extent = dist * 0.4 * Math.max(1, height / base);
    Object.assign(key.shadow.camera, {
      left: -extent,
      right: extent,
      top: extent,
      bottom: -extent,
    });
    key.shadow.camera.updateProjectionMatrix();

    camera.rotateZ(THREE.MathUtils.degToRad(lerp(a.roll, b.roll, t)));

    // Sub-pixel jitter.
    const jitterX = k ? halton(k, 2) - 0.5 : 0;
    const jitterY = k ? halton(k, 3) - 0.5 : 0;
    camera.setViewOffset(width, height, jitterX, jitterY, width, height);
  };

  // Draws sample k (k = 0 is unjittered) and blends it into the running
  // average with the given weight.
  const frameAt = (i: number, t: number, k: number, weight: number) => {
    place(i, t, k);

    rollNoise(k);
    renderer.shadowMap.needsUpdate = true;
    composer.render();
    accumulateMaterial.uniforms.tSample.value = composer.readBuffer.texture;
    accumulateMaterial.uniforms.weight.value = weight;
    // Blend onto the running average rather than clearing it first.
    renderer.autoClear = false;
    renderer.setRenderTarget(accumulated);
    accumulate.render(renderer);
    renderer.autoClear = true;
  };

  // Corners of everything visible, projected to frame pixels, for measuring
  // how far the view moves between two poses. Corners off the frame are NaN.
  const corner = new THREE.Vector3();
  const box = new THREE.Box3();
  const project = (i: number, t: number) => {
    place(i, t, 0);
    sat.updateMatrixWorld(true);
    camera.updateMatrixWorld();
    const points: number[] = [];
    const objects = [
      ...Object.values(nodes),
      ...panels.map((p) => p.mesh),
      ...frameMeshes,
    ];
    for (const o of objects) {
      const faded = o instanceof THREE.Mesh && materialsOf(o)[0].opacity < 0.05;
      box.setFromObject(o);
      for (let c = 0; c < 8; c++) {
        corner
          .set(
            c & 1 ? box.max.x : box.min.x,
            c & 2 ? box.max.y : box.min.y,
            c & 4 ? box.max.z : box.min.z,
          )
          .project(camera);
        const x = ((corner.x + 1) / 2) * width;
        const y = ((1 - corner.y) / 2) * height;
        const inside = !faded && x >= 0 && x <= width && y >= 0 && y <= height;
        points.push(inside ? x : NaN, inside ? y : NaN);
      }
    }
    return points;
  };

  return {
    // Renders segment i at progress t, averaging `samples` samples, onto the
    // canvas.
    render(i: number, t: number, samples: number) {
      for (let k = 0; k < samples; k++) frameAt(i, t, k, 1 / (k + 1));
      output.render(renderer, null!, accumulated, 0, false);
    },
    project,
  };
}
