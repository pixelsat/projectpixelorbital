import {
  SEQUENCE_MEDIA,
  WIDE_QUERY,
  clamp01,
  frameUrl,
  placement,
  segmentAt,
  smooth,
  type FrameManifest,
  type Sequence,
} from "./story.ts";

// Plays the satellite story's pre-rendered frames (scripts/render-frames/)
// on a canvas as the page scrolls. Chapter copy scrolls natively over the
// sticky canvas; only its opacity is set here.

// Time constant of the view's easing towards the scroll position, in ms.
// Short enough to track the natively scrolling copy; long enough to smooth
// out mouse-wheel steps.
const EASE = 50;
// Once the scroll position has held this long (ms), the view settles on the
// nearest whole frame, so a still view is never a crossfade of two.
const SETTLE = 120;
// Frames in flight at once.
const CONCURRENCY = 6;

export function mountStory(
  manifest: FrameManifest,
  canvas: HTMLCanvasElement,
  chapters: HTMLElement[],
  story: HTMLElement,
  onReady: () => void,
) {
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  // Like Apple's pages, fall back to a base experience that doesn't animate
  // the model: with reduced motion, or when the visitor asked to save data,
  // only each chapter's pose is loaded and the view cuts between them.
  const stills =
    reducedMotion ||
    !!(navigator as { connection?: { saveData?: boolean } }).connection
      ?.saveData;
  const ctx = canvas.getContext("2d", { alpha: false })!;
  const { positions } = manifest;
  const last = positions.length - 1;
  if (
    manifest.chapters.join() !== chapters.map((c) => c.dataset.chapter).join()
  )
    console.warn("Story frames are stale: run npm run render-frames");

  // Frame index, fractional between frames, showing story position s.
  const frameOf = (s: number) => {
    const { i, t } = segmentAt(s);
    const g = i + t;
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (positions[mid] <= g) lo = mid;
      else hi = mid;
    }
    const span = positions[hi] - positions[lo];
    return lo + (span > 0 ? clamp01((g - positions[lo]) / span) : 0);
  };
  // Each chapter's pose.
  const keyframes = chapters.map((_, k) => Math.round(frameOf(k)));

  // Load order: chapter poses first, then every 16th frame, every 8th, and
  // so on, so a coarse version of the whole story is playable early and
  // fills in.
  const passes = [keyframes];
  const seen = new Set(keyframes);
  for (let step = 16; step >= 1 && !stills; step /= 2) {
    const pass = [];
    for (let f = 0; f <= last; f += step) if (!seen.has(f)) pass.push(f);
    pass.forEach((f) => seen.add(f));
    passes.push(pass);
  }

  // The sequence for this screen, and its frames as they arrive.
  let sequence: Sequence;
  let frames: (HTMLImageElement | undefined)[] = [];
  let generation = 0;
  let dirty = true;
  let ready = false;
  // The frame shown, fractional while crossfading.
  let shown = NaN;

  const pickSequence = () => {
    const name =
      SEQUENCE_MEDIA.find(([, query]) => matchMedia(query).matches)?.[0] ??
      "l1600";
    if (sequence?.name === name) return;
    sequence = manifest.sequences.find((s) => s.name === name)!;
    frames = [];
    load(++generation);
  };

  async function load(gen: number) {
    for (const pass of passes) {
      const pending = new Set(pass);
      const worker = async () => {
        while (pending.size && gen === generation) {
          // Nearest to the view first.
          const near = Number.isNaN(shown) ? 0 : shown;
          let f = -1;
          for (const g of pending)
            if (f < 0 || Math.abs(g - near) < Math.abs(f - near)) f = g;
          pending.delete(f);
          const img = new Image();
          img.src = frameUrl(manifest, sequence.name, f);
          try {
            await img.decode();
          } catch {
            continue;
          }
          if (gen !== generation) return;
          frames[f] = img;
          dirty = true;
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      if (gen !== generation) return;
    }
  }

  const nearestLoaded = (f: number) => {
    for (let d = 0; d <= last; d++) {
      if (frames[f - d]) return f - d;
      if (frames[f + d]) return f + d;
    }
    return -1;
  };

  let width = 0;
  let height = 0;
  let wide = false;
  const resize = () => {
    const ratio = Math.min(window.devicePixelRatio, 2);
    width = Math.round(canvas.clientWidth * ratio);
    height = Math.round(canvas.clientHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    wide = matchMedia(WIDE_QUERY).matches;
    pickSequence();
    measure();
    dirty = true;
  };

  // `blend` crossfades between the two frames either side of f.
  const draw = (f: number, blend: boolean) => {
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);

    const a = Math.floor(f);
    const b = Math.min(last, a + 1);
    const mix = f - a;
    // Place the model for the story position the frame shows.
    const g = positions[a] + (positions[b] - positions[a]) * mix;
    const i = Math.min(chapters.length - 2, Math.floor(g));
    const place = placement(i, g - i, wide, width / height);
    const k = height / place.fit / sequence.base;
    const cx = width * (0.5 + place.x);
    const cy = height * (0.5 + place.y);
    const blit = (frame: number, alpha: number) => {
      const [x, y, w, h] = sequence.rects[frame];
      ctx.globalAlpha = alpha;
      ctx.drawImage(
        frames[frame]!,
        cx + (x - sequence.width / 2) * k,
        cy + (y - sequence.height / 2) * k,
        w * k,
        h * k,
      );
    };

    // Between two loaded frames, crossfade: additive blending of the two
    // weighted frames over black is an exact mix.
    ctx.imageSmoothingQuality = "high";
    if (blend && frames[a] && frames[b] && mix > 0.01 && mix < 0.99) {
      blit(a, 1 - mix);
      ctx.globalCompositeOperation = "lighter";
      blit(b, mix);
    } else {
      const near = nearestLoaded(Math.round(f));
      if (near < 0) return false;
      blit(near, 1);
    }
    return true;
  };

  // Chapter k is fully shown at s = k, when its top edge reaches the top of
  // the viewport. Its copy fades around that point, following the raw scroll
  // position so it stays in step with the page.
  const updateCopy = (s: number) => {
    chapters.forEach((el, k) => {
      const d = s - k;
      const final = k === chapters.length - 1;
      const opacity =
        k === 0 && d < 0
          ? 1
          : final && d > 0
            ? 1
            : 1 - smooth(clamp01((Math.abs(d) - 0.08) / 0.3));
      el.style.opacity = opacity.toFixed(3);
    });
  };

  // Scroll offsets, from the top of the story, at which each chapter's top
  // reaches the top of the viewport. Measured rather than derived from CSS so
  // chapters that grow past a screen tall stay in step with their poses.
  let tops: number[] = [];
  function measure() {
    const top = story.getBoundingClientRect().top;
    tops = chapters.map((el) => el.getBoundingClientRect().top - top);
  }
  new ResizeObserver(measure).observe(story);

  // Story position s for the current scroll position.
  const target = () => {
    const scrolled = -story.getBoundingClientRect().top;
    const n = tops.length - 1;
    for (let i = 0; i < n; i++) {
      if (scrolled < tops[i + 1])
        return i + Math.max(0, scrolled - tops[i]) / (tops[i + 1] - tops[i]);
    }
    return Math.max(0, n);
  };

  let running = false;
  let goal = NaN;
  let movedAt = 0;
  let drawn = NaN;
  let before = NaN;
  const tick = (time: number) => {
    if (!running) return;
    // Clamp the step so a frame after a stall (or a background tab) doesn't
    // jump.
    const dt = Math.min(100, time - before) || 16;
    before = time;
    const s = target();
    if (s !== goal) {
      goal = s;
      movedAt = time;
      updateCopy(s);
    }
    let want = stills ? keyframes[Math.round(s)] : frameOf(s);
    if (time - movedAt > SETTLE) want = Math.round(want);
    shown =
      stills || !(Math.abs(want - shown) > 0.01)
        ? want
        : shown + (want - shown) * (1 - Math.exp(-dt / EASE));
    if (dirty || shown !== drawn) {
      // Crossfading draws two frames, often both new to the GPU. It only
      // smooths slow movement; faster than half a frame per screen refresh,
      // the nearest frame looks the same and costs half as much.
      const blend = !(Math.abs(shown - drawn) > 0.5);
      dirty = false;
      drawn = shown;
      if (draw(shown, blend) && !ready) {
        ready = true;
        onReady();
      }
    }
    requestAnimationFrame(tick);
  };

  new IntersectionObserver(([entry]) => {
    const wasRunning = running;
    running = entry.isIntersecting;
    if (running && !wasRunning) {
      before = NaN;
      requestAnimationFrame(tick);
    }
  }).observe(story);

  measure();
  shown = Math.round(frameOf(target()));
  resize();
  new ResizeObserver(resize).observe(canvas);
  updateCopy(target());
}
