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
const GOLD: Finish = {
  color: "#c9a45a",
  coat: 0,
  rough: 0.3,
  metal: 1,
  height: 0.3,
};

function solarPanelMaps(anisotropy: number) {
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
  const circle =
    (x: number, y: number, r: number) => (ctx: CanvasRenderingContext2D) =>
      ctx.arc(x, y, r, 0, Math.PI * 2);
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

  // A few traces under the soldermask, from the end pads to the sensors.
  const trace = { ...SOLDERMASK, color: "#111216", height: 0.26 };
  paint(trace, rect(40.6, 12, 0.8, 30));
  paint(trace, rect(20, 41.2, 21.4, 0.8));
  paint(trace, rect(55, 22, 0.6, 20));

  // Mounting holes in the corners.
  for (const x of [4.5, PANEL.w - 4.5]) {
    for (const y of [4.5, PANEL.h - 4.5]) {
      paint({ ...SILVER, rough: 0.4, height: 0.3 }, circle(x, y, 3));
      paint(
        { color: "#050506", coat: 0, rough: 1, metal: 0, height: 0 },
        circle(x, y, 1.7),
      );
    }
  }

  // Four 80 × 40 mm triple-junction cells in series, with welded silver
  // interconnects across each gap.
  const cell = { w: 80, h: 40, gap: 2.5, crop: 5 };
  const cellX = (PANEL.w - cell.w) / 2;
  const stack = 4 * cell.h + 3 * cell.gap;
  const cellsTop = (PANEL.h - stack) / 2;
  const tabs = [12, 38.5, 65];
  // Tabs from the first cell's back to a pad on the board.
  for (const tx of tabs) {
    paint(GOLD, rect(cellX + tx - 1, cellsTop - 6, 7, 4.5));
    paint(SILVER, rect(cellX + tx, cellsTop - 5, 5, 7));
  }
  for (let i = 0; i < 4; i++) {
    const y = cellsTop + i * (cell.h + cell.gap);
    const lightness = 12 + (random() - 0.5) * 1.6;
    const hue = 231 + (random() - 0.5) * 6;
    const glass = 0.35;
    paint(
      { color: "#161a2c", coat: 1, rough: 0.05, metal: 0, height: 0.62 },
      croppedCell(
        cellX - glass,
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
      croppedCell(cellX, y, cell.w, cell.h, cell.crop),
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
    for (let fx = cellX + 1.2; fx < cellX + cell.w - 1; fx += 1.4) {
      const top = fx < cellX + cell.crop || fx > cellX + cell.w - cell.crop;
      paint(finger, rect(fx, y + (top ? cell.crop : 0.8), 0.12, cell.h - 2.6));
    }
    // Busbar along the uncropped edge, and the bypass diode sitting in a
    // cropped corner.
    paint(
      { ...SILVER, coat: 1, height: 0.66 },
      rect(cellX + 1, y + cell.h - 2, cell.w - 2, 1.4),
    );
    paint(
      { color: "#1b1b1f", coat: 0, rough: 0.35, metal: 0.3, height: 0.7 },
      rect(cellX + 0.6, y + 0.6, 2.2, 2.2),
    );
    paint(SILVER, rect(cellX + 2.8, y + 1.3, 2, 0.8));
    // Interconnects from this cell's busbar down to the next cell (or to the
    // board after the last one). The next cell covers their far ends.
    for (const tx of tabs) {
      const end = i < 3 ? cell.gap + 2 : 5;
      paint(SILVER, rect(cellX + tx, y + cell.h - 2, 5, end + 2));
      // Stress-relief loop in the middle of the gap.
      paint(
        { ...SILVER, color: "#8f929a", height: 0.95 },
        rect(cellX + tx, y + cell.h + cell.gap / 2 - 0.4, 5, 0.8),
      );
      if (i === 3) paint(GOLD, rect(cellX + tx - 1, y + cell.h + 1.5, 7, 4.5));
    }
  }

  // BPW34 sun-sensor photodiode and a thermistor at the top end.
  const pd = { x: PANEL.w / 2, y: 28 };
  paint(GOLD, rect(pd.x - 4.2, pd.y - 1.4, 8.4, 2.8));
  paint(
    { color: "#16161a", coat: 1, rough: 0.08, metal: 0, height: 1 },
    rect(pd.x - 2.7, pd.y - 2.15, 5.4, 4.3),
  );
  paint(
    { color: "#2a2638", coat: 1, rough: 0.1, metal: 0.2, height: 1 },
    rect(pd.x - 1.4, pd.y - 1.4, 2.8, 2.8),
  );
  paint(SILVER, rect(pd.x - 1.4, pd.y - 1.4, 0.5, 0.5));
  paint(GOLD, rect(54.4, 20, 2.2, 1.2));
  paint(
    { color: "#1d1d1d", coat: 0, rough: 0.6, metal: 0, height: 0.6 },
    rect(54.9, 20, 1.2, 1.2),
  );

  // Silkscreen and fiducials.
  const silk = {
    color: "#d9d9d2",
    coat: 0,
    rough: 0.7,
    metal: 0,
    height: 0.28,
  };
  for (const ctx of [albedo, surface, height]) {
    ctx.font = "600 3px sans-serif";
    ctx.textBaseline = "middle";
  }
  const text = (s: string, x: number, y: number, align: CanvasTextAlign) =>
    paint(silk, (ctx) => {
      ctx.textAlign = align;
      ctx.fillText(s, x, y);
    });
  text("PIXELSAT-I", 10, 12, "left");
  text("SP REV B", PANEL.w - 10, 12, "right");
  text("SUN", pd.x, pd.y + 5, "center");
  text("TJ 4S", 10, PANEL.h - 12, "left");
  for (const [x, y] of [
    [16, 28],
    [PANEL.w - 16, PANEL.h - 22],
  ]) {
    paint(GOLD, circle(x, y, 0.5));
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
  // The panels see these bands at a grazing angle, where the coverglass
  // reflects most of what it sees, so they stretch along whole cells. Any
  // wider or brighter and they wash the dark cells out to a pale grey.
  band(-1.8, 0.2, 0.8);
  band(-3.6, 0.2, 1.6);
  band(6, 4, 0.12);
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
    envMapIntensity: 0.8,
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
  // GTAO renders the scene a second time; without this the shadow map would
  // be redrawn for it too. frameAt flags the one update per frame.
  renderer.shadowMap.autoUpdate = false;
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
  ao.render = (...args: Parameters<GTAOPass["render"]>) => {
    const hidden = faders.filter(
      (m) => m.visible && materialsOf(m)[0].opacity < 1,
    );
    for (const m of hidden) m.visible = false;
    renderAO(...args);
    for (const m of hidden) m.visible = true;
  };

  let dirty = true;
  const sat = new THREE.Group();
  sat.position.y = -150;
  scene.add(sat);

  const nodes = {} as Record<Part, THREE.Object3D>;
  const restBoxes = {} as Record<Part, THREE.Box3>;
  const restY = {} as Record<Part, number>;
  const frameMeshes: THREE.Mesh[] = [];
  const studio = studioEnvironment(pmrem);
  const panels = solarPanels(renderer.capabilities.getMaxAnisotropy());
  for (const { mesh } of panels) {
    for (const m of materialsOf(mesh))
      (m as THREE.MeshStandardMaterial).envMap = studio;
    makeFadeable(mesh);
    sat.add(mesh);
  }

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.load(
    "/models/pixelsat.glb",
    (gltf) => {
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
      dirty = true;
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
    dirty = true;
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

    renderer.shadowMap.needsUpdate = true;
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
    // A zero-size viewport (e.g. a hidden iframe) would make this NaN.
    if (!(segment > 0)) return 0;
    const scrolled = -story.getBoundingClientRect().top;
    return Math.min(poses.length - 1, Math.max(0, scrolled / segment));
  };

  // Only draw when something changed: scroll is still easing, the hero is
  // swaying, or the canvas or model changed (dirty).
  let s = target();
  let drawn = NaN;
  const tick = (time: number) => {
    if (!running) return;
    const goal = target();
    s =
      reducedMotion || Math.abs(goal - s) < 1e-4 ? goal : s + (goal - s) * 0.12;
    const swaying = !reducedMotion && s < 1;
    if (s !== drawn) updateCopy(s);
    if (dirty || swaying || s !== drawn) {
      frameAt(s, time);
      drawn = s;
      dirty = false;
    }
    requestAnimationFrame(tick);
  };

  new IntersectionObserver(([entry]) => {
    const wasRunning = running;
    running = entry.isIntersecting;
    if (running && !wasRunning) requestAnimationFrame(tick);
  }).observe(story);

  updateCopy(s);
}
