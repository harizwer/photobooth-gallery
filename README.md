# Photobooth Studio (online)

One website for the whole photobooth, served by GitHub Pages:

- **App:** https://harizwer.github.io/photobooth-gallery/app/
  Log in with the same account on the laptop and the tablet.
  - Tablet → **Booth**: guests take photos with the tablet camera and tap Print.
  - Laptop → **Admin board**: events, frames, gallery, print queue. With "This laptop prints" on, jobs from the tablet print on the laptop's default printer (DNP DS-RX1HS).
- **Guest gallery:** https://harizwer.github.io/photobooth-gallery/?e=<event id> (and `&p=<photo id>` for one photo)

Data (accounts, events, photos, print queue) is stored in Supabase. Only approved emails can create an account.

Silent printing on Windows: open the app from a Chrome shortcut with `--kiosk-printing` and set the DNP as the default printer (4x6).
