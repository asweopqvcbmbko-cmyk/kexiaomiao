import rewardQrImg from './assets/reward-qr.jpg'

export type SponsorEntry = {
  name: string
  amount: number
  note?: string
}

/**
 * 投喂致谢名单（按金额降序展示；达到 3 人及以上时自动展示前三名领奖台，其余列于下方）。
 * 维护方式：收到同学赞赏并征得昵称展示同意后，追加到下方数组即可。
 */
export const SPONSORS: SponsorEntry[] = []

/**
 * 微信赞赏码图片（隐藏实名，仅显示微信昵称）。
 */
export const REWARD_QR_IMAGE: string | null = rewardQrImg
