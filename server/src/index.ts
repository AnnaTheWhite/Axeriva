import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import crypto from "crypto";

// Loads .env, validates required variables and exits with a clear error if
// any are missing — must stay the first app import so every other module
// sees a validated environment.
import { config } from "./config";

import prisma from "./database/prisma";
import authRoutes from "./routes/auth.routes";
import invitesRoutes from "./routes/invites.routes";
import employeesRoutes from "./routes/employees.routes";
import projectsRoutes from "./routes/projects.routes";
import customersRoutes from "./routes/customers.routes";
import companiesRoutes from "./routes/companies.routes";
import shiftsRoutes from "./routes/shifts.routes";
import subscriptionRoutes from "./routes/subscription.routes";
import stripeWebhookRoutes from "./routes/stripeWebhook.routes";
import adminRoutes from "./routes/admin.routes";
import adminAnalyticsRoutes from "./routes/adminAnalytics.routes";
import dashboardRoutes from "./routes/dashboard.routes";
import accountRoutes from "./routes/account.routes";
import companyRoutes from "./routes/company.routes";
import projectActivityRoutes from "./routes/projectActivity.routes";
import attachmentsRoutes from "./routes/attachments.routes";
import ownerNotesRoutes from "./routes/ownerNotes.routes";
import { authMiddleware } from "./middleware/auth.middleware";
import { UPLOAD_ROOT } from "./middleware/upload.middleware";
import {
  httpSecurity,
  permissionsPolicy,
  uploadsResourcePolicy,
} from "./middleware/httpSecurity";

const app = express();

// Fingerprinting hygiene, and a prerequisite for a future Helmet setup
// (helmet would do this too — doing it now costs nothing).
app.disable("x-powered-by");

// Production runs behind a reverse proxy (Render), so req.ip / req.protocol
// must be derived from X-Forwarded-* set by that first proxy hop.
if (config.isProduction) {
  app.set("trust proxy", 1);
}

// Per-request correlation id — attached first so it's available to the auth
// audit log (see services/audit/authAudit.ts) for every downstream event.
app.use((req, _res, next) => {
  req.id = crypto.randomUUID();
  next();
});

// HTTP security headers (K2.2) — Helmet (CSP, HSTS, frameguard, nosniff,
// CORP/COOP, referrer policy) plus an explicit Permissions-Policy. Applied
// before routing so every response carries them. See middleware/
// httpSecurity.ts and docs/http-security.md.
app.use(httpSecurity());
app.use(permissionsPolicy());

// Production: only the configured frontend origin (APP_URL is a required
// variable there — see config.ts). Development: APP_URL if set, otherwise
// allow-all so local tooling isn't locked out. The API is Bearer-token
// based (no cookies), so credentials stay disabled.
app.use(
  cors({
    origin: config.isProduction ? config.appUrl! : config.appUrl ?? true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Development-only request log: one concise line per request after it
// finishes. Production stays quiet on the happy path (errors are still
// logged by the error handler below).
if (!config.isProduction) {
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on("finish", () => {
      console.log(
        `${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - startedAt}ms`
      );
    });
    next();
  });
}

// Stripe needs the raw request body to verify the webhook signature, so this
// route must be registered with express.raw() before the global
// express.json() below would otherwise consume the body first.
app.use("/subscription/webhook", express.raw({ type: "application/json" }), stripeWebhookRoutes);

// Default 100kb is too small for a base64-encoded logo upload (see
// POST /company/settings, BrandingSection on the frontend).
// No urlencoded parser on purpose: the API is JSON-only (plus multer for
// multipart uploads); adding one would only widen the parsing surface.
app.use(express.json({ limit: "5mb" }));

// Project attachments live on disk (see middleware/upload.middleware.ts),
// not as base64 in the DB. Filenames are randomized UUIDs, not the
// uploaded names, so this can stay a plain static mount without leaking
// anything by browsing it. Files are immutable once written (a new upload
// gets a new UUID), so letting browsers cache them for a day is safe.
// uploadsResourcePolicy overrides the global same-origin CORP with
// cross-origin so the frontend can embed attachment images across origins
// (see httpSecurity.ts). Static files keep the day-long cache and inherit
// nosniff from the global Helmet layer.
app.use("/uploads", uploadsResourcePolicy(), express.static(UPLOAD_ROOT, { maxAge: "1d" }));

app.get("/", (_req, res) => {
  res.json({
    name: "Axeriva API",
    version: config.version,
    status: "running",
  });
});

// Dedicated health endpoint for uptime checks / the hosting platform's
// health probe. Deliberately unauthenticated and DB-free: it answers "is
// the process up and serving HTTP", not "is every dependency healthy".
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    environment: config.nodeEnv,
    version: config.version,
    uptime: `${Math.round(process.uptime())}s`,
    timestamp: new Date().toISOString(),
  });
});

app.use("/auth", authRoutes);
app.use("/invites", invitesRoutes);

app.use("/employees", authMiddleware, employeesRoutes);
app.use("/projects", authMiddleware, projectsRoutes);
app.use("/customers", authMiddleware, customersRoutes);
app.use("/companies", authMiddleware, companiesRoutes);
app.use("/shifts", authMiddleware, shiftsRoutes);
app.use("/subscription", authMiddleware, subscriptionRoutes);
// More specific mount first so /admin/analytics/* is handled here and not
// swallowed by the generic /admin router below.
app.use("/admin/analytics", authMiddleware, adminAnalyticsRoutes);
app.use("/admin", authMiddleware, adminRoutes);
app.use("/dashboard", authMiddleware, dashboardRoutes);
app.use("/account", authMiddleware, accountRoutes);
app.use("/company", authMiddleware, companyRoutes);
app.use("/projects", authMiddleware, projectActivityRoutes);
app.use("/attachments", authMiddleware, attachmentsRoutes);
app.use("/owner-notes", authMiddleware, ownerNotesRoutes);

// JSON 404 for unknown routes — without this Express falls through to its
// default HTML "Cannot GET ..." page, which is wrong for a JSON API.
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Global error handler — Express 5 forwards rejected promises from async
// route handlers here automatically. Replaces the framework default, which
// renders an HTML page including the stack trace. The full error is always
// logged server-side; what the client sees depends on the environment:
// development gets the message + stack for debugging, production gets a
// generic body with no internals.
app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
  console.error(`[error] ${req.method} ${req.originalUrl}`, error);

  if (res.headersSent) {
    return;
  }

  if (config.isProduction) {
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  const err = error instanceof Error ? error : new Error(String(error));
  res.status(500).json({ error: err.message, stack: err.stack });
});

// Startup sequence: env validation (config import, top of file) → upload
// directory creation (upload.middleware import) → explicit DB connect →
// HTTP listen. Connecting to Prisma up front means a broken DATABASE_URL
// kills the process at startup instead of failing on the first query.
async function start() {
  try {
    await prisma.$connect();
  } catch (error) {
    console.error("FATAL: cannot connect to the database. Check DATABASE_URL.", error);
    process.exit(1);
  }

  app.listen(config.port, () => {
    console.log(
      `Axeriva API v${config.version} running on port ${config.port} (${config.nodeEnv})`
    );
  });
}

start();
