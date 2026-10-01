// The satellite story's timeline, shared by the offline renderer
// (scripts/render-frames/) and the page's frame player (story-player.ts).
// Nothing here may import three.js: the page ships this file.

// Node names baked into public/models/pixelsat.glb. The model is Y-up, in
// millimetres, with the long axis running from y = 0 (bottom) to y = 300.
export const PARTS = [
  "torquers",
  "battery",
  "power",
  "mppt",
  "obc",
  "comms",
  "antenna",
] as const;
export type Part = (typeof PARTS)[number];

export interface Pose {
  focus: Part[] | "all";
  az: number; // degrees around the long axis
  el: number; // degrees above the horizon
  dist: number; // mm from the focus point
  roll: number; // camera roll in degrees
  panels: number; // 0 = attached, 1 = pulled off
  frame: number; // frame opacity
  // Text sits beside the model instead of above it; "wide" only does so on
  // wide screens.
  side: boolean | "wide";
  lift: Partial<Record<Part, number>>; // mm along the long axis
}

const base = { roll: 0, panels: 1, frame: 0, side: true, lift: {} };

// One pose per chapter, in page order: SatStory.astro's [data-chapter] ids
// must match CHAPTERS.
export const POSES = {
  hero: {
    ...base,
    focus: "all",
    az: 38,
    el: 14,
    dist: 1000,
    roll: -62,
    panels: 0,
    frame: 1,
    side: "wide",
  },
  open: { ...base, focus: "all", az: 20, el: 16, dist: 720, frame: 1 },
  adcs: {
    ...base,
    focus: ["torquers"],
    az: 40,
    el: 30,
    dist: 430,
    lift: { torquers: 40 },
  },
  power: {
    ...base,
    focus: ["battery", "power", "mppt"],
    az: 60,
    el: 26,
    dist: 520,
    lift: {
      torquers: 150,
      battery: 60,
      power: 25,
      obc: -30,
      comms: -50,
      antenna: -70,
    },
  },
  obc: {
    ...base,
    focus: ["obc"],
    az: 25,
    el: 42,
    dist: 400,
    lift: {
      torquers: 220,
      battery: 150,
      power: 110,
      mppt: 85,
      comms: -40,
      antenna: -60,
    },
  },
  comms: {
    ...base,
    focus: ["comms", "antenna"],
    az: 5,
    el: 34,
    dist: 420,
    lift: {
      torquers: 260,
      battery: 190,
      power: 150,
      mppt: 125,
      obc: 60,
      antenna: -35,
    },
  },
  together: {
    ...base,
    focus: "all",
    az: 215,
    el: 16,
    dist: 1000,
    roll: -62,
    panels: 0,
    frame: 1,
    side: false,
  },
} satisfies Record<string, Pose>;

export const CHAPTERS = Object.keys(POSES) as (keyof typeof POSES)[];
export const POSE_LIST: Pose[] = CHAPTERS.map((id) => POSES[id]);

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const smooth = (t: number) => t * t * (3 - 2 * t);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Fraction of each segment the pose holds for before moving on.
const HOLD = 0.3;

// Splits a story position s (chapter k is fully shown at s = k) into the
// segment it's in and the eased progress t from pose i to pose i + 1.
export const segmentAt = (s: number) => {
  const i = Math.max(0, Math.min(POSE_LIST.length - 2, Math.floor(s)));
  return { i, t: smooth(clamp01((s - i - HOLD) / (1 - HOLD))) };
};

// Screens narrower than this, or taller than wide, put the copy above or
// below the model instead of beside it. Keep in step with global.css.
export const WIDE_QUERY = "(min-width: 900px) and (min-aspect-ratio: 1/1)";

// Where the model sits on screen, as fractions of the viewport that move it
// right and down from centre. Portrait screens can't fit the model as wide,
// so it's also shrunk by 1 / fit. Frames are rendered centred and unshrunk;
// the player applies this in 2D, which matches moving the camera closely
// enough.
export const placement = (
  i: number,
  t: number,
  wide: boolean,
  aspect: number,
) => {
  const a = POSE_LIST[i];
  const b = POSE_LIST[i + 1];
  const sideOf = (p: Pose) => +(p.side === true || (wide && !!p.side));
  const side = lerp(sideOf(a), sideOf(b), t);
  // The closing chapter is just two buttons along the bottom, so the model
  // sits above centre, clear of them.
  const drop = (p: Pose) => (p.side === false ? -0.06 : 0.25);
  return {
    x: wide ? side * 0.22 : 0,
    y: lerp(lerp(drop(a), drop(b), t), wide ? 0 : -0.2, side),
    fit: Math.max(1, 1.25 / aspect) ** 0.8,
  };
};

// Which rendered sequence a screen plays, first match wins. The queries don't
// overlap, so index.astro can preload the first frame with the same ones.
// Portrait screens need the tall sequence; landscape ones the large one once
// a viewport height is more than about 1000 device pixels.
export const SEQUENCE_MEDIA: [name: string, query: string][] = [
  ["p1000", "(max-aspect-ratio: 999/1000)"],
  [
    "l1600",
    "(min-aspect-ratio: 1/1) and (min-resolution: 1.5dppx), " +
      "(min-aspect-ratio: 1/1) and (min-height: 800px)",
  ],
  [
    "l800",
    "(min-aspect-ratio: 1/1) and (max-resolution: 1.49dppx) and (max-height: 799.9px)",
  ],
];

export const frameUrl = (m: FrameManifest, sequence: string, f: number) =>
  `/story/${sequence}/${String(f).padStart(3, "0")}.${m.ext}?v=${m.version}`;

export interface Sequence {
  name: string;
  // Rendered pixels per viewport height at fit = 1.
  base: number;
  // The full rendered frame, centred on the focus point. Each image is only
  // the part of it with anything in, at `rects[k]` ([x, y, w, h]).
  width: number;
  height: number;
  rects: number[][]; // [x, y, w, h]
}

export interface FrameManifest {
  chapters: string[];
  // Where each frame sits in the story, ascending: frame k shows segment
  // floor(positions[k]) at eased progress t = positions[k] - that segment
  // (the last frame shows the last segment at t = 1). Chapter poses sit at
  // whole numbers.
  positions: number[];
  ext: string;
  version: string;
  sequences: Sequence[];
}
