// Renders a few shots of the satellite story in Cycles, for checking the
// look without a full render-frames run.
//
//   npm run render-shots -- [options]
//
//   --shots 0,0.5,1     story positions: chapter k is fully shown at k, and
//                       k + t is progress t (eased) towards chapter k + 1;
//                       default: every chapter
//   --samples 256       Cycles samples per pixel
//   --percent 100       render size, for quick looks
//   --portrait          the portrait frame instead of the landscape one
//   --compare           also render with three.js, and put the two side by
//                       side in compare-*.jpg
//   --compare-only      just redo compare-*.jpg from earlier renders
//   --extra '{...}'     more options for scene.py's job file
//   --out dir           default /tmp/story-shots

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { CHAPTERS, POSE_LIST } from "../../src/scripts/story.ts";
import { exportPanelMaps, renderCycles } from "./cycles.mjs";
import { openPage } from "./page.mjs";

const { values: args } = parseArgs({
  options: {
    shots: { type: "string" },
    samples: { type: "string", default: "256" },
    percent: { type: "string", default: "100" },
    portrait: { type: "boolean", default: false },
    compare: { type: "boolean", default: false },
    "compare-only": { type: "boolean", default: false },
    extra: { type: "string", default: "{}" },
    out: { type: "string", default: "/tmp/story-shots" },
  },
});

const segments = POSE_LIST.length - 1;
const frame = args.portrait
  ? { width: 1400, height: 3600, base: 1000 }
  : { width: 3840, height: 2000, base: 1600 };
const shots = (
  args.shots?.split(",").map(Number) ?? CHAPTERS.map((_, k) => k)
).map((s) => {
  const i = Math.min(segments - 1, Math.floor(s));
  return { i, t: s - i, name: String(s).replace(".", "_") };
});
const out = path.resolve(args.out);
const file = (dir, shot) => path.join(out, dir, `${shot.name}.png`);

if (!args["compare-only"]) await render();
if (args.compare || args["compare-only"]) await compare();

async function render() {
  await mkdir(path.join(out, "cycles"), { recursive: true });
  const { page, close } = await openPage();
  let panelMaps;
  try {
    panelMaps = await exportPanelMaps(page, path.join(out, "work"));
    if (args.compare) {
      await mkdir(path.join(out, "three"), { recursive: true });
      await page.evaluate((o) => window.setup(o), frame);
      for (const shot of shots) {
        const png = await page.evaluate(
          ([i, t]) => window.renderFrame(i, t, 32),
          [shot.i, shot.t],
        );
        await sharp(Buffer.from(png, "base64"))
          .removeAlpha()
          .toFile(file("three", shot));
      }
    }
  } finally {
    await close();
  }
  await renderCycles({
    frame,
    shots,
    panelMaps,
    dir: path.join(out, "work"),
    options: {
      samples: Number(args.samples),
      percent: Number(args.percent),
      ...JSON.parse(args.extra),
    },
    onFrame: async (k, rgb, width, height) => {
      await sharp(rgb, { raw: { width, height, channels: 3 } }).toFile(
        file("cycles", shots[k]),
      );
      console.log(`rendered ${file("cycles", shots[k])}`);
    },
  });
}

// three.js left, Cycles right, both cropped to what's in either.
async function compare() {
  const width = Math.round((frame.width * Number(args.percent)) / 100);
  const height = Math.round((frame.height * Number(args.percent)) / 100);
  for (const shot of shots) {
    const images = await Promise.all(
      ["three", "cycles"].map((dir) =>
        sharp(file(dir, shot))
          .resize(width, height, { fit: "fill" })
          .png()
          .toBuffer(),
      ),
    );
    const boxes = await Promise.all(
      images.map(async (input) => {
        const { info } = await sharp(input)
          .trim({ background: "#000", threshold: 8 })
          .toBuffer({ resolveWithObject: true });
        const left = -info.trimOffsetLeft;
        const top = -info.trimOffsetTop;
        return [left, top, left + info.width, top + info.height];
      }),
    );
    const pad = 24;
    const x0 = Math.max(0, Math.min(...boxes.map((b) => b[0])) - pad);
    const y0 = Math.max(0, Math.min(...boxes.map((b) => b[1])) - pad);
    const x1 = Math.min(width, Math.max(...boxes.map((b) => b[2])) + pad);
    const y1 = Math.min(height, Math.max(...boxes.map((b) => b[3])) + pad);
    const region = { left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
    const crops = await Promise.all(
      images.map((input) => sharp(input).extract(region).toBuffer()),
    );
    await sharp({
      create: {
        width: region.width * 2,
        height: region.height,
        channels: 3,
        background: "#000",
      },
    })
      .composite(
        crops.map((input, k) => ({ input, left: k * region.width, top: 0 })),
      )
      .jpeg({ quality: 92 })
      .toFile(path.join(out, `compare-${shot.name}.jpg`));
  }
  console.log(`wrote ${out}/compare-*.jpg`);
}
