# 功能完成度
源路径相对 apps/web/src；“有实现”表示存在调用链。线上可用性尚未实测。
|功能|实现证据|状态及缺口|
|---|---|---|
|WebVPN 与复用|android/api.ts 登录、recoverSession、status；SchoolBrowserPlugin 和 SchoolCredentialsPlugin|有实现；验证取消、冷启动、二次认证及换号|
|课表、考试|android/lib/eams.ts → api.ts:388、417 → App.tsx:164|有抓取、缓存和恢复；空表语义有缺陷|
|刷新及异常|App.tsx:188–211、299；api.ts:583|有刷新排队、前台补刷、活动轮询；分项失败显示待验|
|校园卡|android/lib/card.ts、api.ts:471|有余额读取；恢复后的重试缺失|
|空调电费|App.tsx:547、pages/Subs.tsx:199 明示尚未接入|确认仅占位，不能当作校园卡余额|
|充电桩|android/lib/chargers.ts、zzsx.ts、areas.ts 和 rules-chargers.ts|有采集、区域汇总、点位规则；实时准确性待对账|
|通知/学习通|android/lib/notices.ts、chaoxing.ts、activities.ts → App 刷新|有实现；部分失败及独立登录态待验|
|导航、主题、状态栏|pages/Home、Schedule、Profile、Subs，theme.ts、kxm.css、MainActivity 和 SchoolBrowserPlugin|有实现；大字、安全区、返回、切换主题待真机|
|构建、测试|根与 mobile/package.json、mobile/android/app/build.gradle、desktop/scripts|有工程、锁和产物；Web 类型检查和桌面解析 69 项通过；Android 构建、签名、业务回归本轮未测|
