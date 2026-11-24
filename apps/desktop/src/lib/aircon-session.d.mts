export const AIRCON_ORIGIN: string
export function createCloudPaymentSession(
  transport: (url: string, headers: Record<string, string>) => Promise<{
    status: number
    data: unknown
    location?: string | null
    setCookies?: string | string[] | null
  }>,
  bootstrapBrowser?: (project: string, userAgent: string, cookieUrl: string) => Promise<
    string | { cookies: string; mode?: string; httpStatus?: number; error?: string }
  >,
  webViewFallback?: (project: string, activateUrl: string, targetUrl: string, userAgent: string) => Promise<{
    status: number
    data: unknown
    mode?: string
  }>
): (url: string | URL) => Promise<{ status: number; data: unknown }>
