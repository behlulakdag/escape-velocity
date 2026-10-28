# Builds the zip and pushes it to itch.io with butler.
# First time only: run "& $env:USERPROFILE\tools\butler\butler.exe login" and approve in the browser.
# Usage: powershell -ExecutionPolicy Bypass -File deploy.ps1 [-Target user/game]
param(
  [string]$Target = "behlulakdag/slapjam-test-build"
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$butler = Join-Path $env:USERPROFILE "tools\butler\butler.exe"
if (-not (Test-Path $butler)) { throw "butler not found at $butler" }

& (Join-Path $PSScriptRoot "build.ps1")

# The "html5" channel keeps one browser-playable upload that every push replaces.
# After the very first push, tick "This file will be played in the browser" once on the itch edit page.
& $butler push (Join-Path $PSScriptRoot "game-itch.zip") "${Target}:html5"
if ($LASTEXITCODE -ne 0) { throw "butler push failed" }
& $butler status $Target
