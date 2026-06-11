import { NextResponse } from "next/server";

// Defensive security headers for this local-first app (Enhancement Plan D7).
//
// The CSP is applied ONLY in production so Next dev tooling (eval'd source
// maps, react-refresh, inline boot scripts) is unaffected. Directives are
// matched to actual app usage:
// - style-src:   inline styles everywhere + the Google Fonts @import in
//                app/globals.css (the imported stylesheet loads from
//                fonts.googleapis.com)
// - font-src:    woff2 files served from fonts.gstatic.com
// - img-src:     /public PNGs ('self'), the data: SVG noise background in
//                globals.css, and blob: for canvas-generated object URLs
// - script-src:  Next.js production inline bootstrap scripts + the inline
//                theme script need 'unsafe-inline'; 'unsafe-eval' is kept as
//                cheap insurance for library internals (no nonce plumbing in
//                this hand-rolled setup)
// - connect-src: the browser only fetches same-origin /api/* routes; the
//                Notion API is called server-side, but api.notion.com is
//                allowed in case a future client-side call is added
const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://api.notion.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export function proxy() {
  const response = NextResponse.next();

  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  if (process.env.NODE_ENV === "production") {
    response.headers.set("Content-Security-Policy", PRODUCTION_CSP);
  }

  return response;
}
