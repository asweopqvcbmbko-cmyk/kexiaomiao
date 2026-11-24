# 主工程审计 · 2026-11-22
## 基线
审查目录 D:/AppStore/任务/haust-app。git status 与 git log 均报告当前及父目录无 Git 仓库，无法判断分支、脏文件或来源提交。源码、锁文件、Gradle wrapper 和产物均存在；此前 C 盘报告仅针对原型与 APK。
- apps/web 为共享 React 前端；apps/desktop 为 Electron 主进程、适配器与脚本；mobile 为 Capacitor 配置及 Android 工程；fixtures、prototype、docs、build 分别存放样本、设计稿、说明和生成物。build/verify 含历史采集/探针，避免分发原始记录。
- mobile/android/app/build.gradle:7–12 声明应用 ID、0.1.7、code 8；C 盘内测 APK SHA-256 为 6BC74DD0DFC9D5502086A736357F9DDDC96AE2EF07DAC01EDBE48E856390A48B。apps/web/dist/assets 的四份 JS/CSS 均与该 APK 对应条目逐一哈希相同。未由此推断原生字节码、当前 TS 或签名完全一致。
- 实际运行现有 Web TypeScript noEmit 检查通过；桌面学习通解析离线自测通过 69 项断言。未重打包、运行 instrumentation、连接学校或使用真实账号。构建说明、充电桩需求/实现及学习通文档中的历史验收不计入本轮。
## 调用链
apps/web/src/main.tsx:12–24 注入 Android API；App.tsx:143–211 回填缓存、取会话、拉课表和考试，再取通知、校园卡、充电桩和学习通，合并重叠刷新；:299–305 回到前台检查时间。安卓 adapter 在 android/api.ts 调度 engine/auth、lib/eams、lib/card、lib/chargers 等。MainActivity.java:13–14 注册浏览器与凭据插件；:51、62 转发返回动作和刷新 Cookie。SchoolBrowserPlugin.java:203、299 执行页面脚本，:349 通过 CookieManager 取指定地址 Cookie。SchoolCredentialsPlugin.java:28、55、90 使用 AndroidKeyStore、AES-GCM；android/api.ts:119–131 涵盖旧凭据迁移。实际 Cookie 过期、清理、密钥失效行为仍待真机。
## 问题清单
下表 TS 路径相对 apps/web/src，Java 插件位于 mobile/android/app/src/main/java/cn/edu/haust/campusassistant。优先级和验证状态独立。
|编号／状态|位置与证据|原因与影响|最小修复方向与验收|
|---|---|---|---|
|P0-1 疑似跨账号展示，残留路径已确认|android/api.ts:75–83、625–637：缓存按资源键保存，清凭据只移除 session、凭据及 Cookie。App.tsx:143–152、275、1085–1095：启动先应用缓存，清凭据只重置 status 与任务|身份和缓存生命周期未绑定；同设备 A→B 时可能显示 A 的课程、考试、卡数据。尚无真机串号证据|验证切号及在途返回；按身份隔离，退出使旧请求失效。A 同步后退出、B 弱网登录、离线重启，内存和各页面均无 A 数据|
|P1-1 已确认分支|android/api.ts:388–444；App.tsx:164–174。空课程或考试触发恢复，非空才覆盖旧缓存；UI 根据课程数量判断成功|合法空学期、无考试可留旧数据，单独考试错误也可能被课程成功掩盖|区分可信空表、失效、解析失败；预置旧考试后，合法空表清零，结构异常保留旧值并注明原因|
|P1-2 已确认分支|android/api.ts:471–488。校园卡 NO_SESSION 后恢复，但此次没有重新读取余额|需要额外刷新，或返回过期余额|恢复成功限重读一次；单次操作拿到新金额，失败无循环|
|P1-3 已确认配置|SchoolBrowserPlugin.java:404 和 mobile/capacitor.config.json 的 allowMixedContent；内测 APK Manifest debuggable=true|远程登录/采集窗口允许混合内容；已知内测配置，正式包尚未验证|按实际依赖收紧 WebView 配置，检查发布变体。可信登录、教务、服务在限制下可用，发布包不可调试|
|P1-4 已确认错误语义|android/api.ts:583 起 pollActivities 失败返回空结果；App.tsx:287 活动回调再请求任务，:188 记录整轮时间|调用方无法区分本次轮询失败和真实空集，整轮时间也不证明每项均成功|记录分资源最后成功时间与错误；有缓存时断网应显示过期状态，真实空集能独立展示|
|P1-5 已确认开发模式控制流，表现待运行|main.tsx:21 启用 StrictMode；App.tsx:269–295 首次 effect 设置 didInit，清理置 alive=false，再次 setup 被 didInit 拦截|开发模式 effect 重放时可能取消初始化并失去订阅；生产行为单独验证|让 effect 可对称重建。开发模式冷启动能恢复缓存并订阅一次，卸载后停止回调|
|P1-6 已确认断言不符|mobile/android/app/src/androidTest/java/com/getcapacitor/myapp/ExampleInstrumentedTest.java:24 断言模板包名，与 app/build.gradle:7 不同|目标应用的基础冒烟测试预期错误，影响设备验收|使用目标变体包名，运行 connectedDebugAndroidTest 并断言实际入口可启动|
|P2-1 已确认版本来源缺口|根目录无 Git 元数据；mobile/package.json 的 apk 只执行 assembleDebug，与根 build:web 和 mobile sync 分离|源码快照难追溯，单跑 apk 可能打入旧 Web 资源|记录来源提交或快照摘要，串联现有构建步骤；干净构建并核对嵌入资源与 Web 产物摘要|
|P2-2 疑似跨平台漂移|android/lib/parse.ts 与 apps/desktop/src/lib/chaoxing/parse.js 分别实现解析；桌面自测第 8 行仅加载桌面代码|单端测试通过无法证明 Android 同步正确|同一组脱敏输入分别调用两端，比较业务字段；差异有平台依据后再考虑共享|
## 未测边界
尚未确认生产崩溃、跨账号泄露、真实服务可用率或签名升级兼容。系统栏及动画已有实现：kxm.css:12、74–80 处理减少动效、安全区；SchoolBrowserPlugin.java:325 设置系统栏。需覆盖手势/三键、大字和旧 WebView，不据静态代码给出视觉通过结论。
