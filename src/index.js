import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));

// source -> { label, pull script, manifest for send }
const SOURCES = {
  "1": { label: "Discord stickers", pull: "discord.js", manifest: "manifest.json", author: "Discord" },
  "2": { label: "Discord GIFs", pull: "gifs.js", manifest: "manifest_gifs.json", author: "Discord" },
  "3": { label: "Telegram stickers", pull: "telegram.js", manifest: "manifest_telegram.json", author: "Telegram" },
};

function run(script, env = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [join(__dirname, script)], {
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`))));
  });
}

const rl = readline.createInterface({ input: stdin, output: stdout });
try {
  console.log("\n=== Discord/Telegram -> WhatsApp stickers ===\n");
  console.log("Source:");
  for (const [k, s] of Object.entries(SOURCES)) console.log(`  ${k}) ${s.label}`);
  const sKey = (await rl.question("> ")).trim();
  const src = SOURCES[sKey];
  if (!src) { console.log("Invalid option"); process.exit(1); }

  console.log("\nAction:");
  console.log("  1) Pull + send");
  console.log("  2) Pull only (download+convert)");
  console.log("  3) Send only (already-converted files)");
  const action = (await rl.question("> ")).trim();
  rl.close();

  const pullPath = join(__dirname, src.pull);
  if ((action === "1" || action === "2")) {
    if (!existsSync(pullPath)) { console.log(`Missing ${src.pull} (source not implemented yet)`); process.exit(1); }
    console.log(`\n== Pulling: ${src.label} ==`);
    await run(src.pull);
  }
  if (action === "1" || action === "3") {
    console.log(`\n== Sending: ${src.label} ==`);
    await run("whatsapp.js", { MANIFEST: src.manifest, STICKER_AUTHOR: src.author });
  }
  console.log("\nDone.");
} finally {
  rl.close();
}
