// Renders story frames in Blender Cycles (scene.py). Needs `blender` on the
// PATH (brew install --cask blender).

import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PARTS, POSE_LIST } from "../../src/scripts/story.ts";
import { root } from "./page.mjs";

// The solar panel's texture maps, drawn by the three.js renderer's code in
// the page so both renderers use the same ones. Returns their paths.
export async function exportPanelMaps(page, dir) {
  await mkdir(dir, { recursive: true });
  const maps = await page.evaluate(() => window.panelMaps());
  const paths = {};
  for (const [name, url] of Object.entries(maps)) {
    paths[name] = path.join(dir, `panel-${name}.png`);
    await writeFile(paths[name], Buffer.from(url.split(",")[1], "base64"));
  }
  return paths;
}

// Renders `shots` ({ i, t } story positions) at the frame size of `frame`
// ({ width, height, base }), working in `dir`. Calls onFrame(k, rgb, width,
// height) with raw 8-bit RGB for each shot in turn, while the next renders.
// `options` go into scene.py's job file (samples, percent, ...).
export async function renderCycles({
  frame,
  shots,
  panelMaps,
  dir,
  options,
  onFrame,
}) {
  await mkdir(dir, { recursive: true });
  const outs = shots.map((_, k) => path.join(dir, `${k}.rgb`));
  const jobPath = path.join(dir, "job.json");
  await writeFile(
    jobPath,
    JSON.stringify({
      model: path.join(root, "public/models/pixelsat.glb"),
      panelMaps,
      poses: POSE_LIST,
      parts: PARTS,
      ...frame,
      ...options,
      shots: shots.map(({ i, t }, k) => ({ i, t, out: outs[k] })),
    }),
  );

  // Frames are handed on in order; onFrame for one overlaps the next render.
  let queue = Promise.resolve();
  let failed;
  const blender = spawn(
    "blender",
    [
      "-b",
      "--factory-startup",
      "--python-exit-code",
      "1",
      "-P",
      path.join(import.meta.dirname, "scene.py"),
      "--",
      jobPath,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  // Take Blender down too if this is interrupted.
  const stop = () => blender.kill();
  const interrupted = (signal) => {
    stop();
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  process.on("exit", stop);
  process.on("SIGINT", interrupted);
  process.on("SIGTERM", interrupted);
  // Blender's own chatter is kept only to show if it fails.
  const log = [];
  const keep = (line) => {
    log.push(line);
    if (log.length > 60) log.shift();
  };
  let buffered = "";
  blender.stdout.on("data", (chunk) => {
    buffered += chunk;
    const lines = buffered.split("\n");
    buffered = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("FRAME ")) {
        keep(line);
        continue;
      }
      const { out, width, height } = JSON.parse(line.slice(6));
      const k = outs.indexOf(out);
      queue = queue.then(async () => {
        if (failed) return;
        try {
          const rgb = await readFile(out);
          await rm(out);
          await onFrame(k, rgb, width, height);
        } catch (e) {
          failed ??= e;
          blender.kill();
        }
      });
    }
  });
  blender.stderr.on("data", (chunk) => String(chunk).split("\n").forEach(keep));
  const code = await new Promise((resolve, reject) => {
    blender.on("exit", resolve);
    blender.on("error", (e) =>
      reject(
        e.code === "ENOENT"
          ? new Error("blender not found: brew install --cask blender")
          : e,
      ),
    );
  });
  process.off("exit", stop);
  process.off("SIGINT", interrupted);
  process.off("SIGTERM", interrupted);
  await queue;
  if (failed) throw failed;
  if (code !== 0) {
    console.error(log.join("\n"));
    throw new Error(`blender exited with ${code}`);
  }
}
