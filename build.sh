#!/usr/bin/env bash
# itch.io için zip oluşturur (Mac/Linux/Git Bash).
set -e
cd "$(dirname "$0")"
rm -f game-itch.zip
items="index.html lib src"
[ -d assets ] && items="$items assets"
# index.html zip'in EN ÜST seviyesinde olmalı
zip -rq game-itch.zip $items
echo "Hazır: game-itch.zip (itch.io'ya bunu yükle)"
