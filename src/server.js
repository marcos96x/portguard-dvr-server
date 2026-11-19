import { app } from "./app.js";
import { assertConfig, config } from "./config.js";
import { ensureAllStreams } from "./go2rtc.js";
import { listDvrs } from "./store.js";

assertConfig();

let syncTimer = null;

async function syncSavedDvrs(reason) {
  try {
    const dvrs = await listDvrs();
    const result = await ensureAllStreams(dvrs);
    const label = result.synced ? "ok" : "parcial";
    console.log(
      `[sync:${reason}] ${label} — ${dvrs.length} DVR(s), ${result.created} stream(s) ok, ${result.failed} falha(s)`
    );
    if (result.go2rtcError) console.warn(`[sync:${reason}] go2rtc: ${result.go2rtcError}`);
    for (const err of result.errors || []) {
      console.warn(`[sync:${reason}] ${err.streamName}: ${err.error}`);
    }
    return result;
  } catch (err) {
    console.error(`[sync:${reason}] falhou:`, err.message);
    return null;
  }
}

const server = app.listen(config.port, config.host, async () => {
  console.log(`portguard-dvr-server escutando em http://${config.host}:${config.port}`);
  console.log(`go2rtc interno: ${config.go2rtcUrl}`);
  console.log(`URLs públicas:  ${config.publicGo2rtcUrl}`);
  await syncSavedDvrs("startup");
  if (config.syncIntervalMs > 0) {
    syncTimer = setInterval(() => {
      syncSavedDvrs("interval");
    }, config.syncIntervalMs);
    syncTimer.unref?.();
  }
});

function shutdown(signal) {
  console.log(`Recebido ${signal}, encerrando...`);
  if (syncTimer) clearInterval(syncTimer);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
