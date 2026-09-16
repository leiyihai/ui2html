param(
  [string]$InputDirectory = (Join-Path $PSScriptRoot '..\public\mockups'),
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\public\mockups')
)

Add-Type -AssemblyName System.Drawing

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

foreach ($name in @('mobile-iphone', 'mobile-android')) {
  $inputPath = Join-Path $InputDirectory "$name.png"
  $outputPath = Join-Path $OutputDirectory "$name-landscape.png"
  if (-not (Test-Path -LiteralPath $inputPath)) {
    throw "Missing device template: $inputPath"
  }

  $source = [System.Drawing.Bitmap]::FromFile($inputPath)
  try {
    $rotated = [System.Drawing.Bitmap]::new($source.Height, $source.Width, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $rotated.SetResolution($source.HorizontalResolution, $source.VerticalResolution)
      $graphics = [System.Drawing.Graphics]::FromImage($rotated)
      try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.TranslateTransform($rotated.Width / 2, $rotated.Height / 2)
        $graphics.RotateTransform(90)
        $graphics.TranslateTransform(-$source.Width / 2, -$source.Height / 2)
        $graphics.DrawImage($source, 0, 0, $source.Width, $source.Height)
      } finally {
        $graphics.Dispose()
      }
      $rotated.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $rotated.Dispose()
    }
  } finally {
    $source.Dispose()
  }
}
