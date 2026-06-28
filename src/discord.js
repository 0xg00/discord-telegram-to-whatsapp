import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import protobuf from "protobufjs";
import { toStickerWebp, FORMAT } from "./convert.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const RAW = join(ROOT, "stickers", "raw");
const WEBP = join(ROOT, "stickers", "webp");
const MANIFEST = join(ROOT, "stickers", "manifest.json");

const API = "https://discord.com/api/v10";
const CDN = "https://media.discordapp.net/stickers";

// Node 22: load .env if present (DISCORD_TOKEN=...)
try { process.loadEnvFile(join(ROOT, ".env")); } catch { /* no .env, use process.env */ }

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error("ERROR: falta DISCORD_TOKEN. Pon tu token de usuario en .env");
  process.exit(1);
}

const auth = { Authorization: TOKEN };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fetch wrapper that respects Discord 429 rate limits
async function dapi(url) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: auth });
    if (res.status === 429) {
      const retry = Number(res.headers.get("retry-after") || 1);
      console.warn(`  rate limited, espero ${retry}s`);
      await sleep(retry * 1000 + 250);
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} @ ${url}`);
    return res;
  }
  throw new Error(`rate limit no cede @ ${url}`);
}

// 1. read favorite sticker IDs from FrecencyUserSettings proto
async function getFavoriteStickerIds() {
  const res = await dapi(`${API}/users/@me/settings-proto/2`);
  const { settings } = await res.json();
  if (!settings) return [];

  const root = await protobuf.load(join(__dirname, "proto", "frecency.proto"));
  const Frec = root.lookupType("FrecencyUserSettings");
  const decoded = Frec.decode(Buffer.from(settings, "base64"));
  const ids = decoded?.favoriteStickers?.stickerIds ?? [];
  // fixed64 come back as Long; snowflakes < 2^63 so toString() is safe
  return ids.map((id) => (id?.toString ? id.toString() : String(id)));
}

// 2. sticker metadata (name + format_type)
async function getStickerMeta(id) {
  const res = await dapi(`${API}/stickers/${id}`);
  return res.json(); // { id, name, format_type, ... }
}

function assetUrl(id, formatType) {
  if (formatType === FORMAT.LOTTIE) return `${CDN}/${id}.json`;
  if (formatType === FORMAT.GIF) return `${CDN}/${id}.gif`;
  return `${CDN}/${id}.png`; // PNG + APNG
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} @ ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  await mkdir(RAW, { recursive: true });
  await mkdir(WEBP, { recursive: true });

  console.log("Leyendo stickers favoritos de tu cuenta...");
  const ids = await getFavoriteStickerIds();
  console.log(`Favoritos encontrados: ${ids.length}`);
  if (ids.length === 0) {
    console.log("Cero favoritos. Marca stickers con la estrella en Discord y reintenta.");
    return;
  }

  const manifest = [];
  for (const [i, id] of ids.entries()) {
    const tag = `[${i + 1}/${ids.length}] ${id}`;
    try {
      const meta = await getStickerMeta(id);
      const ext = meta.format_type === FORMAT.LOTTIE ? "json"
        : meta.format_type === FORMAT.GIF ? "gif" : "png";
      const rawBuf = await download(assetUrl(id, meta.format_type));
      await writeFile(join(RAW, `${id}.${ext}`), rawBuf);

      if (meta.format_type === FORMAT.LOTTIE) {
        console.log(`${tag} "${meta.name}" LOTTIE -> saltado (fase 2)`);
        manifest.push({ id, name: meta.name, format_type: meta.format_type, skipped: true });
      } else {
        const { buffer, animated, degraded } = await toStickerWebp(
          join(RAW, `${id}.${ext}`),
          meta.format_type
        );
        await writeFile(join(WEBP, `${id}.webp`), buffer);
        const note = degraded ? " (animado fallo -> estatico)" : "";
        console.log(`${tag} "${meta.name}" -> webp ${(buffer.length / 1024) | 0}KB${animated ? " animado" : ""}${note}`);
        manifest.push({
          id, name: meta.name, format_type: meta.format_type,
          animated, webp: `webp/${id}.webp`,
        });
      }
    } catch (err) {
      console.warn(`${tag} FALLO: ${err.message}`);
      manifest.push({ id, error: err.message });
    }
    await sleep(300); // be gentle with Discord
  }

  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2));
  const ok = manifest.filter((m) => m.webp).length;
  console.log(`\nListo. ${ok} stickers convertidos -> stickers/webp/`);
  console.log(`Manifest: stickers/manifest.json`);
  console.log(`Siguiente: npm run send`);
}

main().catch((e) => { console.error(e); process.exit(1); });
