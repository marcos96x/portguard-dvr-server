import { config } from "./config.js";
import { streamName, streamVariants } from "./rtsp.js";

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
    // mode=webrtc: menor latencia. iframeMse fica de reserva.
    iframe: `${http}/stream.html?src=${src}&mode=webrtc`,
    iframeMse: `${http}/stream.html?src=${src}&mode=mse`,
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
    const main = streamVariants(dvr, channel).find((item) => item.kind === "main");
    const mainName = main ? main.name : name;
    return {
      channel,
      streamName: name,
      urls: cameraUrls(name),
      streamNameMain: mainName,
      urlsMain: cameraUrls(mainName),
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
