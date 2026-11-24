<#
.SYNOPSIS
  一次性生成科小喵 Android 固定 Release 签名密钥库（Keystore）与 keystore.properties。
  生成的文件均已被 .gitignore 忽略，绝不会提交进 Git 仓库。
.EXAMPLE
  .\scripts\init-release-keystore.ps1
#>
[CmdletBinding()]
param(
    [string]$JdkHome = "D:\AppStore\android-tools\jdk",
    [string]$KeyAlias = "kexiaomiao"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$androidDir = Join-Path $repoRoot "mobile\android"
$jksPath = Join-Path $androidDir "kexiaomiao-release.jks"
$propsPath = Join-Path $androidDir "keystore.properties"

if (Test-Path $jksPath) {
    Write-Host "已存在签名密钥库：$jksPath" -ForegroundColor Yellow
    Write-Host "请妥善备份此文件！更换密钥会导致已安装用户无法覆盖升级。" -ForegroundColor Yellow
    exit 0
}

$keytool = Join-Path $JdkHome "bin\keytool.exe"
if (-not (Test-Path $keytool)) {
    $keytool = (Get-Command keytool -ErrorAction Stop).Source
}

# 生成高强度随机密码（24位）
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$bytes = New-Object byte[] 18
$rng.GetBytes($bytes)
$password = [Convert]::ToBase64String($bytes).Replace('+', 'A').Replace('/', 'B').Replace('=', 'C')

Write-Host "正在生成固定发布签名密钥库..." -ForegroundColor Cyan
& $keytool -genkeypair `
    -v `
    -keystore $jksPath `
    -storetype PKCS12 `
    -keyalg RSA `
    -keysize 2048 `
    -validity 10000 `
    -alias $KeyAlias `
    -storepass $password `
    -keypass $password `
    -dname "CN=KeXiaoMiao, OU=CampusAssistant, O=HAUST, L=Luoyang, ST=Henan, C=CN"

if ($LASTEXITCODE -ne 0) {
    throw "keytool 生成失败（exit=$LASTEXITCODE）"
}

$propsContent = @"
storeFile=../kexiaomiao-release.jks
storePassword=$password
keyAlias=$KeyAlias
keyPassword=$password
"@
[System.IO.File]::WriteAllText($propsPath, $propsContent, [System.Text.UTF8Encoding]::new($false))

Write-Host ""
Write-Host "固定 Release 签名初始化完成！" -ForegroundColor Green
Write-Host "  密钥库：$jksPath"
Write-Host "  配置表：$propsPath"
Write-Host "  重要提示：请将上述两个文件自行加密备份到安全位置（不要上传到任何公开仓库）。" -ForegroundColor Yellow
