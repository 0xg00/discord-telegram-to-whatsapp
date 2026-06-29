import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
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

  const limit = Number(process.env.LIMIT || 0);
  const offset = Number(process.env.OFFSET || 0);
  const delayMs = Number(process.env.DELAY_MS || 2500);

  const force = process.env.FORCE === "1";
  const stickerAuthor = process.env.STICKER_AUTHOR || "Discord";

  // destination: a WhatsApp Channel (WA_CHANNEL = link or invite code) or a chat.
  // Channels: only admins can post. ACK events may not fire, so we count a
  // non-throwing send as delivered there.
  const channelRaw = (process.env.WA_CHANNEL || "").trim();
  const channelMode = !!channelRaw;
  let dest, destId;
  if (channelMode) {
    // getChannelByInviteCode is broken on current WA Web, so resolve from the
    // channels you already follow/own. Match by JID, then by name.
    const want = channelRaw.split("/").pop().trim();
    const channels = await client.getChannels();
    dest = channels.find((c) => c.id?._serialized === want)
      || channels.find((c) => (c.name || "").toLowerCase() === want.toLowerCase());
    if (!dest) {
      throw new Error(`canal "${want}" no encontrado. Tus canales: ${channels.map((c) => `${c.name} (${c.id?._serialized})`).join(", ") || "ninguno"}`);
    }
    destId = dest.id._serialized;
    console.log(`Canal: "${dest.name}" (${destId})`);
  } else {
    destId = process.env.WA_TARGET_CHAT || client.info.wid._serialized;
    dest = await client.getChatById(destId);
  }

  const manifestFile = process.env.MANIFEST || "manifest.json";
  let items = JSON.parse(await readFile(join(STICKERS, manifestFile), "utf8")).filter((m) => m.webp);
  if (offset > 0) items = items.slice(offset);
  if (limit > 0) items = items.slice(0, limit);

  // dedup: remember what already reached this destination so re-runs don't repeat
  const SENT = join(STICKERS, "sent.json");
  let sentDb = {};
  try { sentDb = JSON.parse(await readFile(SENT, "utf8")); } catch { /* first run */ }
  const sentSet = new Set(sentDb[destId] || []);
  const keyOf = (m) => m.key || m.id;

  if (!force) {
    const before = items.length;
    items = items.filter((m) => !sentSet.has(keyOf(m)));
    if (before !== items.length) console.log(`Dedup: ${before - items.length} ya enviados, salto`);
  }
  console.log(`Destino: ${channelMode ? "CANAL " : ""}${destId} | manifest: ${manifestFile} | a mandar: ${items.length}`);

  const ackTimeout = channelMode ? 8000 : 20000;

  let sent = 0, acked = 0;
  for (const [i, m] of items.entries()) {
    const tag = `[${i + 1}/${items.length}] "${m.name}"`;
    try {
      const media = MessageMedia.fromFilePath(join(STICKERS, m.webp));
      const msg = await dest.sendMessage(media, {
        sendMediaAsSticker: true,
        stickerName: m.name,
        stickerAuthor,
      });
      sent++;
      const ack = await waitForAck(msg.id._serialized, ackTimeout);
      // channels rarely emit ack; a successful send is enough there
      const delivered = channelMode || ack >= 1;
      if (delivered) {
        acked++;
        sentSet.add(keyOf(m));
        sentDb[destId] = [...sentSet];
        await writeFile(SENT, JSON.stringify(sentDb, null, 2)); // persist after each delivery
      }
      console.log(`${tag} enviado ack=${ack}${channelMode ? " (canal)" : ""}`);
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
