import { unified } from "@astrojs/markdown-remark";
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";

export default defineConfig({
  site: "https://www.projectpixelorbital.com",
  output: "static",
  markdown: {
    processor: unified({
      remarkPlugins: [remarkMath],
      rehypePlugins: [rehypeKatex],
    }),
    shikiConfig: {
      themes: {
        light: "github-light",
        dark: "github-dark",
      },
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
