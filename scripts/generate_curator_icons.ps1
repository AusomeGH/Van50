Add-Type -AssemblyName System.Drawing

function Generate-CuratorIcon {
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
    $col1 = [System.Drawing.ColorTranslator]::FromHtml("#0f172a")
    $col2 = [System.Drawing.ColorTranslator]::FromHtml("#030712")
    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($bgRect, $col1, $col2, 45.0)
    $g.FillRectangle($bgBrush, $bgRect)

    # Scale factor
    $scale = $Size / 512.0
    if ($Maskable) {
        $scale = $scale * 0.8
        $g.TranslateTransform($Size * 0.1, $Size * 0.1)
    } else {
        $borderCol = [System.Drawing.ColorTranslator]::FromHtml("#f59e0b")
        $penWidth = [Math]::Max(2.0, [float]($Size * 0.015))
        $borderPen = New-Object System.Drawing.Pen($borderCol, $penWidth)
        $g.DrawRectangle($borderPen, 2, 2, ($Size - 4), ($Size - 4))
        $borderPen.Dispose()
    }

    # Shield Outer Boundary
    $p1 = New-Object System.Drawing.PointF([float](256 * $scale), [float](80 * $scale))
    $p2 = New-Object System.Drawing.PointF([float](390 * $scale), [float](130 * $scale))
    $p3 = New-Object System.Drawing.PointF([float](380 * $scale), [float](270 * $scale))
    $p4 = New-Object System.Drawing.PointF([float](256 * $scale), [float](420 * $scale))
    $p5 = New-Object System.Drawing.PointF([float](132 * $scale), [float](270 * $scale))
    $p6 = New-Object System.Drawing.PointF([float](122 * $scale), [float](130 * $scale))
    $shieldPoints = [System.Drawing.PointF[]]@($p1, $p2, $p3, $p4, $p5, $p6)

    $shieldBg = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#111827"))
    $g.FillPolygon($shieldBg, $shieldPoints)
    $shieldBg.Dispose()

    $goldPen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml("#f59e0b"), [Math]::Max(3.0, [float](7 * $scale)))
    $g.DrawPolygon($goldPen, $shieldPoints)
    $goldPen.Dispose()

    # Inner Shield Inset
    $i1 = New-Object System.Drawing.PointF([float](256 * $scale), [float](105 * $scale))
    $i2 = New-Object System.Drawing.PointF([float](365 * $scale), [float](145 * $scale))
    $i3 = New-Object System.Drawing.PointF([float](355 * $scale), [float](255 * $scale))
    $i4 = New-Object System.Drawing.PointF([float](256 * $scale), [float](385 * $scale))
    $i5 = New-Object System.Drawing.PointF([float](157 * $scale), [float](255 * $scale))
    $i6 = New-Object System.Drawing.PointF([float](147 * $scale), [float](145 * $scale))
    $innerPoints = [System.Drawing.PointF[]]@($i1, $i2, $i3, $i4, $i5, $i6)

    $innerBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(180, 30, 41, 59))
    $g.FillPolygon($innerBrush, $innerPoints)
    $innerBrush.Dispose()

    # Center Padlock
    # Shackle
    $shacklePen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml("#fde047"), [Math]::Max(3.0, [float](10 * $scale)))
    $g.DrawArc($shacklePen, [float](218 * $scale), [float](165 * $scale), [float](76 * $scale), [float](70 * $scale), 180, 180)
    $g.DrawLine($shacklePen, [float](218 * $scale), [float](200 * $scale), [float](218 * $scale), [float](225 * $scale))
    $g.DrawLine($shacklePen, [float](294 * $scale), [float](200 * $scale), [float](294 * $scale), [float](225 * $scale))
    $shacklePen.Dispose()

    # Lock Body
    $lockBodyBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#f59e0b"))
    $g.FillRectangle($lockBodyBrush, [float](204 * $scale), [float](225 * $scale), [float](104 * $scale), [float](80 * $scale))
    $lockBodyBrush.Dispose()

    # Keyhole
    $holeBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#0f172a"))
    $g.FillEllipse($holeBrush, [float](248 * $scale), [float](248 * $scale), [float](16 * $scale), [float](16 * $scale))
    $g.FillRectangle($holeBrush, [float](252 * $scale), [float](258 * $scale), [float](8 * $scale), [float](24 * $scale))
    $holeBrush.Dispose()

    # Text Banner: CURATOR
    $bannerBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(230, 15, 23, 42))
    $g.FillRectangle($bannerBrush, [float](136 * $scale), [float](425 * $scale), [float](240 * $scale), [float](50 * $scale))
    $bannerPen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml("#f59e0b"), [float](2 * $scale))
    $g.DrawRectangle($bannerPen, [float](136 * $scale), [float](425 * $scale), [float](240 * $scale), [float](50 * $scale))
    $bannerBrush.Dispose()
    $bannerPen.Dispose()

    $fontSize = [Math]::Max(10.0, [float](24 * $scale))
    $font = New-Object System.Drawing.Font("Arial", $fontSize, [System.Drawing.FontStyle]::Bold)
    $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $g.DrawString("CURATOR", $font, $textBrush, [float](180 * $scale), [float](436 * $scale))

    $font.Dispose()
    $textBrush.Dispose()
    $bgBrush.Dispose()
    $g.Dispose()

    $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output "Generated Curator Icon: $OutPath ($Size x $Size)"
}

$targetDir = Join-Path (Split-Path -Parent $PSScriptRoot) "icons"
Generate-CuratorIcon -Size 192 -OutPath (Join-Path $targetDir "curator-icon-192.png") -Maskable $false
Generate-CuratorIcon -Size 512 -OutPath (Join-Path $targetDir "curator-icon-512.png") -Maskable $false
Generate-CuratorIcon -Size 192 -OutPath (Join-Path $targetDir "curator-icon-maskable-192.png") -Maskable $true
Generate-CuratorIcon -Size 512 -OutPath (Join-Path $targetDir "curator-icon-maskable-512.png") -Maskable $true
