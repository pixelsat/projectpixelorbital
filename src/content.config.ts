import { defineCollection } from "astro:content";
import { z } from "astro/zod";
import { glob } from "astro/loaders";

const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content" }),
  schema: z.object({
    title: z.string(),
    authors: z.string(),
    date: z.coerce.date(),
    redirect: z.string().url().optional(),
  }),
});

export const collections = { blog };
