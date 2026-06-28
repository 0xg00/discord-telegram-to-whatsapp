# Discord favorite stickers -> WhatsApp

Saca tus stickers **favoritos** de Discord (los marcados con estrella), los convierte
a formato sticker de WhatsApp (WebP 512x512) y los manda a un chat por WhatsApp Web.

## Como va

1. `discord.js` lee `GET /users/@me/settings-proto/2` (protobuf `FrecencyUserSettings`),
   saca los IDs de stickers favoritos, descarga cada asset del CDN y lo convierte a WebP.
2. `whatsapp.js` arranca WhatsApp Web (`whatsapp-web.js`), pides QR una vez, y manda
   cada WebP como sticker al chat destino (por defecto, a ti mismo).

## Setup

```bash
npm install
cp .env.example .env      # rellena DISCORD_TOKEN
```

`DISCORD_TOKEN` = token de tu cuenta de usuario (no bot). Ver `.env.example` para sacarlo.

## Uso

```bash
npm run pull    # Discord -> stickers/webp/ + manifest.json
npm run send    # manda a WhatsApp (escanea QR la 1a vez)
# o todo de una:
npm run all
```

## Limitaciones v1

- **Lottie** (stickers Nitro animados): saltados. Necesitan render aparte (puppeteer + lottie-web o rlottie). Fase 2.
- **No crea "pack" con nombre**: WhatsApp Web solo manda stickers sueltos. Packs reales necesitan app companion Android/iOS.
- **APNG animado**: si tu build de libvips no lee APNG multi-frame, cae a estatico (1er frame).

## Riesgos

- Token de usuario Discord = selfbot = **contra ToS, posible ban**.
- `whatsapp-web.js` se rompe cuando WhatsApp Web actualiza. Versions pinneadas; si peta, actualiza la lib.
- Cuentas y stickers son tuyos, pero el riesgo de baneo existe. Bajo tu responsabilidad.
