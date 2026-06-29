import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import puppeteer from "puppeteer";

const require = createRequire(import.meta.url);
const LOTTIE_JS = readFileSync(require.resolve("lottie-web/build/player/lottie.min.js"), "utf8");

let browser = null;
async function getBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }
  return browser;
}

export async function closeTgs() {
  if (browser) { await browser.close(); browser = null; }
}

// Render a .tgs (gzipped Lottie) buffer into a temp dir of PNG frames.
// Returns { dir, pattern, framerate, frames }. Caller encodes + cleans up.
export async function tgsToFrames(tgsBuf) {
  const json = JSON.parse(gunzipSync(tgsBuf).toString("utf8"));
  const srcFps = json.fr || 60;
  const total = Math.max(1, Math.round((json.op ?? 0) - (json.ip ?? 0)));
  const targetFps = Math.min(30, srcFps);
  const step = Math.max(1, Math.round(srcFps / targetFps));

  const b = await getBrowser();
  const page = await b.newPage();
  try {
    await page.setViewport({ width: 512, height: 512, deviceScaleFactor: 1 });
    await page.setContent(
      `<!doctype html><html><head><style>html,body{margin:0;background:transparent}
       #c{width:512px;height:512px}</style></head><body><div id="c"></div></body></html>`
    );
    await page.addScriptTag({ content: LOTTIE_JS });
    await page.evaluate((data) => {
      window.__anim = lottie.loadAnimation({
        container: document.getElementById("c"),
        renderer: "canvas",
        loop: false,
        autoplay: false,
        animationData: data,
        rendererSettings: { clearCanvas: true },
      });
    }, json);

    const dir = await mkdtemp(join(tmpdir(), "tgs-"));
    let n = 0;
    for (let f = 0; f < total; f += step) {
      const dataUrl = await page.evaluate((fr) => {
        window.__anim.goToAndStop(fr, true);
        const cv = document.querySelector("#c canvas");
        return cv ? cv.toDataURL("image/png") : null;
      }, f);
      if (!dataUrl) continue;
      await writeFile(join(dir, `f${String(n).padStart(4, "0")}.png`), Buffer.from(dataUrl.split(",")[1], "base64"));
      n++;
    }
    await page.close();
    if (n === 0) { await rm(dir, { recursive: true, force: true }); throw new Error("tgs sin frames"); }
    return { dir, pattern: join(dir, "f%04d.png"), framerate: targetFps, frames: n };
  } catch (err) {
    if (!page.isClosed()) await page.close();
    throw err;
  }
}
