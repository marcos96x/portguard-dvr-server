import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

const DEFAULT_DATA = { dvrs: [] };

function dataFile() {
  return path.join(config.dataDir, "dvrs.json");
}

function tmpFile() {
  return `${dataFile()}.tmp`;
}

export async function loadStore() {
  await mkdir(config.dataDir, { recursive: true });
  try {
    const raw = await readFile(dataFile(), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.dvrs)) return structuredClone(DEFAULT_DATA);
    return parsed;
  } catch (err) {
    if (err.code === "ENOENT") return structuredClone(DEFAULT_DATA);
    throw err;
  }
}

export async function saveStore(data) {
  await mkdir(config.dataDir, { recursive: true });
  const file = dataFile();
  const tmp = tmpFile();
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  await writeFile(tmp, payload, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, file);
}

export async function listDvrs() {
  const store = await loadStore();
  return store.dvrs;
}

export async function getDvr(id) {
  const store = await loadStore();
  return store.dvrs.find((dvr) => dvr.id === id) || null;
}

export async function upsertDvr(dvr) {
  const store = await loadStore();
  const index = store.dvrs.findIndex((item) => item.id === dvr.id);
  if (index === -1) store.dvrs.push(dvr);
  else store.dvrs[index] = dvr;
  await saveStore(store);
  return dvr;
}

export async function removeDvr(id) {
  const store = await loadStore();
  const current = store.dvrs.find((dvr) => dvr.id === id);
  if (!current) return null;
  store.dvrs = store.dvrs.filter((dvr) => dvr.id !== id);
  await saveStore(store);
  return current;
}
