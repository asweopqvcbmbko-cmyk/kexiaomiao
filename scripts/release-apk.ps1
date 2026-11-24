<#
.SYNOPSIS
  科小喵一键云端发版脚本：
  自动递增 versionCode -> 校验单测与构建固定签名 Release APK -> 计算 SHA256 -> 更新 update-manifest.json -> 推送 GitHub 公开分发仓库。
.EXAMPLE
  .\scripts\release-apk.ps1 -Channel beta -VersionName 0.2.0-beta.1 -Notes "1. 新增云端自动更新`n2. 优化登录动效"
  .\scripts\release-apk.ps1 -Channel stable -VersionName 0.2.0 -Notes "正式版发布"
  .\scripts\release-apk.ps1 -Channel beta -VersionName 0.2.0-beta.1 -SkipPush
#>
[CmdletBinding()]
param(
    [ValidateSet("stable", "beta")]
    [string]$Channel = "beta",
    [Parameter(Mandatory = $true)]
    [string]$VersionName,
    [string]$Notes = "体验优化与问题修复",
    [string]$Repo = "",
    [string]$Branch = "main",
    [string]$JdkHome = "",
    [switch]$SkipPush
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$repoRoot = Split-Path -Parent $PSScriptRoot
$gradleFile = Join-Path $repoRoot "mobile\android\app\build.gradle"
$keystoreProps = Join-Path $repoRoot "mobile\android\keystore.properties"
$updateConfig = Join-Path $repoRoot "apps\web\src\update-config.ts"

# 1. 自动解析分发仓库名
if (-not $Repo) {
    $cfgText = Get-Content -Raw -Encoding UTF8 $updateConfig
    if ($cfgText -match "UPDATE_GITHUB_REPO\s*=\s*ENV_REPO\s*\|\|\s*'([^']+)'") {
        $Repo = $Matches[1]
    }
}
if (-not $SkipPush -and (-not $Repo -or $Repo -like "YOUR_GITHUB_USER/*")) {
    throw "请先在 apps/web/src/update-config.ts 配置你的公开分发仓库（或通过 -Repo owner/repo 传入），或加 -SkipPush 仅本地打包。"
}

# 2. 检查固定签名配置
if (-not (Test-Path $keystoreProps)) {
    throw "未找到 $keystoreProps。请先运行 .\scripts\init-release-keystore.ps1 生成固定 Release 签名，避免朋友手机无法覆盖安装。"
}

# 3. 递增 versionCode 并写入 versionName
$gradleText = Get-Content -Raw -Encoding UTF8 $gradleFile
if ($gradleText -notmatch "versionCode\s+(\d+)") {
    throw "无法在 $gradleFile 中找到 versionCode"
}
$oldCode = [int]$Matches[1]
$newCode = $oldCode + 1
$gradleText = [regex]::Replace($gradleText, "versionCode\s+\d+", "versionCode $newCode", 1)
$gradleText = [regex]::Replace($gradleText, 'versionName\s+"[^"]+"', "versionName `"$VersionName`"", 1)
[System.IO.File]::WriteAllText($gradleFile, $gradleText, [System.Text.UTF8Encoding]::new($false))
Write-Host "版本号已更新：versionCode $oldCode -> $newCode, versionName = $VersionName ($Channel)" -ForegroundColor Cyan

# 4. Web 校验与构建
Push-Location (Join-Path $repoRoot "apps\web")
try {
    & npx tsc --noEmit
    if ($LASTEXITCODE -ne 0) { throw "tsc 类型检查失败" }
    & npm test
    if ($LASTEXITCODE -ne 0) { throw "离线单元测试失败" }
    & npx vite build
    if ($LASTEXITCODE -ne 0) { throw "vite build 失败" }
} finally {
    Pop-Location
}

# 5. Capacitor 同步与签名 Release APK 构建
Push-Location (Join-Path $repoRoot "mobile")
try {
    & npx cap sync android
    if ($LASTEXITCODE -ne 0) { throw "cap sync android 失败" }
} finally {
    Pop-Location
}

if (-not $JdkHome -and $env:JAVA_HOME) { $JdkHome = $env:JAVA_HOME }
if ($JdkHome -and (Test-Path $JdkHome)) {
    $env:JAVA_HOME = $JdkHome
    $env:Path = "$env:JAVA_HOME\bin;$env:Path"
}
Push-Location (Join-Path $repoRoot "mobile\android")
try {
    & .\gradlew.bat assembleRelease --console=plain
    if ($LASTEXITCODE -ne 0) { throw "gradlew assembleRelease 失败" }
} finally {
    Pop-Location
}

$builtApk = Join-Path $repoRoot "mobile\android\app\build\outputs\apk\release\app-release.apk"
if (-not (Test-Path $builtApk)) {
    throw "未找到产物：$builtApk"
}

# 6. 复制产物并生成 update-manifest.json
$outDir = Join-Path $repoRoot "out\releases"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$tag = "v$VersionName"
$apkName = "kexiaomiao-$tag.apk"
$outApk = Join-Path $outDir $apkName
Copy-Item -Force $builtApk $outApk

$sha256 = (Get-FileHash $outApk -Algorithm SHA256).Hash.ToLowerInvariant()
$size = (Get-Item $outApk).Length
$nowIso = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$apkUrl = "https://github.com/$Repo/releases/download/$tag/$apkName"

$manifestPath = Join-Path $outDir "update-manifest.json"
$manifest = @{
    schemaVersion = 1
    updatedAt     = $nowIso
    stable        = $null
    beta          = $null
}
if (Test-Path $manifestPath) {
    try {
        $prev = Get-Content -Raw -Encoding UTF8 $manifestPath | ConvertFrom-Json
        if ($prev.stable) { $manifest.stable = $prev.stable }
        if ($prev.beta) { $manifest.beta = $prev.beta }
    } catch {}
}

$entry = @{
    versionCode = $newCode
    versionName = $VersionName
    channel     = $Channel
    apkUrl      = $apkUrl
    sha256      = $sha256
    size        = $size
    notes       = $Notes
    publishedAt = $nowIso
}
$manifest[$Channel] = $entry

$manifestJson = $manifest | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText($manifestPath, $manifestJson, [System.Text.UTF8Encoding]::new($false))

Write-Host ""
Write-Host "Release 产物已就绪：" -ForegroundColor Green
Write-Host "  APK     : $outApk"
Write-Host "  SHA256  : $sha256"
Write-Host "  大小    : $([Math]::Round($size / 1MB, 2)) MB"
Write-Host "  清单    : $manifestPath"

if ($SkipPush) {
    Write-Host "已跳过云端推送（-SkipPush）。" -ForegroundColor Yellow
    exit 0
}

# 7. 通过 gh CLI 推送至 GitHub 公开分发仓库
$gh = (Get-Command gh -ErrorAction SilentlyContinue).Source
if (-not $gh) {
    Write-Host "未检测到 gh CLI，请手动将 $outApk 上传到 https://github.com/$Repo/releases ($tag)，并将 $manifestPath 提交到仓库 $Branch 分支根目录。" -ForegroundColor Yellow
    exit 0
}

Write-Host "正在创建 GitHub Release $tag 并上传 APK..." -ForegroundColor Cyan
$ghArgs = @("release", "create", $tag, $outApk, "--repo", $Repo, "--title", "科小喵 $tag", "--notes", $Notes)
if ($Channel -eq "beta") { $ghArgs += "--prerelease" }
& $gh @ghArgs
if ($LASTEXITCODE -ne 0) { throw "gh release create 失败" }

Write-Host "正在更新 $Repo/$Branch 的 update-manifest.json..." -ForegroundColor Cyan
$b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($manifestJson))
$existingSha = ""
try {
    $existingSha = (& $gh api "repos/$Repo/contents/update-manifest.json?ref=$Branch" --jq ".sha" 2>$null).Trim()
} catch {}

$payload = @{
    message = "chore(release): publish $Channel $tag"
    content = $b64
    branch  = $Branch
}
if ($existingSha) { $payload.sha = $existingSha }
$payloadFile = Join-Path $env:TEMP "kxm-manifest-payload.json"
[System.IO.File]::WriteAllText($payloadFile, ($payload | ConvertTo-Json -Depth 4), [System.Text.UTF8Encoding]::new($false))

& $gh api --method PUT "repos/$Repo/contents/update-manifest.json" --input $payloadFile | Out-Null
Remove-Item -Force $payloadFile -ErrorAction SilentlyContinue
if ($LASTEXITCODE -ne 0) { throw "更新 update-manifest.json 失败" }

Write-Host "云端发版完成！朋友手机打开科小喵即可自动收到 $tag ($Channel) 更新推送。" -ForegroundColor Green
