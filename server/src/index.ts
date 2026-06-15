import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import employeesRoutes from "./routes/employees.routes";

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

app.use("/employees", employeesRoutes);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`CrewFlow API running on port ${PORT}`);
});