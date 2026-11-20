import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readdir, rm, stat, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listDvrs } from "./store.js";

const SRC_RE = /^([a-z0-9]+(?:[a-z0-9-]{0,46}[a-z0-9])?)_ch([1-9]\d*)(_main)?$/;
const MIN_SECONDS = 5;
const MAX_SECONDS = 30;
const DEFAULT_SECONDS = 15;
const MAX_CONCURRENT = 2;
const CLIP_DIR = path.join(os.tmpdir(), "portguard-clips");
const CLIP_TTL_MS = 5 * 60 * 1000;
const DVR_TZ = "America/Sao_Paulo";
const MONTHS = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};
// Offsets behind the DVR clock. The device can return 4xx on some nearby
// windows even when a slightly different one works.
const END_OFFSETS_S = [2, 15, 30, 60];

let activeClips = 0;

function parseSeconds(raw) {
  if (raw == null || raw === "") return { ok: true, value: DEFAULT_SECONDS };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < MIN_SECONDS || n > MAX_SECONDS) {
    return {
      ok: false,
      error: `seconds deve ser um inteiro entre ${MIN_SECONDS} e ${MAX_SECONDS}`,
    };
  }
  return { ok: true, value: n };
}

export function parseClipSrc(src) {
  if (typeof src !== "string") return null;
  const match = SRC_RE.exec(src.trim());
  if (!match) return null;
  return {
    dvrId: match[1],
    channel: Number(match[2]),
    quality: match[3] ? "main" : "sub",
    streamName: src.trim(),
  };
}

function encodeUserInfo(value) {
  return encodeURIComponent(String(value ?? ""));
}

function wrapHost(host) {
  const value = String(host || "").trim();
  if (value.includes(":") && !value.startsWith("[") && !value.includes("]")) {
    return `[${value}]`;
  }
  return value;
}

function formatDvrTime(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DVR_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}_${get("month")}_${get("day")}_${get("hour")}_${get("minute")}_${get("second")}`;
}

function formatStamp(date) {
  return formatDvrTime(date);
}

export function buildPlaybackUrl(dvr, channel, start, end) {
  const user = encodeUserInfo(dvr.username);
  const password = encodeUserInfo(dvr.password);
  const host = wrapHost(dvr.host);
  const port = dvr.rtspPort || 554;
  const startStr = formatStamp(start);
  const endStr = formatStamp(end);
  // Intelbras firmware under test 404s if subtype is present on /cam/playback.
  return `rtsp://${user}:${password}@${host}:${port}/cam/playback?channel=${channel}&starttime=${startStr}&endtime=${endStr}`;
}

export function redactSecrets(text, secrets) {
  let out = String(text || "");
  const list = [...secrets].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const secret of list) {
    out = out.replaceAll(secret, "***");
    const encoded = encodeURIComponent(secret);
    if (encoded && encoded !== secret) out = out.replaceAll(encoded, "***");
  }
  return out.replaceAll(/(rtsp:\/\/[^:\s]+:)[^@\s]+@/g, "$1***@");
}

function parseHttpDateAsDvrLocal(header) {
  const match = String(header || "").match(
    /(\d{1,2}) ([A-Za-z]{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2})/
  );
  if (!match) return null;
  const [, day, mon, year, hour, minute, second] = match;
  const month = MONTHS[mon];
  if (!month) return null;
  // The DVR Date header uses local time but labels it GMT. Treat the clock
  // values as America/Sao_Paulo.
  const wanted = `${year}_${String(month).padStart(2, "0")}_${String(day).padStart(2, "0")}_${hour}_${minute}_${second}`;
  const dvrOffsetMin = tzOffsetMinutes(DVR_TZ, wanted);
  if (dvrOffsetMin == null) return null;
  return new Date(Date.UTC(
    Number(year), month - 1, Number(day),
    Number(hour), Number(minute), Number(second)
  ) - dvrOffsetMin * 60 * 1000);
}

function tzOffsetMinutes(timeZone, stamp) {
  // stamp: YYYY_MM_DD_HH_MM_SS as wall clock in timeZone; return offset (UTC-local is negative in Brazil).
  const [Y, M, D, h, m, s] = stamp.split("_").map(Number);
  const asUtc = Date.UTC(Y, M - 1, D, h, m, s);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(asUtc));
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  const asTzMs = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asTzMs - asUtc) / 60000);
}

export async function fetchDvrNow(host) {
  const url = `http://${wrapHost(host)}:8001/`;
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(5000),
    headers: { Accept: "text/html" },
  });
  const header = response.headers.get("date");
  const parsed = parseHttpDateAsDvrLocal(header);
  if (!parsed || Number.isNaN(parsed.getTime())) {
    throw new Error("Date header do DVR ausente ou inválido");
  }
  return parsed;
}

async function ensureClipDir() {
  await mkdir(CLIP_DIR, { recursive: true, mode: 0o700 });
  try {
    await stat(CLIP_DIR);
  } catch {
    // ignore
  }
}

async function cleanupOldClips() {
  const cutoff = Date.now() - CLIP_TTL_MS;
  let entries = [];
  try {
    entries = await readdir(CLIP_DIR, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return;
    throw err;
  }
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile()) return;
    const file = path.join(CLIP_DIR, entry.name);
    try {
      const info = await stat(file);
      if (info.mtimeMs < cutoff) await unlink(file);
    } catch {
      // ignore races
    }
  }));
}

function ffmpegTimeoutMs(seconds) {
  // Transcode runs near real time. Leave room for RTSP setup and retries.
  return Math.min(150_000, seconds * 3_000 + 40_000);
}

function looksLikeClientError(log) {
  const text = (log || "").toLowerCase();
  return (
    text.includes("404 not found") ||
    text.includes("server returned 4") ||
    text.includes("401 unauthorized") ||
    text.includes("403 forbidden")
  );
}

function runFfmpeg({ url, outfile, seconds, secrets }) {
  const args = [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-rtsp_transport", "tcp",
    "-timeout", "20000000",
    "-i", url,
    "-t", String(seconds),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-pix_fmt", "yuv420p",
    "-an",
    "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
    outfile,
  ];
  const timeoutMs = ffmpegTimeoutMs(seconds);
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    const onChunk = (buf) => {
      stderr += buf.toString("utf8");
      if (stderr.length > 32_000) stderr = stderr.slice(-16_000);
    };
    child.stderr?.on("data", onChunk);
    child.stdout?.on("data", onChunk);
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({
        code: 124,
        timedOut: true,
        log: redactSecrets(stderr, secrets),
      });
    }, timeoutMs);
    child.on("error", (err) => {
      finish({
        code: 1,
        timedOut: false,
        log: redactSecrets(`${stderr}\n${err.message}`, secrets),
      });
    });
    child.on("close", (code) => {
      finish({
        code: code ?? 1,
        timedOut: false,
        log: redactSecrets(stderr, secrets),
      });
    });
  });
}

async function resolveSrc(parsed) {
  const dvrs = await listDvrs();
  const dvr = dvrs.find((item) => item.id === parsed.dvrId);
  if (!dvr) return { error: "src não encontrado", status: 404 };
  const channels = dvr.channels || [];
  if (!channels.includes(parsed.channel)) {
    return { error: "canal não cadastrado neste DVR", status: 404 };
  }
  return { dvr };
}

export async function handleClip(req, res, next) {
  const parsedSrc = parseClipSrc(req.query.src);
  if (!parsedSrc) {
    return res.status(400).json({
      error: "src inválido. Use o streamName da câmera, ex.: dvr-beto-abc123_ch1 ou ..._ch1_main",
    });
  }
  const secondsParsed = parseSeconds(req.query.seconds);
  if (!secondsParsed.ok) {
    return res.status(400).json({ error: secondsParsed.error });
  }
  const seconds = secondsParsed.value;

  if (activeClips >= MAX_CONCURRENT) {
    return res.status(429).json({
      error: "Já há dois clipes sendo gerados. Tente de novo em instantes.",
    });
  }

  activeClips += 1;
  let outfile = "";
  try {
    await ensureClipDir();
    cleanupOldClips().catch(() => {});

    const resolved = await resolveSrc(parsedSrc);
    if (resolved.error) {
      return res.status(resolved.status).json({ error: resolved.error });
    }
    const { dvr } = resolved;
    const secrets = [dvr.password, dvr.username].filter(Boolean);

    let dvrNow;
    try {
      dvrNow = await fetchDvrNow(dvr.host);
    } catch (err) {
      return res.status(504).json({
        error: "Não consegui ler o relógio do DVR para montar o intervalo de playback",
        detail: err.message,
      });
    }

    outfile = path.join(
      CLIP_DIR,
      `clip-${parsedSrc.dvrId}-ch${parsedSrc.channel}-${Date.now()}-${process.pid}.mp4`
    );

    let lastLog = "";
    let lastCode = 0;
    let produced = false;
    let usedEndOffset = null;
    let usedStart = null;
    let usedEnd = null;
    let timedOut = false;

    for (const offset of END_OFFSETS_S) {
      const end = new Date(dvrNow.getTime() - offset * 1000);
      const start = new Date(end.getTime() - seconds * 1000);
      const url = buildPlaybackUrl(dvr, parsedSrc.channel, start, end);
      const result = await runFfmpeg({ url, outfile, seconds, secrets });
      lastLog = result.log;
      lastCode = result.code;
      timedOut = result.timedOut;
      let size = 0;
      try {
        size = (await stat(outfile)).size;
      } catch {
        size = 0;
      }
      if (size >= 1000 && (result.code === 0 || result.code === 124)) {
        // A timed-out transcode can still yield a playable fragmented MP4.
        produced = true;
        usedEndOffset = offset;
        usedStart = start;
        usedEnd = end;
        break;
      }
      if (result.timedOut && size < 1000) {
        break;
      }
      if (!looksLikeClientError(result.log) && result.code !== 0 && size < 1000) {
        // Unexpected failure; still try the next offset once, unless it is a hard spawn error.
        if (result.log.includes("ENOENT") || result.log.toLowerCase().includes("ffmpeg")) {
          // keep trying other offsets
        }
      }
    }

    if (!produced) {
      if (timedOut) {
        return res.status(504).json({
          error: "Tempo esgotado ao gerar o clipe a partir do DVR",
        });
      }
      console.warn(`[clip] falhou src=${parsedSrc.streamName} exit=${lastCode} ${lastLog.slice(-400)}`);
      return res.status(409).json({
        error: "O DVR não devolveu gravação para esse intervalo. Confira se o canal está gravando.",
      });
    }

    const fileStat = await stat(outfile);
    res.status(200);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Length", String(fileStat.size));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="clip-${parsedSrc.dvrId}-ch${parsedSrc.channel}-${seconds}s.mp4"`
    );
    res.setHeader("X-Clip-Seconds", String(seconds));
    res.setHeader("X-Clip-End-Offset-Seconds", String(usedEndOffset));
    res.setHeader("X-Clip-Start", formatStamp(usedStart));
    res.setHeader("X-Clip-End", formatStamp(usedEnd));

    await new Promise((resolve, reject) => {
      const stream = createReadStream(outfile);
      stream.on("error", reject);
      res.on("close", () => {
        stream.destroy();
        resolve();
      });
      res.on("finish", resolve);
      stream.pipe(res);
    });
  } catch (err) {
    next(err);
  } finally {
    activeClips = Math.max(0, activeClips - 1);
    if (outfile) {
      unlink(outfile).catch(() => {});
    }
  }
}

export const clipLimits = {
  MIN_SECONDS,
  MAX_SECONDS,
  DEFAULT_SECONDS,
  MAX_CONCURRENT,
};
