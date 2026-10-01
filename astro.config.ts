import { unified } from "@astrojs/markdown-remark";
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";

// Comma-separated list of extra dev-server hosts, e.g.
// ALLOWED_HOSTS=foo.ngrok-free.dev npm run dev
const allowedHosts = (process.env.ALLOWED_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

export default defineConfig({
  site: "https://www.projectpixelorbital.com",
  output: "static",
  markdown: {
    processor: unified({
      remarkPlugins: [remarkMath],
      rehypePlugins: [rehypeKatex],
    }),
    shikiConfig: {
      theme: "github-dark",
    },
  },
  vite: {
    plugins: [tailwindcss()],
    server: {
      allowedHosts,
    },
  },
});
