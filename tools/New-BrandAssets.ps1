param([Parameter(Mandatory = $true)][string]$SourceMark)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class FlixTunesNativeIcons { [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr handle); }
"@

$projectRoot = Split-Path $PSScriptRoot -Parent
$source = [System.Drawing.Bitmap]::FromFile((Resolve-Path -LiteralPath $SourceMark))

function Save-ResizedPng([string]$Path, [int]$Width, [int]$Height) {
  $directory = Split-Path $Path -Parent
  [System.IO.Directory]::CreateDirectory($directory) | Out-Null
  $target = New-Object System.Drawing.Bitmap($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($target)
  $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.DrawImage($source, 0, 0, $Width, $Height)
  $target.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose(); $target.Dispose()
}

$webBrand = Join-Path $projectRoot "apps\web\public\brand"
$androidDrawable = Join-Path $projectRoot "apps\android\app\src\main\res\drawable-nodpi"
$windowsAssets = Join-Path $projectRoot "apps\windows\Assets"
Save-ResizedPng (Join-Path $webBrand "flixtunes-logo.png") 512 512
# La marque n'est pas utilisee par le client Web : elle n'est generee que pour Windows et Android.
Save-ResizedPng (Join-Path $webBrand "favicon.png") 64 64
Save-ResizedPng (Join-Path $androidDrawable "flixtunes_mark.png") 512 512
Save-ResizedPng (Join-Path $windowsAssets "flixtunes-mark.png") 512 512

$bannerPath = Join-Path $androidDrawable "flixtunes_tv_banner.png"
$banner = New-Object System.Drawing.Bitmap(320, 180, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$bannerGraphics = [System.Drawing.Graphics]::FromImage($banner)
$bannerGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$bannerBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush((New-Object System.Drawing.Rectangle(0,0,320,180)), [System.Drawing.Color]::FromArgb(255,7,11,18), [System.Drawing.Color]::FromArgb(255,20,54,112), 0)
$bannerGraphics.FillRectangle($bannerBrush, 0, 0, 320, 180)
$mark = New-Object System.Drawing.Bitmap(118,118,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$markGraphics = [System.Drawing.Graphics]::FromImage($mark)
$markGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$markGraphics.DrawImage($source,0,0,118,118)
$bannerGraphics.DrawImage($mark, 18, 31)
$font = New-Object System.Drawing.Font("Segoe UI", 31, ([System.Drawing.FontStyle]::Bold), [System.Drawing.GraphicsUnit]::Pixel)
$bannerGraphics.DrawString("FlixTunes", $font, [System.Drawing.Brushes]::White, 128, 65)
$banner.Save($bannerPath,[System.Drawing.Imaging.ImageFormat]::Png)
$font.Dispose(); $markGraphics.Dispose(); $mark.Dispose(); $bannerBrush.Dispose(); $bannerGraphics.Dispose(); $banner.Dispose()

$iconBitmap = New-Object System.Drawing.Bitmap(256,256,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$iconGraphics = [System.Drawing.Graphics]::FromImage($iconBitmap)
$iconGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$iconGraphics.DrawImage($source,0,0,256,256)
$iconHandle = $iconBitmap.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($iconHandle)
$iconStream = [System.IO.File]::Create((Join-Path $windowsAssets "FlixTunes.ico"))
$icon.Save($iconStream)
$iconStream.Dispose(); $icon.Dispose(); [FlixTunesNativeIcons]::DestroyIcon($iconHandle) | Out-Null
$iconGraphics.Dispose(); $iconBitmap.Dispose()

# La signature sonore vit dans son propre script : elle n'a rien a voir avec System.Drawing, et
# la regenerer seule -- sans reecrire toutes les icones -- est le cas courant quand on la travaille.
& (Join-Path $PSScriptRoot "New-StartupSound.ps1")

$source.Dispose()
Write-Output "FlixTunes brand assets generated."
