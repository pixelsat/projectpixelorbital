// Renders the scroll story into public/frames, one image per frame, and
// writes src/scripts/frames.json for the player. Serves a page that does the
// rendering in a browser: set CHROME to a Chromium binary to run it headless,
// or open the printed URL.
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { buffer } from "node:stream/consumers";
import { createServer } from "vite";

const root = new URL("../../", import.meta.url).pathname;
const config = {
  // `wide` matches the (min-width: 900px) layout in global.css.
  sets: {
    wide: { width: 1920, height: 1080, wide: true },
    narrow: { width: 780, height: 1688, wide: false },
  },
  framesPerMove: 24,
  samples: 64,
  format: process.env.FORMAT ?? "webp",
  quality: Number(process.env.QUALITY ?? 0.75),
};
const ext = config.format;
const out = `${root}public/frames`;

await rm(out, { recursive: true, force: true });
for (const name of Object.keys(config.sets))
  await mkdir(`${out}/${name}`, { recursive: true });

let browser;
const server = await createServer({
  root: `${root}scripts/frames`,
  publicDir: `${root}public`,
  logLevel: "warn",
  plugins: [
    {
      name: "frames",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url === "/config") return res.end(JSON.stringify(config));
          const frame = req.url.match(/^\/frame\/(\w+)\/(\d+)$/);
          if (frame) {
            const [, name, i] = frame;
            await writeFile(
              `${out}/${name}/${i.padStart(4, "0")}.${ext}`,
              await buffer(req),
            );
            process.stdout.write(`\r${name} ${i}   `);
            return res.end();
          }
          if (req.url !== "/done") return next();
          res.end();
          const { sets, framesPerMove } = config;
          await writeFile(
            `${root}src/scripts/frames.json`,
            JSON.stringify({ sets, framesPerMove, ext }, null, 2) + "\n",
          );
          console.log("\ndone");
          browser?.kill();
          await server.close();
        });
      },
    },
  ],
});
await server.listen();
const url = server.resolvedUrls.local[0];
if (process.env.CHROME) {
  browser = spawn(process.env.CHROME, [
    "--headless=new",
    "--use-angle=metal",
    `--user-data-dir=${root}node_modules/.cache/render-frames`,
    url,
  ]);
} else {
  console.log(`Open ${url} to render`);
}
