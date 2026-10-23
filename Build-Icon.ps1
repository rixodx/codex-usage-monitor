$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$assetRoot=Join-Path $PSScriptRoot 'assets'
[void][IO.Directory]::CreateDirectory($assetRoot)
function Rounded-Rectangle([double]$x,[double]$y,[double]$width,[double]$height,[double]$radius) {
    $shape=New-Object Drawing.Drawing2D.GraphicsPath
    $diameter=[single]($radius*2)
    $shape.AddArc([single]$x,[single]$y,$diameter,$diameter,180,90)
    $shape.AddArc([single]($x+$width-$diameter),[single]$y,$diameter,$diameter,270,90)
    $shape.AddArc([single]($x+$width-$diameter),[single]($y+$height-$diameter),$diameter,$diameter,0,90)
    $shape.AddArc([single]$x,[single]($y+$height-$diameter),$diameter,$diameter,90,90)
    $shape.CloseFigure()
    return $shape
}
$frames=@()
foreach ($size in @(16,20,24,32,40,48,64,128,256)) {
    $bitmap=New-Object Drawing.Bitmap(($size*4),($size*4))
    $graphics=[Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.ScaleTransform([single]($size*4/256),[single]($size*4/256))
    $background=New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml('#17262C'))
    $mint=New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml('#5EE5BB'))
    $soft=New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml('#BAF7E2'))
    $outline=New-Object Drawing.Pen([Drawing.ColorTranslator]::FromHtml('#2C464C'),4)
    $ring=New-Object Drawing.Pen([Drawing.ColorTranslator]::FromHtml('#5EE5BB'),16)
    $ring.StartCap=[Drawing.Drawing2D.LineCap]::Round; $ring.EndCap=$ring.StartCap
    $tile=Rounded-Rectangle 6 6 244 244 53
    try {
        $graphics.Clear([Drawing.Color]::Transparent)
        $graphics.FillPath($background,$tile); $graphics.DrawPath($outline,$tile)
        $graphics.DrawArc($ring,44,42,168,168,140,260)
        foreach ($bar in @(@(83,134,20,41),@(118,111,20,64),@(153,86,20,89))) {
            $shape=Rounded-Rectangle $bar[0] $bar[1] $bar[2] $bar[3] 7
            try { $graphics.FillPath($(if($bar[0] -eq 153){$soft}else{$mint}),$shape) } finally { $shape.Dispose() }
        }
        $final=New-Object Drawing.Bitmap($size,$size)
        $resize=[Drawing.Graphics]::FromImage($final)
        try {
            $resize.InterpolationMode=[Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $resize.DrawImage($bitmap,0,0,$size,$size)
        } finally { $resize.Dispose() }
        try {
            $stream=New-Object IO.MemoryStream
            try { $final.Save($stream,[Drawing.Imaging.ImageFormat]::Png); $frames+=,@{size=$size;bytes=$stream.ToArray()} }
            finally { $stream.Dispose() }
            if($size -eq 256) { $final.Save((Join-Path $assetRoot 'app-icon.png'),[Drawing.Imaging.ImageFormat]::Png) }
        } finally { $final.Dispose() }
    } finally {
        $tile.Dispose(); $ring.Dispose(); $outline.Dispose(); $background.Dispose(); $mint.Dispose(); $soft.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
    }
}
$iconPath=Join-Path $assetRoot 'app.ico'
$output=[IO.File]::Create($iconPath); $writer=New-Object IO.BinaryWriter($output)
try {
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$frames.Count)
    $offset=6+16*$frames.Count
    foreach ($frame in $frames) {
        $dimension=if($frame.size -eq 256){0}else{$frame.size}
        $writer.Write([byte]$dimension); $writer.Write([byte]$dimension); $writer.Write([byte]0); $writer.Write([byte]0)
        $writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$frame.bytes.Length); $writer.Write([uint32]$offset)
        $offset+=$frame.bytes.Length
    }
    foreach ($frame in $frames) { $writer.Write([byte[]]$frame.bytes) }
} finally { $writer.Dispose(); $output.Dispose() }
Write-Output "Built icon: $iconPath (16-256 px, 9 sizes)"
