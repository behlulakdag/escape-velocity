# Slapjam #2 Şablonu (Phaser 3, dikey mobil)

## Bilgisayarda çalıştırma
En kolayı: `index.html` dosyasına çift tıkla, tarayıcıda açılır.

Telefonda aynı Wi-Fi üzerinden denemek istersen proje klasöründe:
```
npx serve .
```
Çıkan "Network" adresini telefonun tarayıcısında aç.

## itch.io'ya yükleme
1. `build.ps1` dosyasını çalıştır (sağ tık -> "PowerShell'de çalıştır"). `game-itch.zip` oluşur.
2. itch.io'da sağ üstteki profil menüsünden **Upload new project**.
3. **Kind of project:** `HTML`
4. **Uploads:** `game-itch.zip` dosyasını yükle, altındaki **"This file will be played in the browser"** kutusunu işaretle.
5. **Embed options:**
   - Viewport dimensions: **720 × 1280** (laptop ekranına sığmazsa **360 × 640** yaz, oran aynı kalsın)
   - **Mobile friendly** işaretle, orientation: **Portrait**
   - **Fullscreen button** işaretle
6. **Visibility:** test için **Draft** bırak. Jamde teslim ederken **Public** yap.
7. Kaydet, "View page" ile aç, telefonda da dene.

## Teslim ederken unutma
- Jam sayfasından **Submit your project** ile bu projeyi seç.
- **Gizli ödül iletişim alanına e-postanı yaz** (zorunlu).
- Açıklamaya kullandığın AI araçlarını yaz (Claude Code, Suno, ElevenLabs...).
- Teslimden sonra build güncellenemez.
