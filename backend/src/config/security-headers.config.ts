import type { HelmetOptions } from 'helmet';

/**
 * This API never serves HTML, inline scripts, or third-party embeds — it
 * only returns JSON, plus a handful of static file routes (avatars,
 * managed documents) fetched by the frontend, never rendered as a page in
 * their own right. Helmet's bare defaults assume an HTML-serving origin
 * (permitting same-origin scripts/styles, `frame-ancestors 'self'`, etc.);
 * a JSON API origin should default-deny everything and allow nothing back
 * in, since there is nothing here that legitimately needs to load a
 * script, a stylesheet, or a frame.
 */
export function buildHelmetOptions(): HelmetOptions {
  return {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'none'"],
        objectSrc: ["'none'"],
        scriptSrc: ["'none'"],
        styleSrc: ["'none'"],
        imgSrc: ["'self'"],
      },
    },
  };
}
