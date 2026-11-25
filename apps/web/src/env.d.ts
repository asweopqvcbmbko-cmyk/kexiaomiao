declare global {
  interface Window {
    haust?: {
      nativeAuth?: (request: import('./types').AuthRequest, options: import('./types').AuthOptions) => Promise<import('./types').AuthResult>
      saveImageToGallery?: (dataUrl: string, filename?: string) => Promise<import('./types').GalleryResult>
      chaoxingLogin?: () => Promise<{ loggedIn: boolean }>
      chaoxingDashboard?: () => Promise<import('./types').ChaoxingDashboard>
      chaoxingActivities?: (ignoredCourses?: string[]) => Promise<import('./types').ChaoxingActivitiesResult>
      chaoxingProgress?: (ignoredCourses?: string[]) => Promise<import('./types').ChaoxingProgressResult>
      chaoxingCourseCache?: () => {
        activities: import('./types').ChaoxingActivitiesResult | null
        progress: import('./types').ChaoxingProgressResult | null
      }
      airconElectricity?: import('./types').AirconElectricityService
      airconRequest?: (url: string) => Promise<{ status: number; data: unknown }>
      status: () => Promise<import('./types').SessionStatus>
      login: (schoolLogin?: import('./types').SchoolLogin) => Promise<import('./types').SessionStatus>
      refreshCourses: () => Promise<import('./types').CourseTable>
      refreshExams: () => Promise<{ fetchedAt: string; exams: import('./types').Exam[] }>
      refreshNotices: () => Promise<{ fetchedAt: string; items: import('./types').NoticeItem[]; stale?: boolean }>
      refreshChargers: () => Promise<import('./types').ChargerData>
      refreshCard: () => Promise<import('./types').CardInfo>
      noticeBody: (item: import('./types').NoticeItem) => Promise<import('./types').NoticeBody>
      fetchNoticeImage?: (url: string, referer?: string) => Promise<string | null>
      cached: () => Promise<{
        courses: import('./types').CourseTable | null
        exams: { exams: import('./types').Exam[]; fetchedAt?: string } | null
        notices: { items: import('./types').NoticeItem[]; fetchedAt?: string } | null
        chargers: import('./types').ChargerData | null
        card: import('./types').CardInfo | null
        session: import('./types').SessionStatus | null
      }>
      openExternal: (url: string) => Promise<boolean>
      openInApp?: (url: string, title?: string) => Promise<boolean>
      launchApp?: (packageName: string) => Promise<{ launched: boolean; installed: boolean }>
      credStatus: () => Promise<{ saved: boolean; username: string; encryptionAvailable: boolean }>
      credSave?: (username: string, password: string) => Promise<boolean>
      credClear?: () => Promise<boolean>
      /** 安卓状态栏配色（跟主题走）；桌面版没有这个方法，调用方要可选链 */
      statusBar?: (o: { color: string; dark: boolean }) => Promise<boolean>
      clearCred: () => Promise<boolean>
      clearCache: () => Promise<boolean>
      onSession: (cb: (st: import('./types').SessionStatus) => void) => () => void
    }
  }
}

export {}
