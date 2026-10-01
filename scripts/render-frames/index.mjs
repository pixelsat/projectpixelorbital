// Pre-renders the homepage's satellite story into image sequences that
// src/scripts/story-player.ts plays back on scroll, the way Apple's product
// pages do: no 3D runs in the browser.
//
//   npm run render-frames                  full render in Cycles (hours)
//   npm run render-frames -- --quick       few samples, for checking framing
//   npm run render-frames -- --frames 0,40 only these frames, into /tmp
//   npm run render-frames -- --renderer three
//                                          render with three.js instead
//                                          (minutes, lower quality)
//   --samples N, --quality Q (WebP)
//   --restart                              re-render frames already done
//
// An interrupted render picks up where it left off: frames already in
// public/story.partial (or /tmp/story-frames.partial) are kept as long as
// the renderer, its settings, the poses, the frame positions, the model and
// the renderer's source (scene.py or renderer.ts) are unchanged. Changes to
// anything else, such as the cropping below, need --restart.
//
// Frames are rendered in Blender Cycles (scene.py, via cycles.mjs), or with
// three.js in Chrome (renderer.ts). Chrome also works out where the frames
// go and draws the solar panel maps (main.ts). Frames are then cropped,
// scaled and encoded with sharp. Writes public/story/<sequence>/ and
// src/data/story-frames.json.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { CHAPTERS, POSE_LIST } from "../../src/scripts/story.ts";
import { exportPanelMaps, renderCycles } from "./cycles.mjs";
import { openPage, root } from "./page.mjs";

const { values: args } = parseArgs({
  options: {
    quick: { type: "boolean", default: false },
    frames: { type: "string" },
    samples: { type: "string" },
    quality: { type: "string" },
    renderer: { type: "string", default: "cycles" },
    restart: { type: "boolean", default: false },
  },
});
const cycles = args.renderer === "cycles";
if (!cycles && args.renderer !== "three")
  throw new Error(`--renderer must be cycles or three, not ${args.renderer}`);

// Frames are spaced so nothing visible moves more than about STEP pixels (of
// the first render below) from one frame to the next: the player crossfades
// neighbouring frames while scrolling, and frames further apart than this
// show a double image. Each segment gets at least MIN_PER_SEGMENT.
const STEP = 28;
const MIN_PER_SEGMENT = 8;
// Cycles samples are per pixel (adaptive, then denoised); three.js samples
// are whole jittered frames averaged together.
const SAMPLES = Number(
  args.samples ?? (cycles ? (args.quick ? 16 : 256) : args.quick ? 4 : 32),
);
const QUALITY = Number(args.quality ?? 72);
// Anything this bright or dimmer (of 255) counts as empty background when
// cropping.
const BLACK = 2;

// What gets rendered, and the sequences cut from each render. Landscape
// frames reach 12.5% past a viewport's top and bottom so screens down to
// square, which shrink the model (see placement() in src/scripts/story.ts),
// never see the frame's edge, and 1.2 viewport heights either side of the
// model for wide screens. Portrait frames are for phones, where the model
// shrinks by up to about 2.4 and shifts up or down by a quarter of the
// viewport.
const RENDERS = [
  {
    width: 3840,
    height: 2000,
    base: 1600,
    sequences: [
      { name: "l1600", scale: 1 },
      { name: "l800", scale: 0.5 },
    ],
  },
  {
    width: 1400,
    height: 3600,
    base: 1000,
    sequences: [{ name: "p1000", scale: 1 }],
  },
];

const segments = CHAPTERS.length - 1;
const only = args.frames?.split(",").map(Number);
const finalDir = only ? "/tmp/story-frames" : path.join(root, "public/story");
// Render next to the final directory and swap it in at the end, so an
// interrupted render leaves the previous frames and manifest untouched.
const outDir = `${finalDir}.partial`;
const workDir = path.join(os.tmpdir(), "pixelsat-render-frames");
// Frames finished so far in outDir, and what they were rendered with.
const progressPath = path.join(outDir, "progress.json");
const frameFile = (f) => `${String(f).padStart(3, "0")}.webp`;

// Identifies what frames look like, to tell whether ones already rendered
// can be kept.
async function renderKey(positions) {
  const hash = createHash("sha256");
  hash.update(
    JSON.stringify({
      renderer: args.renderer,
      SAMPLES,
      QUALITY,
      positions,
      POSE_LIST,
      RENDERS,
    }),
  );
  const sources = [
    "public/models/pixelsat.glb",
    "scripts/render-frames/renderer.ts",
    cycles ? "scripts/render-frames/scene.py" : "scripts/render-frames/main.ts",
  ];
  for (const file of sources)
    hash.update(await readFile(path.join(root, file)));
  return hash.digest("hex");
}

// Fades the outermost strip of a frame (raw pixels, in place) to black, so a
// part running off the frame's edge dissolves instead of being cut, should a
// screen ever show that far. Returns the part of the frame with anything in
// as [x, y, w, h], padded and aligned to 4 px so half- and quarter-size
// copies line up exactly.
function fadeAndCrop(pixels, { width, height, channels }, base) {
  const fade = Math.round(base * 0.075);
  const ramp = (n) =>
    Float32Array.from({ length: n }, (_, k) =>
      Math.min(1, (k + 0.5) / fade, (n - k - 0.5) / fade),
    );
  const fx = ramp(width);
  const fy = ramp(height);
  let x0 = width;
  let y0 = height;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0, p = 0; y < height; y++) {
    for (let x = 0; x < width; x++, p += channels) {
      const f = fx[x] * fy[y];
      let lit = false;
      for (let c = 0; c < 3; c++) {
        const v = Math.round(pixels[p + c] * f);
        pixels[p + c] = v;
        if (v > BLACK) lit = true;
      }
      if (lit) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  const pad = 4;
  const snap = (v, up) => Math.max(0, (up ? Math.ceil : Math.floor)(v / 4) * 4);
  x0 = snap(x0 - pad, false);
  y0 = snap(y0 - pad, false);
  x1 = Math.min(width, snap(x1 + 1 + pad, true));
  y1 = Math.min(height, snap(y1 + 1 + pad, true));
  if (x1 <= x0) [x0, y0, x1, y1] = [0, 0, 4, 4];
  return [x0, y0, x1 - x0, y1 - y0];
}

const { page, close } = await openPage();
try {
  // Where each frame sits in the story, as segment + eased progress t.
  const { width, height, base } = RENDERS[0];
  await page.evaluate((o) => window.setup(o), { width, height, base });
  const positions = await page.evaluate(
    ([segments, step, least]) => {
      const out = [];
      const n = 512;
      for (let i = 0; i < segments; i++) {
        // Distance moved from the start of the segment, then frames at
        // even steps of it.
        const moved = [0];
        for (let q = 0; q < n; q++)
          moved.push(moved[q] + window.motion(i, q / n, (q + 1) / n));
        const count = Math.max(least, Math.ceil(moved[n] / step));
        for (let k = 0, q = 0; k < count; k++) {
          const at = (moved[n] * k) / count;
          while (moved[q + 1] < at) q++;
          const span = moved[q + 1] - moved[q];
          out.push(i + (q + (span ? (at - moved[q]) / span : 0)) / n);
        }
      }
      out.push(segments);
      return out.map((g) => Math.round(g * 1e5) / 1e5);
    },
    [segments, STEP, MIN_PER_SEGMENT],
  );
  const indices = only ?? [...positions.keys()];
  const shotAt = (f) => {
    const i = Math.min(segments - 1, Math.floor(positions[f]));
    return { i, t: positions[f] - i };
  };
  console.log(
    `${positions.length} frames, rendering ${indices.length} in ` +
      `${cycles ? "Cycles" : "three.js"} at ${SAMPLES} samples each`,
  );

  // Keep what an interrupted render with the same settings got through.
  const key = await renderKey(positions);
  let progress = existsSync(progressPath)
    ? JSON.parse(await readFile(progressPath, "utf8"))
    : null;
  if (args.restart || progress?.key !== key) {
    if (progress) console.log("discarding frames from an earlier render");
    await rm(outDir, { recursive: true, force: true });
    progress = { key, rects: {} };
  }
  await mkdir(outDir, { recursive: true });
  const saveProgress = async () => {
    await writeFile(`${progressPath}.tmp`, JSON.stringify(progress));
    await rename(`${progressPath}.tmp`, progressPath);
  };
  await saveProgress();
  let panelMaps;

  const sequences = [];
  for (const render of RENDERS) {
    const { width, height, base } = render;
    const frame = { width, height, base };
    const outputs = render.sequences.map((s) => ({
      name: s.name,
      scale: s.scale,
      base: base * s.scale,
      width: width * s.scale,
      height: height * s.scale,
      rects: [],
    }));
    for (const o of outputs) {
      await mkdir(path.join(outDir, o.name), { recursive: true });
      progress.rects[o.name] ??= {};
    }
    // Frames done when every sequence has them.
    const todo = indices.filter(
      (f) =>
        !outputs.every(
          (o) =>
            progress.rects[o.name][f] &&
            existsSync(path.join(outDir, o.name, frameFile(f))),
        ),
    );
    if (todo.length < indices.length)
      console.log(
        `${width}×${height}: ${indices.length - todo.length} frames ` +
          `already rendered, ${todo.length} to go`,
      );
    const shots = todo.map(shotAt);
    if (cycles && todo.length && !panelMaps)
      panelMaps = await exportPanelMaps(page, workDir);

    // Crops, scales and encodes frame k of `todo`.
    const started = Date.now();
    let done = 0;
    const encode = async (k, pixels, info) => {
      const f = todo[k];
      const rect = fadeAndCrop(pixels, info, base);
      const [left, top, w, h] = rect;
      const cropped = await sharp(pixels, { raw: info })
        .extract({ left, top, width: w, height: h })
        .toBuffer();
      for (const o of outputs) {
        const scaled = rect.map((v) => v * o.scale);
        const image = sharp(cropped, {
          raw: { width: w, height: h, channels: info.channels },
        });
        if (o.scale !== 1)
          image.resize(scaled[2], scaled[3], { kernel: "lanczos3" });
        const webp = await image
          .webp({ quality: QUALITY, effort: 6, smartSubsample: true })
          .toBuffer();
        await writeFile(path.join(outDir, o.name, frameFile(f)), webp);
      }
      // Only once every sequence has the frame.
      for (const o of outputs)
        progress.rects[o.name][f] = rect.map((v) => v * o.scale);
      await saveProgress();
      done++;
      const each = (Date.now() - started) / done / 1000;
      process.stdout.write(
        `\r${width}×${height}: frame ${done}/${todo.length}, ` +
          `${each.toFixed(1)} s each, ` +
          `${Math.round((each * (todo.length - done)) / 60)} min left   `,
      );
    };

    if (!todo.length) {
      // Nothing left to render at this size.
    } else if (cycles) {
      await renderCycles({
        frame,
        shots,
        panelMaps,
        dir: path.join(workDir, `${width}x${height}`),
        options: { samples: SAMPLES },
        onFrame: (k, rgb, w, h) =>
          encode(k, rgb, { width: w, height: h, channels: 3 }),
      });
    } else {
      await page.evaluate((o) => window.setup(o), frame);
      for (const [k, { i, t }] of shots.entries()) {
        const png = await page.evaluate(
          ([i, t, samples]) => window.renderFrame(i, t, samples),
          [i, t, SAMPLES],
        );
        const { data, info } = await sharp(Buffer.from(png, "base64"))
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        await encode(k, data, info);
      }
    }
    if (todo.length) process.stdout.write("\n");
    for (const o of outputs)
      o.rects = indices.map((f) => progress.rects[o.name][f]);
    sequences.push(...outputs.map(({ scale: _, ...sequence }) => sequence));
  }

  // The version changes whenever any frame does.
  const hash = createHash("sha256");
  for (const { name } of sequences)
    for (const f of indices)
      hash.update(await readFile(path.join(outDir, name, frameFile(f))));
  const manifest = {
    chapters: CHAPTERS,
    positions,
    ext: "webp",
    version: hash.digest("hex").slice(0, 10),
    sequences,
  };
  await rm(progressPath);
  await rm(finalDir, { recursive: true, force: true });
  await rename(outDir, finalDir);
  const manifestPath = only
    ? path.join(finalDir, "story-frames.json")
    : path.join(root, "src/data/story-frames.json");
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest) + "\n");
  console.log(`wrote ${finalDir} and ${manifestPath}`);
} finally {
  await close();
}
