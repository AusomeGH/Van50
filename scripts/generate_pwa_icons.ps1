Add-Type -AssemblyName System.Drawing

function Generate-Van50Icon {
    param(
        [int]$Size,
        [string]$OutPath,
        [bool]$Maskable = $false
    )

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    # Clear Background
    $bgRect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
    $col1 = [System.Drawing.ColorTranslator]::FromHtml("#0b1329")
    $col2 = [System.Drawing.ColorTranslator]::FromHtml("#040810")
    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($bgRect, $col1, $col2, 45.0)
    $g.FillRectangle($bgBrush, $bgRect)

    # Scale factor for drawings
    $scale = $Size / 512.0
    if ($Maskable) {
        $scale = $scale * 0.8
        $g.TranslateTransform($Size * 0.1, $Size * 0.1)
    } else {
        $borderCol = [System.Drawing.ColorTranslator]::FromHtml("#10b981")
        $penWidth = [Math]::Max(2.0, [float]($Size * 0.015))
        $borderPen = New-Object System.Drawing.Pen($borderCol, $penWidth)
        $g.DrawRectangle($borderPen, 2, 2, ($Size - 4), ($Size - 4))
        $borderPen.Dispose()
    }

    # Mountain silhouette
    $mtnCol = [System.Drawing.Color]::FromArgb(120, 30, 41, 59)
    $mtnBrush = New-Object System.Drawing.SolidBrush($mtnCol)
    $p1 = New-Object System.Drawing.PointF([float](60 * $scale), [float](370 * $scale))
    $p2 = New-Object System.Drawing.PointF([float](180 * $scale), [float](240 * $scale))
    $p3 = New-Object System.Drawing.PointF([float](270 * $scale), [float](340 * $scale))
    $p4 = New-Object System.Drawing.PointF([float](380 * $scale), [float](200 * $scale))
    $p5 = New-Object System.Drawing.PointF([float](450 * $scale), [float](370 * $scale))
    $mtnPoints = [System.Drawing.PointF[]]@($p1, $p2, $p3, $p4, $p5)
    $g.FillPolygon($mtnBrush, $mtnPoints)
    $mtnBrush.Dispose()

    # Tree Trunk
    $trunkCol = [System.Drawing.ColorTranslator]::FromHtml("#78350f")
    $trunkBrush = New-Object System.Drawing.SolidBrush($trunkCol)
    $g.FillRectangle($trunkBrush, [float](238 * $scale), [float](340 * $scale), [float](36 * $scale), [float](60 * $scale))
    $trunkBrush.Dispose()

    # Evergreen Tree Tiers
    $treeCol1 = [System.Drawing.ColorTranslator]::FromHtml("#34d399")
    $treeCol2 = [System.Drawing.ColorTranslator]::FromHtml("#059669")
    $treeRect = New-Object System.Drawing.RectangleF([float](140 * $scale), [float](130 * $scale), [float](240 * $scale), [float](230 * $scale))
    $treeBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($treeRect, $treeCol1, $treeCol2, 90.0)

    # Tier 1 (bottom)
    $t1a = New-Object System.Drawing.PointF([float](140 * $scale), [float](350 * $scale))
    $t1b = New-Object System.Drawing.PointF([float](372 * $scale), [float](350 * $scale))
    $t1c = New-Object System.Drawing.PointF([float](320 * $scale), [float](270 * $scale))
    $t1d = New-Object System.Drawing.PointF([float](192 * $scale), [float](270 * $scale))
    $t1Points = [System.Drawing.PointF[]]@($t1a, $t1b, $t1c, $t1d)
    $g.FillPolygon($treeBrush, $t1Points)

    # Tier 2 (middle)
    $t2a = New-Object System.Drawing.PointF([float](170 * $scale), [float](280 * $scale))
    $t2b = New-Object System.Drawing.PointF([float](342 * $scale), [float](280 * $scale))
    $t2c = New-Object System.Drawing.PointF([float](295 * $scale), [float](210 * $scale))
    $t2d = New-Object System.Drawing.PointF([float](217 * $scale), [float](210 * $scale))
    $t2Points = [System.Drawing.PointF[]]@($t2a, $t2b, $t2c, $t2d)
    $g.FillPolygon($treeBrush, $t2Points)

    # Tier 3 (top)
    $t3a = New-Object System.Drawing.PointF([float](205 * $scale), [float](220 * $scale))
    $t3b = New-Object System.Drawing.PointF([float](307 * $scale), [float](220 * $scale))
    $t3c = New-Object System.Drawing.PointF([float](256 * $scale), [float](130 * $scale))
    $t3Points = [System.Drawing.PointF[]]@($t3a, $t3b, $t3c)
    $g.FillPolygon($treeBrush, $t3Points)
    $treeBrush.Dispose()

    # Coastal Ocean Waves
    $waveCol = [System.Drawing.ColorTranslator]::FromHtml("#38bdf8")
    $waveWidth = [Math]::Max(3.0, [float](7 * $scale))
    $wavePen = New-Object System.Drawing.Pen($waveCol, $waveWidth)
    $g.DrawArc($wavePen, [float](50 * $scale), [float](380 * $scale), [float](200 * $scale), [float](40 * $scale), 0, 180)
    $g.DrawArc($wavePen, [float](250 * $scale), [float](380 * $scale), [float](200 * $scale), [float](40 * $scale), 180, -180)
    $wavePen.Dispose()

    # Brand Text / Badge "VAN 50"
    $badgeBg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(230, 15, 23, 42))
    $g.FillRectangle($badgeBg, [float](150 * $scale), [float](46 * $scale), [float](212 * $scale), [float](62 * $scale))
    $badgeBorderCol = [System.Drawing.ColorTranslator]::FromHtml("#10b981")
    $badgePen = New-Object System.Drawing.Pen($badgeBorderCol, [float](2 * $scale))
    $g.DrawRectangle($badgePen, [float](150 * $scale), [float](46 * $scale), [float](212 * $scale), [float](62 * $scale))
    $badgeBg.Dispose()
    $badgePen.Dispose()

    $fontSize = [Math]::Max(10.0, [float](30 * $scale))
    $font = New-Object System.Drawing.Font("Arial", $fontSize, [System.Drawing.FontStyle]::Bold)
    $whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $greenBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#34d399"))

    $g.DrawString("VAN", $font, $whiteBrush, [float](168 * $scale), [float](54 * $scale))
    $g.DrawString("50", $font, $greenBrush, [float](278 * $scale), [float](54 * $scale))

    $font.Dispose()
    $whiteBrush.Dispose()
    $greenBrush.Dispose()
    $bgBrush.Dispose()
    $g.Dispose()

    $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output "Generated: $OutPath ($Size x $Size)"
}

$targetDir = Join-Path (Split-Path -Parent $PSScriptRoot) "icons"
if (-not (Test-Path $targetDir)) {
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
}

Generate-Van50Icon -Size 192 -OutPath (Join-Path $targetDir "icon-192.png") -Maskable $false
Generate-Van50Icon -Size 512 -OutPath (Join-Path $targetDir "icon-512.png") -Maskable $false
Generate-Van50Icon -Size 192 -OutPath (Join-Path $targetDir "icon-maskable-192.png") -Maskable $true
Generate-Van50Icon -Size 512 -OutPath (Join-Path $targetDir "icon-maskable-512.png") -Maskable $true
Generate-Van50Icon -Size 180 -OutPath (Join-Path $targetDir "apple-touch-icon.png") -Maskable $false
