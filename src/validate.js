import { randomBytes } from "node:crypto";
import { normalizeChannels } from "./rtsp.js";
import { PASSWORD_MASK } from "./urls.js";

const ID_RE = /^[a-z0-9]+(?:[a-z0-9-]{0,46}[a-z0-9])?$/;

function slugify(name) {
  const slug = String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return slug || "dvr";
}

export function makeId(name) {
  return `${slugify(name)}-${randomBytes(3).toString("hex")}`;
}

export function isValidId(id) {
  return typeof id === "string" && ID_RE.test(id) && !id.includes("_");
}

export function parseDvrInput(body, { partial = false, current = null } = {}) {
  const errors = [];
  const src = body && typeof body === "object" ? body : {};

  const name = src.name != null ? String(src.name).trim() : current?.name;
  if (!partial || src.name != null) {
    if (!name) errors.push("name é obrigatório");
  }

  const host = src.host != null ? String(src.host).trim() : current?.host;
  if (!partial || src.host != null) {
    if (!host) errors.push("host é obrigatório (DDNS ou IP do DVR)");
  }

  let rtspPort = current?.rtspPort ?? 554;
  if (src.rtspPort != null && src.rtspPort !== "") {
    rtspPort = Number(src.rtspPort);
    if (!Number.isInteger(rtspPort) || rtspPort < 1 || rtspPort > 65535) {
      errors.push("rtspPort deve ser um inteiro entre 1 e 65535");
    }
  }

  let username = current?.username;
  if (src.username != null) username = String(src.username);
  if (!partial || src.username != null) {
    if (!username) errors.push("username é obrigatório");
  }

  let password = current?.password;
  if (src.password != null && src.password !== PASSWORD_MASK) {
    password = String(src.password);
  }
  if (!partial || (src.password != null && src.password !== PASSWORD_MASK)) {
    if (!password) errors.push("password é obrigatório");
  }

  let channels = current?.channels;
  if (src.channels != null) {
    channels = normalizeChannels(src.channels);
    if (!channels) errors.push("channels deve ser a quantidade (ex.: 4) ou um array de números (ex.: [1, 3, 5])");
  } else if (!partial) {
    errors.push("channels é obrigatório");
  }

  let subtype = current?.subtype ?? 1;
  if (src.subtype != null && src.subtype !== "") {
    subtype = Number(src.subtype);
    if (!Number.isInteger(subtype) || subtype < 0) {
      errors.push("subtype deve ser um inteiro >= 0 (0 = principal, 1 = substream)");
    }
  }

  const brand = src.brand != null ? String(src.brand).trim() || "intelbras" : current?.brand || "intelbras";
  const rtspTemplate =
    src.rtspTemplate != null
      ? String(src.rtspTemplate).trim() || null
      : current?.rtspTemplate ?? null;

  if (errors.length) return { errors };

  return {
    errors: [],
    value: {
      name,
      host,
      rtspPort,
      username,
      password,
      channels,
      subtype,
      brand,
      rtspTemplate,
    },
  };
}
