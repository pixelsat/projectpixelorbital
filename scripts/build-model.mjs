// Converts the Fusion FBX export into public/models/pixelsat.glb.
//
//   pnpm build-model path/to/Master.fbx
//
// Each part the landing page animates becomes its own node (named below);
// everything else is merged into "frame". Meshes are welded, simplified,
// quantized, and meshopt-compressed, taking ~80 MB of FBX to ~4 MB.
// If the CAD hierarchy is renamed, update the node names in `parts`.
import fs from "node:fs";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { Document, NodeIO } from "@gltf-transform/core";
import {
  EXTMeshoptCompression,
  KHRMeshQuantization,
} from "@gltf-transform/extensions";
import {
  dedup,
  meshopt,
  prune,
  simplify,
  weld,
} from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";

const input = process.argv[2];
const output = "public/models/pixelsat.glb";
// Simplification error relative to each mesh's size. 0.001 was visually
// indistinguishable from the unsimplified model at the page's close-ups.
const error = 0.001;

if (!input) {
  console.error("usage: pnpm build-model path/to/Master.fbx");
  process.exit(1);
}

const buf = fs.readFileSync(input);
const root = new FBXLoader().parse(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  "",
);
// The CAD is Z-up in millimetres; three.js is Y-up.
root.rotation.x = -Math.PI / 2;
root.updateMatrixWorld(true);

const byName = (name) => {
  const found = root.getObjectByName(name);
  if (!found) throw new Error(`No "${name}" in ${input}`);
  return found;
};
const parts = {
  torquers: byName("Torquers1"),
  battery: byName("Battery_Pack_v61"),
  power: byName("power_v11"),
  mppt: byName("mppt_v11"),
  obc: byName("mainboard_v11"),
  comms: byName("transceiver_v21"),
  antenna: byName("S-Band_Antenna_Approximation_v51"),
};
const claimed = new Set(Object.values(parts));
const frame = [];
root.traverse((o) => {
  if (!o.isMesh) return;
  let p = o;
  while (p && !claimed.has(p)) p = p.parent;
  if (!p) frame.push(o);
});

const metal = /Aluminum|Steel|Titanium|Brass|Copper/;
const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene();
const materials = new Map();
const getMaterial = (m) => {
  if (!materials.has(m.name)) {
    materials.set(
      m.name,
      doc
        .createMaterial(m.name)
        .setBaseColorFactor([
          ...m.color.clone().convertSRGBToLinear().toArray(),
          1,
        ])
        .setMetallicFactor(metal.test(m.name) ? 0.9 : 0.05)
        .setRoughnessFactor(
          /Polished/.test(m.name) ? 0.25 : metal.test(m.name) ? 0.4 : 0.6,
        ),
    );
  }
  return materials.get(m.name);
};

const concat = (arrays) => {
  const out = new Float32Array(arrays.reduce((n, a) => n + a.length, 0));
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
};

// Bakes every mesh under `objects` into world space, one primitive per
// material.
const addNode = (name, objects) => {
  const byMaterial = new Map();
  for (const object of objects) {
    object.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      const mats = [].concat(mesh.material);
      const groups = g.groups.length
        ? g.groups
        : [{ start: 0, count: g.attributes.position.count, materialIndex: 0 }];
      for (const group of groups) {
        const m = mats[group.materialIndex ?? 0];
        if (!byMaterial.has(m.name))
          byMaterial.set(m.name, { m, pos: [], nor: [] });
        const entry = byMaterial.get(m.name);
        const range = [group.start * 3, (group.start + group.count) * 3];
        entry.pos.push(g.attributes.position.array.subarray(...range));
        entry.nor.push(g.attributes.normal.array.subarray(...range));
      }
    });
  }
  const mesh = doc.createMesh(name);
  for (const { m, pos, nor } of byMaterial.values()) {
    const attribute = (arrays) =>
      doc
        .createAccessor()
        .setType("VEC3")
        .setArray(concat(arrays))
        .setBuffer(buffer);
    mesh.addPrimitive(
      doc
        .createPrimitive()
        .setAttribute("POSITION", attribute(pos))
        .setAttribute("NORMAL", attribute(nor))
        .setMaterial(getMaterial(m)),
    );
  }
  scene.addChild(doc.createNode(name).setMesh(mesh));
};

for (const [name, object] of Object.entries(parts)) addNode(name, [object]);
addNode("frame", frame);

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
doc.createExtension(KHRMeshQuantization);
await doc.transform(
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: 0, error }),
  dedup(),
  prune(),
  meshopt({ encoder: MeshoptEncoder, level: "medium" }),
);

await new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder })
  .write(output, doc);
console.log(`${output}: ${(fs.statSync(output).size / 1e6).toFixed(1)} MB`);
