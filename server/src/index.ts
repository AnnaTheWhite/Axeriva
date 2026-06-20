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
import adminRoutes from "./routes/admin.routes";
import dashboardRoutes from "./routes/dashboard.routes";
import { authMiddleware } from "./middleware/auth.middleware";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
res.json({
name: "CrewFlow API",
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

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
console.log(
`CrewFlow API running on port ${PORT}`
);
});
