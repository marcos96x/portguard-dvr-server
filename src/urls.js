import { config } from "./config.js";
import { streamName } from "./rtsp.js";

function toWs(base) {
  if (base.startsWith("https://")) return `wss://${base.slice("https://".length)}`;
  if (base.startsWith("http://")) return `ws://${base.slice("http://".length)}`;
  return base;
}

export function cameraUrls(stream, publicBase = config.publicGo2rtcUrl) {
  const src = encodeURIComponent(stream);
  const http = publicBase;
  const ws = toWs(http);
  return {
    iframe: `${http}/stream.html?src=${src}`,
    webrtc: `${http}/api/webrtc?src=${src}`,
    webrtcPlayer: `${http}/webrtc.html?src=${src}`,
    mse: `${ws}/api/ws?src=${src}`,
    hls: `${http}/api/stream.m3u8?src=${src}`,
    snapshot: `${http}/api/frame.jpeg?src=${src}`,
    mjpeg: `${http}/api/stream.mjpeg?src=${src}`,
  };
}

export function camerasPayload(dvr) {
  return dvr.channels.map((channel) => {
    const name = streamName(dvr.id, channel);
    return {
      channel,
      streamName: name,
      urls: cameraUrls(name),
    };
  });
}

export const PASSWORD_MASK = "********";

export function publicDvr(dvr, extra = {}) {
  const { password, ...rest } = dvr;
  return {
    ...rest,
    password: PASSWORD_MASK,
    cameras: camerasPayload(dvr),
    ...extra,
  };
}
