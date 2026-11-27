import rewardQrImg from './assets/reward-qr.jpg'
import type { SponsorEntry } from './sponsors-remote.ts'

export {
  DEFAULT_SPONSORS_MANIFEST,
  SPONSORS_CACHE_KEY,
  fetchRemoteSponsors,
  normalizeSponsorsManifest,
  readCachedSponsors,
  writeCachedSponsors,
  type FetchSponsorsResult,
  type SponsorEntry,
  type SponsorsManifest
} from './sponsors-remote.ts'

/**
 * 内置兜底致谢名单（云端 sponsors.json 不可达且无本地缓存时使用）。
 * 日常更新请直接编辑仓库根目录的 sponsors.json，无需重新发版。
 */
export const SPONSORS: SponsorEntry[] = []

/**
 * 微信赞赏码图片（隐藏实名，仅显示微信昵称）。
 */
export const REWARD_QR_IMAGE: string | null = rewardQrImg
