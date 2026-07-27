# Discord favorite stickers -> WhatsApp

Grabs your **favorite** Discord stickers (the starred ones), converts
them to WhatsApp sticker format (WebP 512x512) and ships them to a chat via WhatsApp Web.

## How it works

1. `discord.js` reads `GET /users/@me/settings-proto/2` (protobuf `FrecencyUserSettings`),
   pulls the favorite sticker IDs, downloads each asset from the CDN and converts it to WebP.
2. `whatsapp.js` boots WhatsApp Web (`whatsapp-web.js`), prompts for the QR once, and sends
   each WebP as a sticker to the target chat (defaults to yourself).

## Setup

```bash
npm install
cp .env.example .env      # fill in DISCORD_TOKEN
```

`DISCORD_TOKEN` = your user account token (not a bot). See `.env.example` for how to grab it.

## Usage

```bash
npm run pull    # Discord -> stickers/webp/ + manifest.json
npm run send    # ship to WhatsApp (scan QR the first time)
# or in one shot:
npm run all
```

## v1 limitations

- **Lottie** (Nitro animated stickers): skipped. They need a separate renderer (puppeteer + lottie-web or rlottie). Phase 2.
- **No named "packs"**: WhatsApp Web only sends loose stickers. Real packs need the companion Android/iOS app.
- **Animated APNG**: if your libvips build doesn't read multi-frame APNG, it falls back to static (first frame).

## Risks

- Discord user token = selfbot = **against ToS, ban risk**.
- `whatsapp-web.js` breaks whenever WhatsApp Web updates. Versions are pinned; if it dies, bump the lib.
- Accounts and stickers are yours, but the ban risk is real. Use at your own risk.
