import express from "express";
import cors from "cors";
import dotenv from "dotenv";

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
import dashboardRoutes from "./routes/dashboard.routes";
import accountRoutes from "./routes/account.routes";
import companyRoutes from "./routes/company.routes";
import projectActivityRoutes from "./routes/projectActivity.routes";
import attachmentsRoutes from "./routes/attachments.routes";
import { authMiddleware } from "./middleware/auth.middleware";
import { UPLOAD_ROOT } from "./middleware/upload.middleware";

dotenv.config();

const app = express();

// Restricted to the configured frontend origin once APP_URL is set to a
// real domain in production; falls back to allow-all locally (APP_URL
// defaults to the Vite dev server, but if it's unset entirely, don't lock
// out local tooling that doesn't set it).
app.use(cors({ origin: process.env.APP_URL || true }));

// Stripe needs the raw request body to verify the webhook signature, so this
// route must be registered with express.raw() before the global
// express.json() below would otherwise consume the body first.
app.use("/subscription/webhook", express.raw({ type: "application/json" }), stripeWebhookRoutes);

// Default 100kb is too small for a base64-encoded logo upload (see
// POST /company/settings, BrandingSection on the frontend).
app.use(express.json({ limit: "5mb" }));

// Project attachments live on disk (see middleware/upload.middleware.ts),
// not as base64 in the DB. Filenames are randomized UUIDs, not the
// uploaded names, so this can stay a plain static mount without leaking
// anything by browsing it.
app.use("/uploads", express.static(UPLOAD_ROOT));

app.get("/", (_req, res) => {
res.json({
name: "Axeriva API",
version: "1.0.0",
status: "running",
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
app.use("/admin", authMiddleware, adminRoutes);
app.use("/dashboard", authMiddleware, dashboardRoutes);
app.use("/account", authMiddleware, accountRoutes);
app.use("/company", authMiddleware, companyRoutes);
app.use("/projects", authMiddleware, projectActivityRoutes);
app.use("/attachments", authMiddleware, attachmentsRoutes);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
console.log(
`Axeriva API running on port ${PORT}`
);
});
