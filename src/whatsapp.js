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

// track server ACKs: sendMessage resolves on local queue, NOT on delivery.
// We must wait for ack >= 1 (server received) or messages get silently dropped.
const ackWaiters = new Map(); // msgId -> resolve
client.on("message_ack", (msg, ack) => {
  const id = msg.id?._serialized;
  const r = id && ackWaiters.get(id);
  if (r && ack >= 1) { ackWaiters.delete(id); r(ack); }
});
function waitForAck(id, ms = 20000) {
  return new Promise((resolve) => {
    ackWaiters.set(id, resolve);
    setTimeout(() => { if (ackWaiters.delete(id)) resolve(0); }, ms);
  });
}

client.on("ready", async () => {
  console.log("WhatsApp listo. Esperando sync...");
  await sleep(6000); // settle: sending too early drops messages

  const target = process.env.WA_TARGET_CHAT || client.info.wid._serialized;
  const limit = Number(process.env.LIMIT || 0);
  const offset = Number(process.env.OFFSET || 0);
  const delayMs = Number(process.env.DELAY_MS || 2500);

  const manifestFile = process.env.MANIFEST || "manifest.json";
  let items = JSON.parse(await readFile(join(STICKERS, manifestFile), "utf8")).filter((m) => m.webp);
  if (offset > 0) items = items.slice(offset);
  if (limit > 0) items = items.slice(0, limit);
  console.log(`Destino: ${target} | manifest: ${manifestFile} | a mandar: ${items.length}`);

  const chat = await client.getChatById(target);

  let sent = 0, acked = 0;
  for (const [i, m] of items.entries()) {
    const tag = `[${i + 1}/${items.length}] "${m.name}"`;
    try {
      const media = MessageMedia.fromFilePath(join(STICKERS, m.webp));
      const msg = await chat.sendMessage(media, {
        sendMediaAsSticker: true,
        stickerName: m.name,
        stickerAuthor: "Discord",
      });
      sent++;
      const ack = await waitForAck(msg.id._serialized); // block until server confirms
      if (ack >= 1) acked++;
      console.log(`${tag} enviado ack=${ack}`);
    } catch (err) {
      console.warn(`${tag} FALLO: ${err.message}`);
    }
    await sleep(delayMs);
  }

  console.log(`\nListo. enviados=${sent} | confirmados_servidor=${acked}/${items.length}`);
  console.log("Cierra con Ctrl+C. La sesion queda guardada en .wwebjs_auth");
  await client.destroy();
  process.exit(0);
});

console.log("Arrancando WhatsApp Web...");
client.initialize();
