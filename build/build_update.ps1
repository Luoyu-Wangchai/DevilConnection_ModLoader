# 产出 in-app 自更新资产：update.zip(预打包 app.asar + 外置) + update.json(版本+sha256)
# 用 adm-zip 打包(正斜杠条目)，与运行时 Manager.js 的 AdmZip 解压一致——不用 Compress-Archive(它写反斜杠)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root 'runtime'
$dist = Join-Path $root 'build\dist'
$staging = Join-Path $env:TEMP ("dcml_update_" + [guid]::NewGuid().ToString('N').Substring(0,8))

New-Item -ItemType Directory -Force -Path $dist | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $staging 'external') | Out-Null

# 1) 壳 -> app.asar
& cmd /c "npx --no-install @electron/asar pack `"$(Join-Path $runtime 'shell')`" `"$(Join-Path $staging 'app.asar')`""
if (-not (Test-Path (Join-Path $staging 'app.asar'))) { throw 'app.asar 打包失败' }

# 2) 外置文件
Copy-Item (Join-Path $runtime 'external\*') (Join-Path $staging 'external') -Recurse -Force

# 3) 用 adm-zip 打成 update.zip
$zip = Join-Path $dist 'update.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
$env:DCML_SRC = $staging
$env:DCML_OUT = $zip
Push-Location (Join-Path $runtime 'shell')
& node -e "const A=require('adm-zip');const z=new A();z.addLocalFolder(process.env.DCML_SRC);z.writeZip(process.env.DCML_OUT);"
Pop-Location
if (-not (Test-Path $zip)) { throw 'update.zip 生成失败' }

# 4) sha256 + update.json(UTF-8 无 BOM)
$sha = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
$ver = (Get-Content (Join-Path $runtime 'external\version.json') -Raw | ConvertFrom-Json).version
$manifest = (@{ version = $ver; sha256 = $sha; asset = 'update.zip' } | ConvertTo-Json -Compress)
[System.IO.File]::WriteAllText((Join-Path $dist 'update.json'), $manifest, (New-Object System.Text.UTF8Encoding($false)))

Remove-Item $staging -Recurse -Force
Write-Output ("update.zip: {0:N0} bytes" -f (Get-Item $zip).Length)
Write-Output ("sha256:  $sha")
Write-Output ("version: $ver")
