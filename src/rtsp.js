const INTELBRAS_TEMPLATE =
  "rtsp://{username}:{password}@{host}:{rtspPort}/cam/realmonitor?channel={channel}&subtype={subtype}";

const BRAND_TEMPLATES = {
  intelbras: INTELBRAS_TEMPLATE,
};

export function normalizeChannels(channels) {
  if (typeof channels === "number" && Number.isInteger(channels) && channels > 0) {
    return Array.from({ length: channels }, (_, i) => i + 1);
  }
  if (Array.isArray(channels) && channels.length > 0) {
    const parsed = channels.map((value) => Number(value));
    if (parsed.every((n) => Number.isInteger(n) && n > 0)) {
      return [...new Set(parsed)].sort((a, b) => a - b);
    }
  }
  return null;
}

export function wrapHost(host) {
  const value = String(host || "").trim();
  if (!value) return value;
  if (value.includes(":") && !value.startsWith("[") && !value.includes("]")) {
    return `[${value}]`;
  }
  return value;
}

export function resolveTemplate(dvr) {
  if (dvr.rtspTemplate) return dvr.rtspTemplate;
  const brand = (dvr.brand || "intelbras").toLowerCase();
  return BRAND_TEMPLATES[brand] || INTELBRAS_TEMPLATE;
}

export function buildRtspUrl(dvr, channel, subtype = dvr.subtype) {
  const template = resolveTemplate(dvr);
  const values = {
    username: encodeURIComponent(dvr.username),
    password: encodeURIComponent(dvr.password),
    host: wrapHost(dvr.host),
    rtspPort: String(dvr.rtspPort),
    port: String(dvr.rtspPort),
    channel: String(channel),
    subtype: String(subtype),
  };
  return template.replace(/\{(username|password|host|rtspPort|port|channel|subtype)\}/g, (_, key) => values[key]);
}

export function streamName(dvrId, channel) {
  return `${dvrId}_ch${channel}`;
}

export function mainStreamName(dvrId, channel) {
  return `${dvrId}_ch${channel}_main`;
}

/**
 * Cada canal tem dois streams no go2rtc:
 *  - `<id>_chN`      substream (subtype do DVR, padrao 1): leve, para grade
 *  - `<id>_chN_main` stream principal (subtype 0): qualidade cheia
 * Se o DVR ja estiver com subtype 0, so existe o primeiro.
 */
export function streamVariants(dvr, channel) {
  const list = [{ name: streamName(dvr.id, channel), channel, subtype: dvr.subtype, kind: "sub" }];
  if (Number(dvr.subtype) !== 0) {
    list.push({ name: mainStreamName(dvr.id, channel), channel, subtype: 0, kind: "main" });
  }
  return list;
}

export function allStreamVariants(dvr) {
  return dvr.channels.flatMap((channel) => streamVariants(dvr, channel));
}

export function streamNamesFor(dvr) {
  return allStreamVariants(dvr).map((item) => item.name);
}
