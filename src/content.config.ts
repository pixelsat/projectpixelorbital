import { defineCollection } from "astro:content";
import { z } from "astro/zod";
import { file, glob } from "astro/loaders";
import { parse } from "yaml";

const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content" }),
  schema: z.object({
    title: z.string(),
    authors: z.string(),
    date: z.coerce.date(),
    redirect: z.string().url().optional(),
  }),
});

// Entries are keyed by their image path, so gallery.yaml needs no ids.
const gallery = defineCollection({
  loader: file("src/gallery/gallery.yaml", {
    parser: (text) =>
      (parse(text) ?? []).map((item: { image: string }) => ({
        id: item.image,
        ...item,
      })),
  }),
  schema: ({ image }) =>
    z.object({
      image: image(),
      caption: z.string(),
      milestones: z.array(z.string()).default([]),
      date: z.coerce.date().optional(),
      order: z.number().optional(),
    }),
});

export const collections = { blog, gallery };
