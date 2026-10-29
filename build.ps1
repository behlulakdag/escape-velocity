# itch.io için zip oluşturur (Windows PowerShell).
# Kullanım: proje klasöründe sağ tık -> "PowerShell'de çalıştır" ya da: powershell -ExecutionPolicy Bypass -File build.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$out = Join-Path $PSScriptRoot "game-itch.zip"
if (Test-Path $out) { Remove-Item $out }

$items = @("index.html", "lib", "src")
if (Test-Path "assets") { $items += "assets" }

# Compress-Archive (PowerShell 5.1) zip içine "src\main.js" gibi ters eğik çizgili yollar yazıyor;
# itch.io bunları klasör olarak tanımıyor ve tüm scriptler 404 veriyor. Bu yüzden zip'i elle,
# her zaman "/" ile yazıyoruz.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$buildId = Get-Date -Format "yyyyMMddHHmmss"
$zip = [System.IO.Compression.ZipFile]::Open($out, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($item in $items) {
    $files = if (Test-Path $item -PathType Container) { Get-ChildItem $item -Recurse -File } else { Get-Item $item }
    foreach ($file in $files) {
      # index.html zip'in EN ÜST seviyesinde olmalı
      $entryName = $file.FullName.Substring($PSScriptRoot.Length + 1).Replace('\', '/')
      if ($entryName -eq "index.html") {
        # itch serves every build at the same URL, so phones keep old cached .js files.
        # A per-build ?v= on each script forces them to load the new code.
        $html = [System.IO.File]::ReadAllText($file.FullName) -replace '(src="[^"]+\.js)"', "`$1?v=$buildId`""
        $writer = New-Object System.IO.StreamWriter($zip.CreateEntry($entryName).Open())
        $writer.Write($html)
        $writer.Dispose()
        continue
      }
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $entryName) | Out-Null
    }
  }
} finally {
  $zip.Dispose()
}
Write-Host "Hazir: $out  (itch.io'ya bunu yukle)"
