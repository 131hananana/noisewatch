# NoiseWatch

Monitor kebisingan (sound horeg) lewat mikrofon.

- `noise_watch.py`: versi Python untuk macOS (terminal + notifikasi).
- `web/`: versi web app (PWA). Bisa dibuka online dan tetap jalan offline setelah sekali dibuka.

Jalankan web app di lokal:

```bash
python3 -m http.server 8765 --directory web
```

Setiap push ke `main` yang mengubah `web/` otomatis di-deploy ke GitHub Pages.
Kalau mengubah file di `web/`, naikkan `VERSION` di `web/sw.js`.
