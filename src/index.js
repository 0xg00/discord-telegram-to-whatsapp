import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function run(script) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [join(__dirname, script)], { stdio: "inherit" });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${script} salio ${code}`))));
  });
}

console.log("== Paso 1: sacar y convertir stickers de Discord ==");
await run("discord.js");
console.log("\n== Paso 2: mandar a WhatsApp ==");
await run("whatsapp.js");
