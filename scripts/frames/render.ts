import { createRenderer, POSES } from "./satellite.ts";

const { sets, framesPerMove, samples, format, quality } = await (
  await fetch("/config")
).json();
const moves = Object.keys(POSES).length - 1;
const smooth = (t: number) => t * t * (3 - 2 * t);

for (const [name, { width, height, wide }] of Object.entries<{
  width: number;
  height: number;
  wide: boolean;
}>(sets)) {
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  const render = await createRenderer(canvas, width, height, wide);
  // Frames are spaced evenly in scroll, which eases between poses.
  for (let i = 0; i <= moves * framesPerMove; i++) {
    const move = Math.min(moves - 1, Math.floor(i / framesPerMove));
    render(move + smooth(i / framesPerMove - move), samples);
    const blob = await new Promise<Blob | null>((done) =>
      canvas.toBlob(done, `image/${format}`, quality),
    );
    await fetch(`/frame/${name}/${i}`, { method: "POST", body: blob });
  }
  canvas.remove();
}
await fetch("/done", { method: "POST" });
