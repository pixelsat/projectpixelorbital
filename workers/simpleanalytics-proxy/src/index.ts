interface Env {
  SITE_HOSTNAME: string;
}

const PREFIX = "/_sa";
const SCRIPT_ORIGIN = "https://simpleanalyticsexternal.com";
const QUEUE_ORIGIN = "https://queue.simpleanalyticscdn.com";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === `${PREFIX}/proxy.js`) {
      const upstream = new URL("/proxy.js", SCRIPT_ORIGIN);
      upstream.searchParams.set("hostname", env.SITE_HOSTNAME);
      upstream.searchParams.set("path", PREFIX);

      return fetch(upstream, {
        headers: {
          Accept: "application/javascript, text/javascript, */*;q=0.8",
        },
      });
    }

    const upstreamPath = url.pathname.slice(PREFIX.length) || "/";
    const upstream = new URL(`${upstreamPath}${url.search}`, QUEUE_ORIGIN);

    // Do not remove client-IP headers. For subrequests to this external origin,
    // Cloudflare forwards CF-Connecting-IP as the originating visitor's address.
    return fetch(new Request(upstream, request));
  },
} satisfies ExportedHandler<Env>;
