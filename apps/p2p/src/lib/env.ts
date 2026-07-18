import * as dotenv from "dotenv";
import path from "node:path";
import { existsSync } from "node:fs";

const currentDir = typeof __dirname !== "undefined" ? __dirname : process.cwd();

const envCandidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../../.env"),
    path.resolve(currentDir, "../../../.env"),
];

const envPath = envCandidates.find((candidate) => existsSync(candidate));
dotenv.config(envPath ? { path: envPath } : undefined);

const REQUIRED_ENV_VARS = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
] as const;

let validated = false;

export function validateEnv(): void {
    if (validated) return;
    validated = true;

    const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);

    if (missing.length > 0) {
        console.error(
            `\nMissing required environment variables for p2p service:\n${missing.map((k) => `  - ${k}`).join("\n")}\n`
        );
        process.exit(1);
    }
}

export function getP2PConfig() {
    validateEnv();
    return {
        host: process.env.P2P_HOST || "::",
        port: Number.parseInt(process.env.P2P_PORT || "3004", 10),
        frontendOrigin: process.env.FRONTEND_URL || "http://localhost:3000",
        redisUrl: process.env.REDIS_URL,
        allowInMemoryRedis:
            process.env.P2P_ALLOW_INMEMORY_REDIS === "1" ||
            process.env.P2P_ALLOW_INMEMORY_REDIS === "true",
    };
}
