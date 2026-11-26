param([string]$OutputDirectory = '')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'outputs/AirLab-Windows' }
$outputPath = [IO.Path]::GetFullPath($OutputDirectory)
$sdkRoot = Join-Path $projectRoot 'work/webview2-sdk'
$sdkVersion = '1.0.4314.35'
$coreDll = Join-Path $sdkRoot 'lib/net462/Microsoft.Web.WebView2.Core.dll'
$formsDll = Join-Path $sdkRoot 'lib/net462/Microsoft.Web.WebView2.WinForms.dll'
$loaderDll = Join-Path $sdkRoot 'runtimes/win-x64/native/WebView2Loader.dll'
if (-not (Test-Path -LiteralPath $coreDll)) {
    throw "The Microsoft WebView2 SDK $sdkVersion is missing from work/webview2-sdk. Download that version from NuGet and extract the net462 libraries and win-x64 loader first."
}
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
Copy-Item -LiteralPath $coreDll -Destination $outputPath -Force
Copy-Item -LiteralPath $formsDll -Destination $outputPath -Force
Copy-Item -LiteralPath $loaderDll -Destination $outputPath -Force
Copy-Item -LiteralPath (Join-Path $sdkRoot 'LICENSE.txt') -Destination (Join-Path $outputPath 'MICROSOFT-WEBVIEW2-LICENSE.txt') -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'AirLab.exe.config') -Destination $outputPath -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'version.json') -Destination $outputPath -Force
$iconPath = Join-Path $PSScriptRoot 'AirLab.ico'
if (Test-Path -LiteralPath $iconPath) { Copy-Item -LiteralPath $iconPath -Destination $outputPath -Force }
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$arguments = @('/nologo','/target:winexe','/platform:x64','/optimize+',('/out:' + (Join-Path $outputPath 'AirLab.exe')),('/reference:' + $coreDll),('/reference:' + $formsDll),'/reference:System.dll','/reference:System.Core.dll','/reference:System.Drawing.dll','/reference:System.Windows.Forms.dll','/reference:System.Web.Extensions.dll')
if (Test-Path -LiteralPath $iconPath) { $arguments += '/win32icon:' + $iconPath }
$arguments += Join-Path $PSScriptRoot 'AirLab.cs'
& $compiler @arguments
if ($LASTEXITCODE -ne 0) { throw 'The Windows app did not compile.' }
$settings = @{ sourceRoot = $projectRoot; profileRoot = (Join-Path $projectRoot 'work/windows-profile') }
$settings | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputPath 'airlab-settings.json') -Encoding utf8
$assetOutput = Join-Path $outputPath 'wwwroot'
New-Item -ItemType Directory -Path $assetOutput -Force | Out-Null
$assetSource = Join-Path $projectRoot 'dist'
Get-ChildItem -LiteralPath $assetSource -Recurse -File | ForEach-Object {
    $relative = $_.FullName.Substring($assetSource.Length).TrimStart('\','/')
    $destination = Join-Path $assetOutput $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $_.FullName -Destination $destination -Force
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'WINDOWS-APP.md') -Destination (Join-Path $outputPath 'READ-ME.md') -Force
Write-Output (Join-Path $outputPath 'AirLab.exe')
