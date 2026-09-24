<#
  Generates the PWA icons (public/icon-192.png, public/icon-512.png).

  Reuses the "seal" motif already used elsewhere in the app (see
  .brand__seal in src/components/TabBar.tsx, src/pages/Login.tsx): a solid
  cinnabar (--accent) square with a centered "词" (word) character in the
  Song face the in-app seal renders in, sharing the same color values as
  public/favicon.svg.

  Both PNGs are a solid color block running to the canvas edge (no rounded
  corners drawn into the image itself), so the same file can satisfy both
  the manifest's "any" and "maskable" purposes: whichever shape the system
  crops it to, the glyph stays inside the safe zone (centered 80%) and is
  never clipped.

  Safe zone measured directly (reading icon-512.png pixels, not estimated
  from CSS ratios), 2026-09-23 with Noto Serif SC SemiBold: the glyph's
  bounding box is 247x245px out of 512px, i.e. 48% x 48% of the canvas; its
  circumscribed circle diameter is 62.8% of the canvas, inside maskable's
  80% safe zone with room to spare. (Microsoft YaHei Bold, before, measured
  245x254px and 69%.)
  After changing $fontSize or the font, this number must be re-measured --
  don't reuse the figures above.

  Usage (run from the repo root):
    pwsh -File scripts/generate-icons.ps1
    # or Windows PowerShell without the extension:
    powershell -File scripts/generate-icons.ps1

  No image library installed -- rasterizes straight to a bitmap with .NET's
  System.Drawing and saves it as PNG.
#>

Add-Type -AssemblyName System.Drawing

# --- Color values: kept consistent with src/styles/tokens.css's light (月白) theme -----
$bgHex = '#b3362b' # --accent cinnabar (朱)
$fgHex = '#f7f9f8' # --on-tone (text on the solid color block)

$bg = [System.Drawing.ColorTranslator]::FromHtml($bgHex)
$fg = [System.Drawing.ColorTranslator]::FromHtml($fgHex)

$outDir = Join-Path $PSScriptRoot '..\public'
$sizes = @(192, 512)

foreach ($size in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $bmp.SetResolution(96, 96)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  # Full-bleed background color, no rounded corners -- corner-cropping is left to the system for any / maskable respectively
  $bgBrush = New-Object System.Drawing.SolidBrush($bg)
  $g.FillRectangle($bgBrush, 0, 0, $size, $size)

  # Centered "词" character, same face and weight as .brand__seal: the app
  # bundles Noto Serif SC and the seal renders at 600. GDI+ cannot read the
  # bundled woff2, but a Windows install of Noto Serif SC (NotoSerifSC-VF.ttf)
  # exposes each weight as its own family; "SemiBold" at Regular style is
  # the real 600 instance, where FontStyle.Bold would synthesize a fake one.
  $fontSize = [float]($size * 0.52)
  # GDI+ silently substitutes the default font when the requested one is
  # missing, so the script would "succeed" while producing a wrong icon --
  # so this confirms the font is actually installed first, and would rather
  # error out than produce an image that looks wrong.
  $fontFamily = 'Noto Serif SC SemiBold'
  $installed = (New-Object System.Drawing.Text.InstalledFontCollection).Families.Name
  if ($installed -notcontains $fontFamily) {
    throw "Missing font '$fontFamily'. GDI+ would silently fall back to the default font and produce a wrong icon, so this has been aborted instead. Install Noto Serif SC (TTF/OTF, not the app's woff2), or switch to an equivalent Song face already on this machine and re-measure the safe zone."
  }
  $font = New-Object System.Drawing.Font($fontFamily, $fontSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $fgBrush = New-Object System.Drawing.SolidBrush($fg)

  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center

  # "词" = U+8BCD, written via its code point rather than a literal
  # character to avoid the script file's encoding (BOM/ANSI) garbling a
  # multi-byte character differently across environments
  $glyph = [char]::ConvertFromUtf32(0x8BCD)

  # The Chinese glyph sits slightly high within its em box, so nudge it down a bit for optical centering
  $rect = New-Object System.Drawing.RectangleF(0, [float]($size * 0.03), $size, $size)
  $g.DrawString($glyph, $font, $fgBrush, $rect, $format)

  $path = Join-Path $outDir "icon-$size.png"
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)

  $font.Dispose()
  $fgBrush.Dispose()
  $bgBrush.Dispose()
  $g.Dispose()
  $bmp.Dispose()

  Write-Host "wrote $path ($size x $size)"
}
