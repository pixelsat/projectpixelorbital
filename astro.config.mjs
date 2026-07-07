import { defineConfig } from "astro/config";
import svelte from "@astrojs/svelte";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
    site: "https://www.projectpixelorbital.com",
    output: "static",
    markdown: {
        shikiConfig: {
            theme: "github-light",
        },
    },
    vite: {
        plugins: [tailwindcss()],
    },
});
