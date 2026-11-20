import path from "node:path";
import express from "express";
import { config, ROOT_DIR } from "./config.js";
import { getDvr, listDvrs, removeDvr, upsertDvr } from "./store.js";
import {
  ensureAllStreams,
  pingGo2rtc,
  recreateDvrStreams,
  removeDvrStreams,
  summarizeSync,
} from "./go2rtc.js";
import { publicDvr } from "./urls.js";
import { isValidId, makeId, parseDvrInput } from "./validate.js";
import { handleClip } from "./clip.js";

export const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));

app.use((req, res, next) => {
  if (config.corsOrigin) {
    res.setHeader("Access-Control-Allow-Origin", config.corsOrigin);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    if (req.method === "OPTIONS") return res.status(204).end();
  }
  next();
});

function requireApiKey(req, res, next) {
  const key = req.get("x-api-key") || "";
  if (!config.apiKey || key !== config.apiKey) {
    return res.status(401).json({ error: "API key inválida ou ausente. Envie o header X-API-Key." });
  }
  next();
}


app.get(["/docs", "/docs/"], (_req, res) => {
  res.sendFile(path.join(ROOT_DIR, "public", "docs.html"));
});

app.get("/health", async (_req, res) => {
  const go2rtc = await pingGo2rtc();
  const ok = go2rtc.reachable && go2rtc.authorized;
  res.status(ok ? 200 : 503).json({
    ok,
    service: "portguard-dvr-server",
    time: new Date().toISOString(),
    go2rtc,
  });
});

app.use("/api", requireApiKey);

app.get("/api/dvrs", async (_req, res, next) => {
  try {
    const dvrs = await listDvrs();
    res.json({ dvrs: dvrs.map((dvr) => publicDvr(dvr)) });
  } catch (err) {
    next(err);
  }
});

app.get("/api/dvrs/:id", async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: "id inválido" });
    const dvr = await getDvr(req.params.id);
    if (!dvr) return res.status(404).json({ error: "DVR não encontrado" });
    res.json(publicDvr(dvr));
  } catch (err) {
    next(err);
  }
});

app.post("/api/dvrs", async (req, res, next) => {
  try {
    const parsed = parseDvrInput(req.body, { partial: false });
    if (parsed.errors.length) return res.status(400).json({ error: "Dados inválidos", details: parsed.errors });

    const now = new Date().toISOString();
    const dvr = {
      id: makeId(parsed.value.name),
      ...parsed.value,
      createdAt: now,
      updatedAt: now,
    };
    await upsertDvr(dvr);
    const sync = summarizeSync(await recreateDvrStreams(dvr));
    res.status(201).json(publicDvr(dvr, { go2rtc: sync }));
  } catch (err) {
    next(err);
  }
});

app.put("/api/dvrs/:id", async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: "id inválido" });
    const current = await getDvr(req.params.id);
    if (!current) return res.status(404).json({ error: "DVR não encontrado" });

    const parsed = parseDvrInput(req.body, { partial: true, current });
    if (parsed.errors.length) return res.status(400).json({ error: "Dados inválidos", details: parsed.errors });

    const updated = {
      ...current,
      ...parsed.value,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    };

    // Se canais mudaram, remove os streams antigos antes de recriar.
    await removeDvrStreams(current);
    await upsertDvr(updated);
    const sync = summarizeSync(await recreateDvrStreams(updated));
    res.json(publicDvr(updated, { go2rtc: sync }));
  } catch (err) {
    next(err);
  }
});

app.delete("/api/dvrs/:id", async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: "id inválido" });
    const current = await getDvr(req.params.id);
    if (!current) return res.status(404).json({ error: "DVR não encontrado" });
    const streams = await removeDvrStreams(current);
    await removeDvr(current.id);
    res.json({
      ok: true,
      id: current.id,
      go2rtc: summarizeSync(streams),
    });
  } catch (err) {
    next(err);
  }
});

app.post("/api/sync", async (_req, res, next) => {
  try {
    const dvrs = await listDvrs();
    const sync = await ensureAllStreams(dvrs);
    res.json({
      ok: sync.synced,
      dvrCount: dvrs.length,
      go2rtc: sync,
    });
  } catch (err) {
    next(err);
  }
});

app.get("/api/clip", handleClip);

app.use((req, res) => {
  res.status(404).json({ error: "Rota não encontrada", path: req.path });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Erro interno", message: err.message });
});
