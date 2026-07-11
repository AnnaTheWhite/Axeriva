import { RequestHandler } from "express";
import helmet from "helmet";
import { config } from "../config";

// Centralized HTTP security header layer (K2.2). One place that builds the
// Helmet configuration for the API, environment-aware. The API only ever
// returns JSON and (under /uploads) a fixed set of non-executable file
// types — it never serves HTML — so a strict Content-Security-Policy costs
// nothing here and acts as defense in depth. See docs/http-security.md.
//
// IMPORTANT: this hardens the API's own responses. The XSS -> token-theft
// path called out in the auth assessment (H2) lives in the FRONTEND
// document, which this server does not serve; the frontend CSP must be set
// at the static-site hosting layer (documented in http-security.md).

// Sources the strict production CSP allows. Kept as data so the doc and the
// code can't drift.
//
// - default/script/style/connect 'self': the API is same-origin to itself;
//   it embeds nothing and runs no inline script (no HTML responses at all).
// - img-src 'self' data:: covers the /uploads image responses and any
//   data-URI (none currently, but harmless and future-proof).
// - object-src 'none', frame-ancestors 'none': no plugins, never framed.
// - base-uri/form-action 'self': no HTML forms, but locks the directives.
// - upgrade-insecure-requests: production is HTTPS end-to-end (Render).
function productionCsp() {
  return {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: [],
    },
  };
}

// Development CSP: relaxed so that browsing the API directly, Vite's dev
// tooling, or the local frontend origin never hits a CSP wall. Notably NO
// upgrade-insecure-requests (localhost is plain HTTP) and 'unsafe-inline'
// allowed for style/script (dev convenience only — never sent in prod).
function developmentCsp() {
  const appOrigin = config.appUrl ?? "http://localhost:5173";
  return {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", appOrigin, "ws:", "wss:"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
    },
  };
}

export function httpSecurity(): RequestHandler {
  return helmet({
    // Content-Security-Policy — strict in production, relaxed in dev.
    contentSecurityPolicy: config.isProduction ? productionCsp() : developmentCsp(),

    // HSTS only in production. On localhost HSTS is a footgun: a cached
    // localhost HSTS entry forces HTTPS for every local dev service on any
    // port. Production is HTTPS end-to-end behind Render.
    strictTransportSecurity: config.isProduction
      ? { maxAge: 31536000, includeSubDomains: true, preload: true }
      : false,

    // Referrer-Policy: send only the origin cross-origin, full URL
    // same-origin — avoids leaking API paths (which may carry ids) to
    // third parties while staying useful internally.
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },

    // Cross-Origin-Opener-Policy: isolate our browsing context group.
    crossOriginOpenerPolicy: { policy: "same-origin" },

    // Cross-Origin-Resource-Policy: default same-origin for JSON responses
    // (cross-origin fetch is governed by CORS, not CORP, so this doesn't
    // block the frontend's API calls). The /uploads mount overrides this to
    // cross-origin so the frontend can embed attachment images — see
    // uploadsResourcePolicy() below and index.ts.
    crossOriginResourcePolicy: { policy: "same-origin" },

    // Cross-Origin-Embedder-Policy: intentionally DISABLED (Helmet's own
    // default). COEP would require every embedded subresource to opt in via
    // CORP/CORS; it buys a JSON API essentially nothing while risking
    // breakage, so it stays off (documented decision).
    crossOriginEmbedderPolicy: false,

    // X-Frame-Options: DENY — the API is never meant to be framed
    // (frame-ancestors 'none' in the CSP is the modern equivalent; both are
    // sent for older-browser coverage).
    frameguard: { action: "deny" },

    // X-Content-Type-Options: nosniff (Helmet default) — critical for
    // /uploads so a file can't be re-interpreted as HTML/script.
    // X-Powered-By is already disabled in index.ts; Helmet also removes it.
    // X-DNS-Prefetch-Control, Permissions-Policy handled below.

    // Permissions-Policy is not set by Helmet by default. Set a restrictive
    // one to disable powerful features the API/uploads never need.
    // (Delivered via the dedicated middleware below, since Helmet v8 has no
    // built-in Permissions-Policy option.)
  });
}

// Permissions-Policy: Helmet doesn't emit this header, so set it explicitly.
// Disable geolocation, camera, microphone, etc. — nothing the API serves
// uses them, and this instructs browsers to deny them for our responses.
export function permissionsPolicy(): RequestHandler {
  return (_req, res, next) => {
    res.setHeader(
      "Permissions-Policy",
      "geolocation=(), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()"
    );
    next();
  };
}

// Applied only on the /uploads static mount: the frontend embeds attachment
// images cross-origin (<img src="${API_URL}/uploads/...">), which the global
// same-origin CORP would block. cross-origin is required for that to work
// across both documented deployments (api.axeriva.com AND *.onrender.com).
export function uploadsResourcePolicy(): RequestHandler {
  return (_req, res, next) => {
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    next();
  };
}
