# Generate placeholder PNG icons for the Chrome Web Store.
#
# Brand: purple square (#7c6fe0) + white checkmark.
# Matches the .enigma- CSS tokens in extension/public/styles/badge.css.
#
# Run from PowerShell:
#   pwsh extension/scripts/generate-icons.ps1
#
# Outputs:
#   extension/public/icons/icon-16.png
#   extension/public/icons/icon-32.png
#   extension/public/icons/icon-48.png
#   extension/public/icons/icon-128.png
#
# These are Phase 1 placeholders. Replace with branded artwork from a
# designer before final Chrome Web Store submission, but they're good
# enough to pass the install-dialog rendering tests.

Add-Type -AssemblyName System.Drawing

$sizes = @(16, 32, 48, 128)
$outDir = Join-Path $PSScriptRoot ".." "public" "icons"
$outDir = (Resolve-Path $outDir).Path

# Brand colors (matches tailwind.config.js .enigma.accent)
$bgTop = [System.Drawing.Color]::FromArgb(124, 111, 224)  # #7c6fe0
$bgBot = [System.Drawing.Color]::FromArgb(91, 77, 196)    # #5b4dc4 (darker)
$fgColor = [System.Drawing.Color]::White

foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)

    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    # Gradient background (top->bottom)
    $rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect, $bgTop, $bgBot,
        [System.Drawing.Drawing2D.LinearGradientMode]::Vertical
    )
    $g.FillRectangle($brush, $rect)
    $brush.Dispose()

    # Centered checkmark — drawn with three-point polyline.
    # Coordinates are fractions of size for crisp rendering at every scale.
    $cx1 = $size * 0.25
    $cy1 = $size * 0.52
    $cx2 = $size * 0.45
    $cy2 = $size * 0.72
    $cx3 = $size * 0.78
    $cy3 = $size * 0.30

    $strokeWidth = [Math]::Max(1.5, $size * 0.13)
    $pen = New-Object System.Drawing.Pen $fgColor, $strokeWidth
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

    $points = @(
        (New-Object System.Drawing.PointF $cx1, $cy1),
        (New-Object System.Drawing.PointF $cx2, $cy2),
        (New-Object System.Drawing.PointF $cx3, $cy3)
    )
    $g.DrawLines($pen, $points)
    $pen.Dispose()

    $outPath = Join-Path $outDir "icon-$size.png"
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()

    Write-Host "Generated $outPath ($size x $size)"
}

Write-Host ""
Write-Host "All icons generated at: $outDir"
Write-Host "Verify visually before submitting to Chrome Web Store."
