import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";
import path from "node:path";

const workspaceRoot = path.resolve(__dirname, "../..");
loadEnvConfig(workspaceRoot);

const companyBasePath = process.env.COMPANY_BASE_PATH || (process.env.VERCEL === "1" ? undefined : "/companies");

const nextConfig: NextConfig = {
  ...(companyBasePath ? { basePath: companyBasePath } : {}),
  turbopack: {
    root: workspaceRoot,
  },
};

export default nextConfig;
