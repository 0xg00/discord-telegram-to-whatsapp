import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import protobuf from "protobufjs";
import ffmpegPath from "ffmpeg-static";
import { imageToStickerWebp, isAnimated } from "./convert.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const RAW = join(ROOT, "stickers", "gif-raw");
const WEBP = join(ROOT, "stickers", "gif-webp");
const MANIFEST = join(ROOT, "stickers", "manifest_gifs.json");

const API = "https://discord.com/api/v10";
const GIF_IMAGE = 1, GIF_VIDEO = 2;

try { process.loadEnvFile(join(ROOT, ".env")); } catch { /* optional */ }
const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) { console.error("ERROR: falta DISCORD_TOKEN en .env"); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getFavoriteGifs() {
  const res = await fetch(`${API}/users/@me/settings-proto/2`, { headers: { Authorization: TOKEN } });
  if (!res.ok) throw new Error(`settings-proto ${res.status}`);
  const { settings } = await res.json();
  if (!settings) return [];
  const root = await protobuf.load(join(__dirname, "proto", "frecency.proto"));
  const Frec = root.lookupType("FrecencyUserSettings");
  const dec = Frec.decode(Buffer.from(settings, "base64"));
  const gifs = dec?.favoriteGifs?.gifs ?? {};
  // keep the map key (canonical url) as a stable id for dedup across runs
  return Object.entries(gifs)
    .map(([key, g]) => ({ key, ...g }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const MAX_ANIMATED = 500 * 1024;

// any animated input (gif or mp4) -> animated WebP via bundled ffmpeg.
// `scale` is the inner content size; canvas is always padded to 512x512.
function ffmpegToWebp(inPath, outPath, fps, quality, scale) {
  const vf = `fps=${fps},scale=${scale}:${scale}:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000`;
  const args = ["-y", "-i", inPath, "-vcodec", "libwebp", "-filter:v", vf,
    "-lossless", "0", "-compression_level", "5", "-q:v", String(quality),
    "-loop", "0", "-preset", "default", "-an", "-vsync", "0", outPath];
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "ignore"] });
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg salio ${code}`))));
  });
}

// encode animated webp, stepping fps/quality (and finally scale) down until
// it fits WhatsApp's 500KB animated budget.
async function animatedUnderBudget(inPath, outPath, statFn) {
  const ladders = [
    [512, [[15, 75], [12, 55], [10, 40], [8, 28], [6, 20]]],
    [400, [[10, 38], [8, 24]]],
    [320, [[8, 24], [6, 14]]],
    [256, [[6, 14], [5, 10], [4, 8]]],
  ];
  for (const [scale, steps] of ladders) {
    for (const [fps, q] of steps) {
      await ffmpegToWebp(inPath, outPath, fps, q, scale);
      if ((await statFn(outPath)).size <= MAX_ANIMATED) return;
    }
  }
  // keep last attempt even if still slightly over
}

async function main() {
  await mkdir(RAW, { recursive: true });
  await mkdir(WEBP, { recursive: true });

  console.log("Leyendo GIFs favoritos de tu cuenta...");
  const gifs = await getFavoriteGifs();
  console.log(`GIFs favoritos: ${gifs.length}`);
  if (!gifs.length) { console.log("Cero GIFs favoritos."); return; }

  const { stat } = await import("node:fs/promises");
  const manifest = [];
  for (const [i, g] of gifs.entries()) {
    const id = String(i + 1).padStart(3, "0");
    const tag = `[${i + 1}/${gifs.length}]`;
    try {
      const isVideo = g.format === GIF_VIDEO;
      // for images, drop the format=webp param so Discord serves the native
      // file (gif stays gif, png/jpg stay static) -> avoids 415 on non-gifs
      const url = isVideo
        ? g.src
        : g.src.replace(/format=webp&?/, "").replace(/[?&]$/, "");
      const rawPath = join(RAW, `${id}.${isVideo ? "mp4" : "media"}`);
      await writeFile(rawPath, await download(url));

      const outPath = join(WEBP, `${id}.webp`);
      // VIDEO is always animated; for images probe frame count
      const animated = isVideo || (await isAnimated(rawPath));
      let kind;
      if (animated) {
        await animatedUnderBudget(rawPath, outPath, stat);
        kind = isVideo ? "mp4" : "gif";
      } else {
        const { buffer } = await imageToStickerWebp(rawPath, false);
        await writeFile(outPath, buffer);
        kind = "img";
      }
      const kb = ((await stat(outPath)).size / 1024) | 0;
      const over = kb > 500 ? " OVER!" : "";
      console.log(`${tag} ${kind} -> ${id}.webp ${kb}KB${animated ? " animado" : ""}${over}`);
      manifest.push({ id, key: g.key, name: `gif ${i + 1}`, animated, webp: `gif-webp/${id}.webp` });
    } catch (err) {
      console.warn(`${tag} FALLO: ${err.message}`);
      manifest.push({ id, error: err.message });
    }
    await sleep(150);
  }

  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2));
  const ok = manifest.filter((m) => m.webp).length;
  console.log(`\nListo. ${ok}/${gifs.length} GIFs convertidos -> stickers/gif-webp/`);
  console.log("Siguiente: MANIFEST=manifest_gifs.json npm run send");
}

main().catch((e) => { console.error(e); process.exit(1); });
