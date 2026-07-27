import sharp from "sharp";
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import ffmpegPath from "ffmpeg-static";

// WhatsApp sticker rules: WebP 512x512, static <100KB, animated <500KB.
const SIZE = 512;
const MAX_STATIC = 100 * 1024;
const MAX_ANIMATED = 500 * 1024;

// Discord sticker format_type: 1=PNG, 2=APNG, 3=LOTTIE, 4=GIF
export const FORMAT = { PNG: 1, APNG: 2, LOTTIE: 3, GIF: 4 };

// Encode a sharp pipeline to WebP under a byte budget, dropping quality if needed.
async function encodeUnder(makePipeline, budget) {
  let quality = 90;
  let buf;
  // first pass at 90, then step down until it fits (floor at 20)
  while (quality >= 20) {
    buf = await makePipeline().webp({ quality, effort: 4, loop: 0 }).toBuffer();
    if (buf.length <= budget) break;
    quality -= 15;
  }
  return buf;
}

// Convert one raw asset to a WhatsApp-ready WebP buffer.
// Returns { buffer, animated } or throws.
export async function toStickerWebp(inputPath, formatType) {
  if (formatType === FORMAT.LOTTIE) {
    throw new Error("LOTTIE not supported in v1 (needs a separate renderer)");
  }

  const animated = formatType === FORMAT.APNG || formatType === FORMAT.GIF;
  const budget = animated ? MAX_ANIMATED : MAX_STATIC;

  const base = () =>
    sharp(inputPath, { animated })
      .resize(SIZE, SIZE, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      });

  let buffer;
  try {
    buffer = await encodeUnder(base, budget);
  } catch (err) {
    // APNG animated read can fail on some libvips builds -> fall back to 1st frame
    if (animated) {
      const still = () =>
        sharp(inputPath)
          .resize(SIZE, SIZE, {
            fit: "contain",
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          });
      buffer = await encodeUnder(still, MAX_STATIC);
      return { buffer, animated: false, degraded: true };
    }
    throw err;
  }

  return { buffer, animated };
}

// Convert an arbitrary image file (gif/webp/png/jpg) to a sticker WebP.
// `animated` decides the byte budget and whether to read all frames.
export async function imageToStickerWebp(inputPath, animated) {
  const budget = animated ? MAX_ANIMATED : MAX_STATIC;
  const base = () =>
    sharp(inputPath, { animated }).resize(SIZE, SIZE, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
  try {
    return { buffer: await encodeUnder(base, budget), animated };
  } catch (err) {
    if (!animated) throw err;
    const still = () =>
      sharp(inputPath).resize(SIZE, SIZE, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      });
    return { buffer: await encodeUnder(still, MAX_STATIC), animated: false, degraded: true };
  }
}

// True if the input has more than one frame (animated gif/webp).
export async function isAnimated(inputPath) {
  try {
    const meta = await sharp(inputPath, { animated: true }).metadata();
    return (meta.pages ?? 1) > 1;
  } catch {
    return false;
  }
}

// ---- ffmpeg-based animated WebP encoding (for gif/mp4/webm and frame sequences) ----

function runFfmpeg(inputArgs, vf, quality, outPath) {
  const args = ["-y", ...inputArgs, "-vcodec", "libwebp", "-filter:v", vf,
    "-lossless", "0", "-compression_level", "5", "-q:v", String(quality),
    "-loop", "0", "-preset", "default", "-an", "-vsync", "0", outPath];
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "ignore"] });
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  });
}

// Encode an animated WebP that fits WhatsApp's 500KB budget, stepping
// fps/quality/scale down until it fits.
// input: { file } for a media file, or { pattern, framerate } for a PNG sequence.
export async function ffmpegAnimatedUnderBudget(input, outPath) {
  const inputArgs = input.pattern
    ? ["-framerate", String(input.framerate), "-i", input.pattern]
    : ["-i", input.file];
  const ladders = [
    [512, [[15, 75], [12, 55], [10, 40], [8, 28], [6, 20]]],
    [400, [[10, 38], [8, 24]]],
    [320, [[8, 24], [6, 14]]],
    [256, [[6, 14], [5, 10], [4, 8]]],
  ];
  for (const [scale, steps] of ladders) {
    for (const [fps, q] of steps) {
      const vf = `fps=${fps},scale=${scale}:${scale}:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000`;
      await runFfmpeg(inputArgs, vf, q, outPath);
      if ((await stat(outPath)).size <= MAX_ANIMATED) return;
    }
  }
  // keep last attempt even if slightly over
}

