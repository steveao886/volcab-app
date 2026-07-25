<#
  生成 PWA 图标(public/icon-192.png、public/icon-512.png)。

  复用应用内已有的「印章」母题(见 src/components/TabBar.tsx 的
  .brand__seal、src/pages/Login.tsx):朱砂(--accent)实心方块 + 居中的
  「词」字,与 index.html 的 favicon.svg 同源、同一套色值。

  两枚 PNG 都是整幅色块直达画布边缘(不在图内自行画圆角),所以同一份
  文件可以同时满足 manifest 里的 "any" 与 "maskable" 用途:系统按各自
  的形状去裁切时,字形都留在安全区(居中 80%)以内,不会被裁到。

  用法(仓库根目录下执行):
    pwsh -File scripts/generate-icons.ps1
    # 或不带扩展名的 Windows PowerShell:
    powershell -File scripts/generate-icons.ps1

  未安装任何图像库 —— 直接用 .NET System.Drawing 栅格化到位图再存 PNG。
#>

Add-Type -AssemblyName System.Drawing

# --- 色值:与 src/styles/tokens.css 的浅色主题(纸)保持一致 ---------------
$bgHex = '#be3c24' # --accent 朱砂
$fgHex = '#fdfbf7' # --on-tone 象牙白(实心色块上的文字)

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

  # 满版底色,不做圆角 —— 圆角交给系统按 any / maskable 各自裁切
  $bgBrush = New-Object System.Drawing.SolidBrush($bg)
  $g.FillRectangle($bgBrush, 0, 0, $size, $size)

  # 居中「词」字,与 .brand__seal 同字重(600/Bold)、同字体(Microsoft YaHei,
  # 对应 --font-ui 在 Windows 上的解析结果)
  $fontSize = [float]($size * 0.52)
  $font = New-Object System.Drawing.Font('Microsoft YaHei', $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $fgBrush = New-Object System.Drawing.SolidBrush($fg)

  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center

  # 「词」= U+8BCD,用码位而非字面量写入,避免脚本文件编码(BOM/ANSI)
  # 在不同环境下把多字节字符读花
  $glyph = [char]::ConvertFromUtf32(0x8BCD)

  # 中文字形在 em 框内略偏上,手动下移一点做光学居中
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
