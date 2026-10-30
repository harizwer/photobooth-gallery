# Photobooth Studio

One website for the whole booth:

- **Tablet** → log in, choose **Booth**. Guests take photos, GIFs, boomerangs or videos and tap Print.
- **Laptop** (DNP DS-RX1HS plugged in) → log in, choose **Admin board**, turn on **Printer**. Prints from the tablet come out here.
- **Guests** scan a QR and see only their own photo. The whole-album QR is in Gallery & share (admin only).

## Folders

- `public/` — the website (this is what Cloudflare serves)
  - `public/app/` — the app (login, booth, admin board)
  - `public/index.html` — the guest page (`?p=` photo, `?q=` printed QR (24 h), `?album=` album)
  - `public/vendor/` — libraries (Supabase, QR, ZIP, GIF, Canon DSLR over USB)
- `wrangler.jsonc` — Cloudflare Workers settings (static site, no build step)

## Deploy on Cloudflare

Cloudflare dashboard → Workers & Pages → Create → **Import a repository** → pick this repo.
Leave the build command empty; deploy command `npx wrangler deploy`. Every push to `main` redeploys.

## Printing without the print window (Windows)

Start Chrome with `--kiosk-printing` (the exact command is on the Printer page), set the DNP as the
default printer and paper size 4x6 in its driver.
