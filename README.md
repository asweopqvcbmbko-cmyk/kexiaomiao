# 科小喵（KeXiaoMiao）· 河南科技大学校园助手

[![CI](https://github.com/asweopqvcbmbko-cmyk/kexiaomiao/actions/workflows/ci.yml/badge.svg)](https://github.com/asweopqvcbmbko-cmyk/kexiaomiao/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

一款面向河南科技大学（HAUST）学生的轻量级校园日常助手，采用 **React + TypeScript + Capacitor Android**（兼顾 Electron 桌面端复用）架构，纯本地直连校园服务，**无任何第三方中转服务器**，所有账号凭据仅保存在本机安全存储中。

## 核心功能

- **今日课程与全周课表**：首页一眼看今日课程进度，点击卡片直达全周课表与冲突排查；支持首帧本地快照秒开与分层 SWR 无感刷新。
- **超星学习通仪表盘**：原生聚合未交作业、双源考试安排、课程任务与学习进度，支持紧急度分组、直观倒计时徽章、忽略指定课程与一键跳转学习通 App。
- **校园通知离线库**：基于客户端 IndexedDB 增量拉取与双网 ID 归一化（校内直连 / WebVPN），支持正文缓存离线秒读。
- **校园生活服务**：宿舍空调电费查询（支持绑定房间）、一卡通余额、校园充电桩空闲状态与考试倒计时。
- **统一原生登录与无感认证动效**：教务系统与学习通（密码 / 短信验证码 / 扫码）均提供全屏原生登录界面，后台静默认证、分级风控透出，搭配 60fps 全屏遮罩→中央圆形徽章形变动效。
- **云端自动更新（支持正式版 / Beta 渠道）**：内置多路加速与直连回退，支持每日首次打开静默检查、应用内实时下载进度、SHA256 完整性校验与一键覆盖安装。

## 技术栈

- **前端 UI**：React 18、TypeScript、Vite、原生 CSS 变量（浅色 / 深色 / 跟随系统）
- **移动端**：Capacitor 8 + 原生 Android 插件（`SchoolBrowserPlugin`、`SchoolCredentialsPlugin`、`AppUpdaterPlugin`）
- **桌面端**：Electron（复用同一套 Web 界面与数据门面）
- **本地存储**：Android Keystore（加密教务凭据）、IndexedDB（校园通知与正文）、`localStorage`（首帧快照与偏好设置）

## 目录结构

```text
.
├── apps/
│   ├── web/                # React + TypeScript 主界面与离线单元测试
│   └── desktop/            # Electron 桌面端适配
├── mobile/
│   └── android/            # Capacitor Android 工程与原生 Java 插件
├── scripts/
│   ├── init-release-keystore.ps1  # 一次性生成本地固定 Release 签名密钥
│   └── release-apk.ps1            # 一键构建固定签名 APK 并推送至 GitHub Releases
└── docs/                   # 设计文档与验收记录
```

## 本地开发与构建

### 1. 安装依赖与运行 Web 预览

```bash
pnpm install
pnpm dev:web
```

浏览器打开 `http://localhost:5173/?preview=1` 可在离线状态下预览全部界面与交互动效。

### 2. 类型检查与离线单元测试

```bash
pnpm typecheck
pnpm test
```

### 3. 构建 Android APK

```bash
pnpm build:web
cd mobile && npx cap sync android
cd android && ./gradlew assembleDebug
```

### 4. 一键签名发版（云端自动更新）

首次发版前在本机生成固定签名密钥（已加入 `.gitignore`，不会入库）：

```powershell
.\scripts\init-release-keystore.ps1
```

发版推送至 GitHub Releases 并自动更新 `update-manifest.json`：

```powershell
# 发布 Beta 测试版
.\scripts\release-apk.ps1 -Channel beta -VersionName 0.2.0-beta.2 -Notes "更新说明"

# 发布正式版
.\scripts\release-apk.ps1 -Channel stable -VersionName 0.2.0 -Notes "正式版更新说明"
```

## 隐私与免责声明

- 本项目为开源第三方校园工具，与河南科技大学官方及超星学习通无官方隶属关系。
- 所有网络请求均由用户设备直接发往学校教务、校园门户、WebVPN 或超星官方域名，**不经过任何第三方后台服务器**，不收集、不上传任何个人账号或隐私数据。
- 教务「记住密码」仅加密保存在本机 Android Keystore 中，学习通仅记录上次账号且绝不落盘密码。

## License

[MIT](./LICENSE)
