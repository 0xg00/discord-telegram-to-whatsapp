import sharp from "sharp";

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
    throw new Error("LOTTIE no soportado en v1 (necesita render aparte)");
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
