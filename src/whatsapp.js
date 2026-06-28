import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";
import qrcode from "qrcode-terminal";
import QRCode from "qrcode";
import wweb from "whatsapp-web.js";

const { Client, LocalAuth, MessageMedia } = wweb;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const STICKERS = join(ROOT, "stickers");

try { process.loadEnvFile(join(ROOT, ".env")); } catch { /* optional */ }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: join(ROOT, ".wwebjs_auth") }),
  puppeteer: { headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] },
});

client.on("qr", async (qr) => {
  console.log("Escanea este QR con WhatsApp (Dispositivos vinculados):\n");
  qrcode.generate(qr, { small: true });
  try {
    await QRCode.toFile(join(ROOT, "wa-qr.png"), qr, { width: 512, margin: 2 });
    console.log("QR PNG -> wa-qr.png");
  } catch (e) {
    console.warn("no pude escribir wa-qr.png:", e.message);
  }
});

client.on("auth_failure", (m) => console.error("Auth fallo:", m));

client.on("ready", async () => {
  console.log("WhatsApp listo.");

  // target: WA_TARGET_CHAT del .env, o tu propio chat (mandartelo a ti mismo)
  const target = process.env.WA_TARGET_CHAT || client.info.wid._serialized;
  console.log(`Mandando stickers a: ${target}`);

  const manifest = JSON.parse(await readFile(join(STICKERS, "manifest.json"), "utf8"));
  const items = manifest.filter((m) => m.webp);
  console.log(`Stickers a mandar: ${items.length}`);

  let sent = 0;
  for (const [i, m] of items.entries()) {
    const tag = `[${i + 1}/${items.length}] "${m.name}"`;
    try {
      const path = join(STICKERS, m.webp);
      const b64 = (await readFile(path)).toString("base64");
      const media = new MessageMedia("image/webp", b64, `${m.id}.webp`);
      await client.sendMessage(target, media, {
        sendMediaAsSticker: true,
        stickerName: m.name,
        stickerAuthor: "Discord",
      });
      sent++;
      console.log(`${tag} enviado`);
    } catch (err) {
      console.warn(`${tag} FALLO: ${err.message}`);
    }
    await sleep(1500); // evita deteccion de spam
  }

  console.log(`\nListo. ${sent}/${items.length} stickers enviados.`);
  console.log("Cierra con Ctrl+C. La sesion queda guardada en .wwebjs_auth");
  await client.destroy();
  process.exit(0);
});

console.log("Arrancando WhatsApp Web...");
client.initialize();
