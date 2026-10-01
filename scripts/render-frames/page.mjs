// Opens scripts/render-frames/index.html (main.ts) in the locally installed
// Google Chrome, served by Vite. The page computes frame positions, draws the
// solar panel maps, and renders with three.js; see main.ts.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

export const root = path.resolve(fileURLToPath(import.meta.url), "../../..");

export async function openPage() {
  const server = await createServer({
    root: path.join(root, "scripts/render-frames"),
    publicDir: path.join(root, "public"),
    server: { port: 0, fs: { allow: [root] } },
    logLevel: "warn",
  });
  await server.listen();
  const browser = await chromium.launch({
    channel: "chrome",
    args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=metal"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning")
      console.error("page:", m.text());
  });
  await page.goto(server.resolvedUrls.local[0]);
  // Vite may optimise dependencies on a cold start and reload the page.
  await page.waitForFunction(() => window.ready, null, { timeout: 120_000 });
  return {
    page,
    async close() {
      await browser.close();
      await server.close();
    },
  };
}
