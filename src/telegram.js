import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFile, mkdir, readFile, stat, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { imageToStickerWebp, ffmpegAnimatedUnderBudget } from "./convert.js";
import { tgsToFrames, closeTgs } from "./tgs.js";

// gramjs is CommonJS -> load via require to avoid ESM interop pitfalls
const require = createRequire(import.meta.url);
const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const bigInt = require("big-integer");

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const RAW = join(ROOT, "stickers", "tg-raw");
const WEBP = join(ROOT, "stickers", "tg-webp");
const MANIFEST = join(ROOT, "stickers", "manifest_telegram.json");
const SESSION_FILE = join(ROOT, ".tg_session");

try { process.loadEnvFile(join(ROOT, ".env")); } catch { /* optional */ }
const API_ID = Number(process.env.TG_API_ID);
const API_HASH = process.env.TG_API_HASH;
const LIMIT_PACKS = Number(process.env.TG_LIMIT_PACKS || 0);

if (!API_ID || !API_HASH) {
  console.error("ERROR: falta TG_API_ID / TG_API_HASH en .env (sacalos de my.telegram.org)");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mimeKind(doc) {
  if (doc.mimeType === "application/x-tgsticker") return "tgs";
  if (doc.mimeType === "video/webm") return "webm";
  return "webp"; // image/webp and anything else static
}

function emojiOf(doc) {
  const a = (doc.attributes || []).find((x) => x instanceof Api.DocumentAttributeSticker);
  return a?.alt || "";
}

async function main() {
  await mkdir(RAW, { recursive: true });
  await mkdir(WEBP, { recursive: true });

  const rl = readline.createInterface({ input: stdin, output: stdout });
  const ask = (q) => rl.question(q);

  const saved = existsSync(SESSION_FILE) ? await readFile(SESSION_FILE, "utf8") : "";
  const client = new TelegramClient(new StringSession(saved), API_ID, API_HASH, { connectionRetries: 5 });

  console.log("Conectando a Telegram...");
  await client.start({
    phoneNumber: async () => process.env.TG_PHONE || (await ask("Telefono (+34...): ")),
    password: async () => await ask("Password 2FA (vacio si no tienes): "),
    phoneCode: async () => await ask("Codigo recibido en Telegram: "),
    onError: (e) => console.log("Error login:", e.message),
  });
  await writeFile(SESSION_FILE, String(client.session.save()));
  console.log("Login OK. Sesion guardada en .tg_session\n");

  console.log("Listando tus packs de stickers...");
  const all = await client.invoke(new Api.messages.GetAllStickers({ hash: bigInt(0) }));
  let sets = all.sets || [];
  if (LIMIT_PACKS > 0) sets = sets.slice(0, LIMIT_PACKS);
  console.log(`Packs: ${sets.length}\n`);

  const manifest = [];
  let idx = 0;
  for (const s of sets) {
    let full;
    try {
      full = await client.invoke(new Api.messages.GetStickerSet({
        stickerset: new Api.InputStickerSetID({ id: s.id, accessHash: s.accessHash }),
        hash: 0,
      }));
    } catch (err) {
      console.warn(`pack "${s.title}" FALLO listar: ${err.message}`);
      continue;
    }
    const docs = full.documents || [];
    const short = full.set?.shortName || String(s.id);
    console.log(`== ${full.set?.title || short} (${docs.length}) ==`);

    for (const doc of docs) {
      idx++;
      const id = String(idx).padStart(4, "0");
      const kind = mimeKind(doc);
      const key = `${short}:${doc.id.toString()}`;
      const name = `${full.set?.title || short} ${emojiOf(doc)}`.trim();
      try {
        const buf = await client.downloadMedia(doc);
        const outPath = join(WEBP, `${id}.webp`);
        let animated = false;

        if (kind === "tgs") {
          const frames = await tgsToFrames(buf);
          try {
            await ffmpegAnimatedUnderBudget({ pattern: frames.pattern, framerate: frames.framerate }, outPath);
          } finally {
            await rm(frames.dir, { recursive: true, force: true });
          }
          animated = true;
        } else if (kind === "webm") {
          const rawPath = join(RAW, `${id}.webm`);
          await writeFile(rawPath, buf);
          await ffmpegAnimatedUnderBudget({ file: rawPath }, outPath);
          animated = true;
        } else {
          const rawPath = join(RAW, `${id}.webp`);
          await writeFile(rawPath, buf);
          const { buffer } = await imageToStickerWebp(rawPath, false);
          await writeFile(outPath, buffer);
        }

        const kb = ((await stat(outPath)).size / 1024) | 0;
        console.log(`  [${id}] ${kind} -> ${kb}KB${animated ? " animado" : ""}`);
        manifest.push({ id, key, name, animated, webp: `tg-webp/${id}.webp` });
      } catch (err) {
        console.warn(`  [${id}] ${kind} FALLO: ${err.message}`);
        manifest.push({ id, key, error: err.message });
      }
      await sleep(100);
    }
  }

  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2));
  await closeTgs();
  await client.destroy();
  rl.close();

  const ok = manifest.filter((m) => m.webp).length;
  console.log(`\nListo. ${ok} stickers convertidos -> stickers/tg-webp/`);
  console.log("Siguiente: MANIFEST=manifest_telegram.json npm run send");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
