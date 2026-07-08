$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root 'runtime'
$staging = Join-Path $env:TEMP ("dcml_payload_build_" + [guid]::NewGuid().ToString('N').Substring(0,8))
$dst = Join-Path $root 'installer\Assets\runtime.zip'

New-Item -ItemType Directory -Force -Path $staging | Out-Null
Copy-Item (Join-Path $runtime 'shell')    (Join-Path $staging 'shell')    -Recurse
Copy-Item (Join-Path $runtime 'external') (Join-Path $staging 'external') -Recurse

if (Test-Path $dst) { Remove-Item $dst -Force }
Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $dst -CompressionLevel Optimal
Remove-Item $staging -Recurse -Force

$sz = (Get-Item $dst).Length
Write-Output ("runtime.zip 重建完成: {0}  ({1:N0} bytes)" -f $dst, $sz)
