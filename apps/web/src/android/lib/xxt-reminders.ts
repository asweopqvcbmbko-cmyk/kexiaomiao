import { Capacitor } from '@capacitor/core'
import type { TaskData } from '../../types'
import { cancelRetiredReminders } from '../retired-study-data'

/** Existing screen handlers remain callable while the service is disabled. */
export async function scheduleStudyReminders(_data: TaskData | null) {}

export async function clearStudyReminders() {
  if (Capacitor.isNativePlatform()) await cancelRetiredReminders().catch(() => {})
}
