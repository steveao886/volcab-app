<#
  Generates the PWA icons (public/icon-192.png, public/icon-512.png).

  Reuses the "seal" motif already used elsewhere in the app (see
  .brand__seal in src/components/TabBar.tsx, src/pages/Login.tsx): a solid
  vermilion (--accent) square with a centered "词" (word) character, sharing
  the same source and color values as index.html's favicon.svg.

  Both PNGs are a solid color block running to the canvas edge (no rounded
  corners drawn into the image itself), so the same file can satisfy both
  the manifest's "any" and "maskable" purposes: whichever shape the system
  crops it to, the glyph stays inside the safe zone (centered 80%) and is
  never clipped.

  Safe zone measured directly (reading icon-512.png pixels, not estimated
  from CSS ratios): the glyph's bounding box is about 245x254px out of
  512px, i.e. 48% x 50% of the canvas; its circumscribed circle diameter is
  about 69% of the canvas, still inside maskable's 80% safe zone with room
  to spare.
  After changing $fontSize, this number must be re-measured -- don't reuse
  the figures above.

  Usage (run from the repo root):
    pwsh -File scripts/generate-icons.ps1
    # or Windows PowerShell without the extension:
    powershell -File scripts/generate-icons.ps1

  No image library installed -- rasterizes straight to a bitmap with .NET's
  System.Drawing and saves it as PNG.
#>

Add-Type -AssemblyName System.Drawing

# --- Color values: kept consistent with src/styles/tokens.css's light (paper) theme -----
$bgHex = '#be3c24' # --accent vermilion
$fgHex = '#fdfbf7' # --on-tone ivory white (text on the solid color block)

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

  # Centered "词" character, same weight (600/Bold) and font (Microsoft
  # YaHei, matching how --font-ui resolves on Windows) as .brand__seal
  $fontSize = [float]($size * 0.52)
  # GDI+ silently substitutes the default font when the requested one is
  # missing, so the script would "succeed" while producing a wrong icon --
  # so this confirms the font is actually installed first, and would rather
  # error out than produce an image that looks wrong.
  $fontFamily = 'Microsoft YaHei'
  $installed = (New-Object System.Drawing.Text.InstalledFontCollection).Families.Name
  if ($installed -notcontains $fontFamily) {
    throw "Missing font '$fontFamily'. GDI+ would silently fall back to the default font and produce a wrong icon, so this has been aborted instead. Install the font, or switch to an equivalent Chinese sans-serif font already on this machine and re-measure the safe zone."
  }
  $font = New-Object System.Drawing.Font($fontFamily, $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
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
