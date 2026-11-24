import { LocalNotifications } from '@capacitor/local-notifications'
import { registerPlugin } from '@capacitor/core'
import { browser } from './engine'

const credentials = registerPlugin<{ purgeRetiredCredentials(): Promise<void> }>('SchoolCredentials')
const reminderKey = 'haust.xxt.reminders.scheduled.v1'
const migrationKey = 'haust.storage.retirement.v1'

export function removeRetiredWebData() {
  for (const key of [
    'haust.cache.tasks', 'haust.cache.cx.accountId', 'haust.cache.done',
    'haust.cache.cx.xxt-detail-cache.v1', 'haust-kxm-done-v1', 'haust-kxm-xxt-hidden-v1',
    'haust-kxm-cx-prompted', 'haust.xxt.reminders.seen.v1'
  ]) localStorage.removeItem(key)
}

export async function cancelRetiredReminders() {
  let ids: unknown
  try { ids = JSON.parse(localStorage.getItem(reminderKey) || '[]') } catch { ids = [] }
  if (Array.isArray(ids)) {
    const notifications = ids.filter((id): id is number => Number.isInteger(id)).map((id) => ({ id }))
    if (notifications.length) await LocalNotifications.cancel({ notifications })
  }
  localStorage.removeItem(reminderKey)
}

export async function retireStudyData() {
  if (localStorage.getItem(migrationKey) === 'complete') return
  const results = await Promise.allSettled([
    cancelRetiredReminders(),
    credentials.purgeRetiredCredentials(),
    browser.clearCookiesForHosts({ hosts: [
      'chaoxing.com', 'i.chaoxing.com', 'passport2.chaoxing.com', 'mooc1.chaoxing.com',
      'mooc2-ans.chaoxing.com', 'mooc1-api.chaoxing.com', 'notice.chaoxing.com',
      'mobilelearn.chaoxing.com', 'im.chaoxing.com'
    ].join(',') }).then(({ ok }) => { if (!ok) throw new Error('Retired cookies could not be cleared') })
  ])
  if (results.every(result => result.status === 'fulfilled')) localStorage.setItem(migrationKey, 'complete')
}
