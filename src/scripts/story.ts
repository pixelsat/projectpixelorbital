// Plays the scroll story from frames prerendered by `pnpm render-frames`.
import frames from "./frames.json";

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (t: number) => t * t * (3 - 2 * t);
const PARALLEL = 4;

export function mountStory(
  canvas: HTMLCanvasElement,
  chapters: HTMLElement[],
  story: HTMLElement,
  onReady: () => void,
) {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wideQuery = matchMedia("(min-width: 900px)");
  const perMove = frames.framesPerMove;
  const moves = chapters.length - 1;
  const count = moves * perMove + 1;
  const ctx = canvas.getContext("2d")!;

  const url = (i: number) =>
    `/frames/${wideQuery.matches ? "wide" : "narrow"}/${String(i).padStart(4, "0")}.${frames.ext}`;
  const requested = new Set<string>();
  const ready = new Map<string, HTMLImageElement>();

  // Chapter k is shown at scroll position s = k. Each chapter holds its frame
  // for the first third of the way to the next, then plays the move.
  const frameAt = (s: number) => {
    const i = Math.min(moves - 1, Math.floor(s));
    return i * perMove + Math.round(clamp01((s - i - 0.3) / 0.7) * perMove);
  };

  // Load order after whatever is near the current frame: the held frames,
  // then every 12th, 6th, ... so any scroll position soon has a close frame.
  const order: number[] = [];
  for (let stride = perMove; ; stride = Math.ceil(stride / 2)) {
    for (let i = 0; i < count; i += stride)
      if (!order.includes(i)) order.push(i);
    if (stride === 1) break;
  }

  let current = 0;
  let loading = 0;
  const pick = () => {
    for (let d = 0; d <= 8; d++)
      for (const i of [current + d, current - d])
        if (i >= 0 && i < count && !requested.has(url(i))) return url(i);
    return order.map(url).find((u) => !requested.has(u));
  };
  const pump = () => {
    for (let next; loading < PARALLEL && (next = pick()); ) {
      const src = next;
      requested.add(src);
      loading++;
      const img = new Image();
      img.src = src;
      img
        .decode()
        .then(() => ready.set(src, img))
        .catch(() => {})
        .finally(() => {
          loading--;
          wake();
          pump();
        });
    }
  };

  // Draws the loaded frame closest to `current`, letterboxed: the frames'
  // black background runs into the page's.
  let drawn: HTMLImageElement | null = null;
  const draw = () => {
    for (let d = 0; d < count; d++) {
      const img = ready.get(url(current - d)) ?? ready.get(url(current + d));
      if (!img) continue;
      if (img === drawn) return;
      const { width, height } = canvas;
      const scale = Math.min(
        width / img.naturalWidth,
        height / img.naturalHeight,
      );
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h);
      if (!drawn) onReady();
      drawn = img;
      return;
    }
  };

  new ResizeObserver(() => {
    canvas.width = canvas.clientWidth * devicePixelRatio;
    canvas.height = canvas.clientHeight * devicePixelRatio;
    drawn = null;
    pump();
    wake();
  }).observe(canvas);

  const updateCopy = (s: number) => {
    chapters.forEach((el, k) => {
      const d = s - k;
      const last = k === chapters.length - 1;
      const opacity =
        k === 0 && d < 0
          ? 1
          : last && d > 0
            ? 1
            : 1 - smooth(clamp01((Math.abs(d) - 0.12) / 0.2));
      el.style.opacity = opacity.toFixed(3);
      el.style.transform = `translate3d(0, ${(-d * 60).toFixed(1)}px, 0)`;
      el.style.visibility = opacity < 0.01 ? "hidden" : "visible";
    });
  };

  const target = () => {
    const segment = (story.offsetHeight - window.innerHeight) / moves;
    // A zero-size viewport (e.g. a hidden iframe) would make this NaN.
    if (!(segment > 0)) return 0;
    const scrolled = -story.getBoundingClientRect().top;
    return Math.min(moves, Math.max(0, scrolled / segment));
  };

  let s = target();
  let running = false;
  let scheduled = false;
  const wake = () => {
    if (running && !scheduled) {
      scheduled = true;
      requestAnimationFrame(tick);
    }
  };
  const tick = () => {
    scheduled = false;
    const goal = target();
    s =
      reducedMotion || Math.abs(goal - s) < 1e-4 ? goal : s + (goal - s) * 0.12;
    updateCopy(s);
    const frame = frameAt(s);
    if (frame !== current) {
      current = frame;
      pump();
    }
    draw();
    if (s !== goal) wake();
  };

  addEventListener("scroll", wake, { passive: true });
  wideQuery.addEventListener("change", () => {
    drawn = null;
    pump();
    wake();
  });
  new IntersectionObserver(([entry]) => {
    running = entry.isIntersecting;
    wake();
  }).observe(story);

  current = frameAt(s);
  updateCopy(s);
  pump();
}
