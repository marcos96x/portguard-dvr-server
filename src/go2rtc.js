import { config } from "./config.js";
import { buildRtspUrl, allStreamVariants, streamNamesFor } from "./rtsp.js";

const TIMEOUT_MS = 8000;

function authHeaders(extra = {}) {
  const headers = { ...extra };
  if (config.go2rtcUsername) {
    const token = Buffer.from(
      `${config.go2rtcUsername}:${config.go2rtcPassword}`,
      "utf8"
    ).toString("base64");
    headers.Authorization = `Basic ${token}`;
  }
  return headers;
}

export async function go2rtcRequest(method, pathname, { timeout = TIMEOUT_MS } = {}) {
  const url = `${config.go2rtcUrl}${pathname}`;
  const response = await fetch(url, {
    method,
    headers: authHeaders(),
    signal: AbortSignal.timeout(timeout),
  });
  const text = await response.text();
  let body = text;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { ok: response.ok, status: response.status, body };
}

export async function pingGo2rtc() {
  try {
    const result = await go2rtcRequest("GET", "/api/streams", { timeout: 4000 });
    return {
      reachable: result.ok || result.status === 401 || result.status === 403,
      status: result.status,
      authorized: result.ok,
    };
  } catch (err) {
    return { reachable: false, status: 0, authorized: false, error: err.message };
  }
}

export async function listGo2rtcStreams() {
  const result = await go2rtcRequest("GET", "/api/streams");
  if (!result.ok) {
    const detail = typeof result.body === "string" ? result.body : JSON.stringify(result.body);
    throw new Error(`go2rtc GET /api/streams falhou (${result.status}): ${detail}`);
  }
  return result.body && typeof result.body === "object" ? result.body : {};
}

function bodyText(body) {
  if (body == null) return "";
  return typeof body === "string" ? body : JSON.stringify(body);
}

// go2rtc 1.9.x cria/apaga o stream na memória e depois tenta gravar no YAML.
// Sem a chave `streams:` no arquivo, o DELETE (e às vezes o PUT) responde 400
// "yaml: path not exist", mesmo com a operação em memória já concluída.
// "config file disabled" aparece quando o go2rtc sobe com config em string.
function isConfigPatchNoise(result) {
  const detail = bodyText(result.body).toLowerCase();
  return (
    (result.status === 400 || result.status === 410) &&
    (detail.includes("yaml: path not exist") ||
      detail.includes("config file disabled") ||
      detail.includes("gone"))
  );
}

export async function putStream(name, rtspUrl) {
  const qs = new URLSearchParams({ name, src: rtspUrl });
  const result = await go2rtcRequest("PUT", `/api/streams?${qs.toString()}`);
  if (!result.ok && !isConfigPatchNoise(result)) {
    throw new Error(`go2rtc PUT stream ${name} falhou (${result.status}): ${bodyText(result.body)}`);
  }
  return result;
}

export async function deleteStream(name) {
  const qs = new URLSearchParams({ src: name });
  const result = await go2rtcRequest("DELETE", `/api/streams?${qs.toString()}`);
  // 404 = já não existia; 400 de patch do YAML também é aceitável
  if (!result.ok && result.status !== 404 && !isConfigPatchNoise(result)) {
    throw new Error(`go2rtc DELETE stream ${name} falhou (${result.status}): ${bodyText(result.body)}`);
  }
  return result;
}

export async function recreateDvrStreams(dvr) {
  const results = [];
  for (const { name, channel, subtype } of allStreamVariants(dvr)) {
    const src = buildRtspUrl(dvr, channel, subtype);
    try {
      await deleteStream(name);
      await putStream(name, src);
      results.push({ streamName: name, channel, ok: true });
    } catch (err) {
      results.push({ streamName: name, channel, ok: false, error: err.message });
    }
  }
  return results;
}

export async function removeDvrStreams(dvr) {
  const results = [];
  for (const name of streamNamesFor(dvr)) {
    try {
      await deleteStream(name);
      results.push({ streamName: name, ok: true });
    } catch (err) {
      results.push({ streamName: name, ok: false, error: err.message });
    }
  }
  return results;
}

export function summarizeSync(results) {
  const failed = results.filter((item) => !item.ok);
  return {
    synced: failed.length === 0,
    created: results.filter((item) => item.ok).length,
    failed: failed.length,
    errors: failed,
  };
}

/**
 * Recria apenas streams ausentes (ou com fonte diferente), para não
 * derrubar quem já está assistindo durante o sync periódico.
 */
export async function ensureAllStreams(dvrs) {
  let existing = {};
  try {
    existing = await listGo2rtcStreams();
  } catch (err) {
    const results = [];
    for (const dvr of dvrs) {
      const created = await recreateDvrStreams(dvr);
      results.push(...created);
    }
    return { ...summarizeSync(results), mode: "full", go2rtcError: err.message };
  }

  const results = [];
  const expected = new Set();

  for (const dvr of dvrs) {
    for (const { name, channel, subtype } of allStreamVariants(dvr)) {
      const src = buildRtspUrl(dvr, channel, subtype);
      expected.add(name);
      const current = existing[name];
      const sources = Array.isArray(current)
        ? current
        : current?.producers || current?.sources || [];
      const hasSrc = sources.some((item) => {
        const url = typeof item === "string" ? item : item?.url || item?.src || "";
        return url === src;
      }) || (typeof current === "string" && current === src);

      // A resposta do GET /api/streams varia um pouco entre versões.
      // Se o nome já existe, consideramos ok e só recriamos se faltar.
      const exists = current != null;
      if (exists && (hasSrc || sources.length === 0 || !Array.isArray(sources))) {
        results.push({ streamName: name, channel, ok: true, skipped: true });
        continue;
      }
      try {
        if (exists) await deleteStream(name);
        await putStream(name, src);
        results.push({ streamName: name, channel, ok: true });
      } catch (err) {
        results.push({ streamName: name, channel, ok: false, error: err.message });
      }
    }
  }

  return { ...summarizeSync(results), mode: "ensure", expected: expected.size };
}
