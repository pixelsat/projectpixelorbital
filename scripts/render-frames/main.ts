import {
  createRenderer,
  solarPanelMaps,
  type RenderOptions,
} from "./renderer.ts";

// Driven by index.mjs and shots.mjs through the functions on window: frame
// positions (motion), the solar panel maps for Cycles (panelMaps), and
// three.js renders (setup, renderFrame).

let render: Awaited<ReturnType<typeof createRenderer>>;

async function setup(o: RenderOptions) {
  const old = document.getElementById("gl")!;
  const canvas = document.createElement("canvas");
  old.replaceWith(canvas);
  canvas.id = "gl";
  render = await createRenderer(canvas, o);
}

// Renders one frame with three.js and returns it as a PNG.
async function renderFrame(i: number, t: number, samples: number) {
  render.render(i, t, samples);
  const canvas = document.getElementById("gl") as HTMLCanvasElement;
  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b!), "image/png"),
  );
  const png = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.readAsDataURL(blob);
  });
  return png;
}

// How far the view moves, in frame pixels, as segment i goes from t0 to t1:
// the largest move of any visible corner.
function motion(i: number, t0: number, t1: number) {
  const a = render.project(i, t0);
  const b = render.project(i, t1);
  let most = 0;
  for (let p = 0; p < a.length; p += 2) {
    const d = Math.hypot(b[p] - a[p], b[p + 1] - a[p + 1]);
    if (d > most) most = d;
  }
  return most;
}

// The solar panel's texture maps as PNG data URLs, for the Blender renderer
// (scripts/render-blender/), which draws the panels from the same maps.
function panelMaps() {
  const maps = solarPanelMaps(1);
  return Object.fromEntries(
    Object.entries(maps).map(([name, t]) => [
      name,
      (t.image as HTMLCanvasElement).toDataURL("image/png"),
    ]),
  );
}

Object.assign(window, { setup, renderFrame, motion, panelMaps, ready: true });
