import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(ROOT_DIR, ".env") });

function stripSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

export const config = {
  rootDir: ROOT_DIR,
  host: process.env.HOST || "0.0.0.0",
  port: Number(process.env.PORT || 3000),
  apiKey: process.env.API_KEY || "",
  go2rtcUrl: stripSlash(process.env.GO2RTC_URL || "http://127.0.0.1:1984"),
  go2rtcUsername: process.env.GO2RTC_USERNAME || "",
  go2rtcPassword: process.env.GO2RTC_PASSWORD || "",
  publicGo2rtcUrl: stripSlash(
    process.env.PUBLIC_GO2RTC_URL || process.env.GO2RTC_URL || "http://127.0.0.1:1984"
  ),
  syncIntervalMs: Number(process.env.SYNC_INTERVAL_MS || 30_000),
  dataDir: process.env.DATA_DIR || path.join(ROOT_DIR, "data"),
  corsOrigin: process.env.CORS_ORIGIN || "",
};

export function assertConfig() {
  const missing = [];
  if (!config.apiKey || config.apiKey === "troque-por-uma-chave-longa-e-aleatoria") {
    missing.push("API_KEY (defina uma chave forte no .env)");
  }
  if (!config.go2rtcUrl) missing.push("GO2RTC_URL");
  if (missing.length) {
    throw new Error(`Configuração inválida: ${missing.join("; ")}`);
  }
}
