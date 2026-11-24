import { Capacitor, registerPlugin } from '@capacitor/core'

export type HapticStyle = 'light' | 'medium' | 'success' | 'error'

const SchoolBrowserHaptic = registerPlugin<{
  haptic(o: { style: HapticStyle }): Promise<void>
}>('SchoolBrowser')

/** 触发 Android 原生线性马达微触感（桌面/普通浏览器静默跳过） */
export function haptic(style: HapticStyle = 'light'): void {
  if (!Capacitor.isNativePlatform()) return
  void SchoolBrowserHaptic.haptic({ style }).catch(() => {})
}
