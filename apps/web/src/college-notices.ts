/**
 * 河南科技大学 30 个学院 / 学部 / 书院通知公告声明式注册表与订阅管理。
 * 所有 listUrl 均已从官网实测验证可访问（VSB/博达 CMS 静态或动态列表页）。
 */

export type CollegeGroup = '工科' | '农生' | '理科' | '医学' | '经管文' | '特色与书院'

export type CollegeSource = {
  /** 唯一短代号（对应域名前缀与 NoticeItem.source） */
  id: string
  /** 简短标签名（用于筛选胶囊与徽章） */
  shortName: string
  /** 学院全称（用于弹窗搜索与详情部门名） */
  fullName: string
  /** 学部/大类分组 */
  group: CollegeGroup
  /** 学院官网主域名 */
  host: string
  /** 实测验证的通知公告列表地址 */
  listUrl: string
}

export const COLLEGE_GROUPS: CollegeGroup[] = ['工科', '农生', '理科', '医学', '经管文', '特色与书院']

export const MAX_SUBSCRIBED_COLLEGES = 5

export const SUBSCRIBED_COLLEGES_KEY = 'haust:subscribed_colleges_v1'

export const COLLEGES: CollegeSource[] = [
  // 工科（8）
  { id: 'jd', shortName: '机电学院', fullName: '机电工程学院', group: '工科', host: 'jd.haust.edu.cn', listUrl: 'https://jd.haust.edu.cn/xwtz/tzgg.htm' },
  { id: 'cl', shortName: '材料学院', fullName: '材料科学与工程学院', group: '工科', host: 'cl.haust.edu.cn', listUrl: 'https://cl.haust.edu.cn/index/tzgg.htm' },
  { id: 'cd', shortName: '车辆学院', fullName: '车辆与交通工程学院', group: '工科', host: 'cd.haust.edu.cn', listUrl: 'https://cd.haust.edu.cn/tzgg.htm' },
  { id: 'ng', shortName: '农装学院', fullName: '农业装备工程学院', group: '工科', host: 'ng.haust.edu.cn', listUrl: 'https://ng.haust.edu.cn/xin_list.jsp?urltype=tree.TreeTempUrl&wbtreeid=1037' },
  { id: 'dx', shortName: '信息学院', fullName: '信息工程学院', group: '工科', host: 'dx.haust.edu.cn', listUrl: 'https://dx.haust.edu.cn/index/tzgg.htm' },
  { id: 'rj', shortName: '软件学院', fullName: '软件学院', group: '工科', host: 'rj.haust.edu.cn', listUrl: 'https://rj.haust.edu.cn/list.jsp?urltype=tree.TreeTempUrl&wbtreeid=1014' },
  { id: 'tmgc', shortName: '土建学院', fullName: '土木建筑学院', group: '工科', host: 'tmgc.haust.edu.cn', listUrl: 'https://tmgc.haust.edu.cn/tzgg.htm' },
  { id: 'hgzy', shortName: '化工学院', fullName: '化学化工学院', group: '工科', host: 'hgzy.haust.edu.cn', listUrl: 'https://hgzy.haust.edu.cn/tzgg.htm' },
  // 农生（4）
  { id: 'spsw', shortName: '食品学院', fullName: '食品与生物工程学院', group: '农生', host: 'spsw.haust.edu.cn', listUrl: 'https://spsw.haust.edu.cn/index/tzgg.htm' },
  { id: 'nx', shortName: '农学院', fullName: '农学院', group: '农生', host: 'nx.haust.edu.cn', listUrl: 'https://nx.haust.edu.cn/index/tzgg.htm' },
  { id: 'dk', shortName: '动科学院', fullName: '动物科技学院', group: '农生', host: 'dk.haust.edu.cn', listUrl: 'https://dk.haust.edu.cn/index/tzgg.htm' },
  { id: 'lx', shortName: '园艺学院', fullName: '园艺与植物保护学院', group: '农生', host: 'lx.haust.edu.cn', listUrl: 'https://lx.haust.edu.cn/xwdt/tzgg.htm' },
  // 理科（2）
  { id: 'math', shortName: '数统学院', fullName: '数学与统计学院', group: '理科', host: 'math.haust.edu.cn', listUrl: 'https://math.haust.edu.cn/index/tzgg.htm' },
  { id: 'wl', shortName: '物理学院', fullName: '物理工程学院', group: '理科', host: 'wl.haust.edu.cn', listUrl: 'https://wl.haust.edu.cn/index/tzgg.htm' },
  // 医学（4）
  { id: 'yxb', shortName: '医学部', fullName: '医学部（洛阳医学院）', group: '医学', host: 'yxb.haust.edu.cn', listUrl: 'https://yxb.haust.edu.cn/index/tzgg.htm' },
  { id: 'yx', shortName: '基础医学院', fullName: '基础医学与法医学院', group: '医学', host: 'yx.haust.edu.cn', listUrl: 'https://yx.haust.edu.cn/index/tzgg.htm' },
  { id: 'yg', shortName: '医技学院', fullName: '医学技术与工程学院', group: '医学', host: 'yg.haust.edu.cn', listUrl: 'https://yg.haust.edu.cn/index/tzgg1.htm' },
  { id: 'hl', shortName: '护理学院', fullName: '护理学院', group: '医学', host: 'hl.haust.edu.cn', listUrl: 'https://hl.haust.edu.cn/index/ggtz.htm' },
  // 经管文（7）
  { id: 'sxy', shortName: '商学院', fullName: '商学院', group: '经管文', host: 'sxy.haust.edu.cn', listUrl: 'https://sxy.haust.edu.cn/index/tzgg.htm' },
  { id: 'zs', shortName: '马院', fullName: '马克思主义学院', group: '经管文', host: 'zs.haust.edu.cn', listUrl: 'https://zs.haust.edu.cn/xygk/xytz.htm' },
  { id: 'rw', shortName: '人文学院', fullName: '人文学院', group: '经管文', host: 'rw.haust.edu.cn', listUrl: 'https://rw.haust.edu.cn/tzgg/tzgg.htm' },
  { id: 'fx', shortName: '法学院', fullName: '法学院', group: '经管文', host: 'fx.haust.edu.cn', listUrl: 'https://fx.haust.edu.cn/index/tzgg.htm' },
  { id: 'wy', shortName: '外国语学院', fullName: '外国语学院', group: '经管文', host: 'wy.haust.edu.cn', listUrl: 'https://wy.haust.edu.cn/index/tzgg.htm' },
  { id: 'yssj', shortName: '艺设学院', fullName: '艺术与设计学院', group: '经管文', host: 'yssj.haust.edu.cn', listUrl: 'https://yssj.haust.edu.cn/xwysj/tzgg.htm' },
  { id: 'ty', shortName: '体育学院', fullName: '体育学院', group: '经管文', host: 'ty.haust.edu.cn', listUrl: 'https://ty.haust.edu.cn/index/tzgg.htm' },
  // 特色与书院（5）
  { id: 'yy', shortName: '应工学院', fullName: '应用工程学院', group: '特色与书院', host: 'yy.haust.edu.cn', listUrl: 'https://yy.haust.edu.cn/index/tzgg.htm' },
  { id: 'mdlgxy', shortName: '莫动学院', fullName: '莫动理工学院', group: '特色与书院', host: 'mdlgxy.haust.edu.cn', listUrl: 'https://mdlgxy.haust.edu.cn/zxtz.htm' },
  { id: 'gjxy', shortName: '国际学院', fullName: '国际教育学院', group: '特色与书院', host: 'gjxy.haust.edu.cn', listUrl: 'https://gjxy.haust.edu.cn/zxtz.htm' },
  { id: 'lzsy', shortName: '丽正书院', fullName: '丽正书院', group: '特色与书院', host: 'lzsy.haust.edu.cn', listUrl: 'https://lzsy.haust.edu.cn/index/tzgg.htm' },
  { id: 'hlsy', shortName: '河洛书院', fullName: '河洛书院', group: '特色与书院', host: 'hlsy.haust.edu.cn', listUrl: 'https://hlsy.haust.edu.cn/index/tzgg.htm' }
]

const COLLEGE_MAP = new Map<string, CollegeSource>(COLLEGES.map((c) => [c.id, c]))

export const CORE_NOTICE_SOURCES = ['school', 'news', 'jwc'] as const

export function getCollegeById(id: string): CollegeSource | undefined {
  return COLLEGE_MAP.get(id)
}

export function isCollegeSource(source: string): boolean {
  return COLLEGE_MAP.has(source)
}

export function sanitizeCollegeIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return []
  const unique: string[] = []
  const seen = new Set<string>()
  for (const raw of ids) {
    const id = typeof raw === 'string' ? raw.trim() : ''
    if (!id || seen.has(id) || !COLLEGE_MAP.has(id)) continue
    seen.add(id)
    unique.push(id)
    if (unique.length >= MAX_SUBSCRIBED_COLLEGES) break
  }
  return unique
}

export function readSubscribedColleges(storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage !== 'undefined' ? localStorage : undefined): string[] {
  try {
    const raw = storage?.getItem(SUBSCRIBED_COLLEGES_KEY)
    if (!raw) return []
    return sanitizeCollegeIds(JSON.parse(raw))
  } catch (_) {
    return []
  }
}

export function writeSubscribedColleges(ids: string[], storage: Pick<Storage, 'setItem'> | undefined = typeof localStorage !== 'undefined' ? localStorage : undefined): string[] {
  const clean = sanitizeCollegeIds(ids)
  try {
    storage?.setItem(SUBSCRIBED_COLLEGES_KEY, JSON.stringify(clean))
  } catch (_) {}
  return clean
}

export function getSubscribedCollegeSources(ids: string[]): CollegeSource[] {
  return sanitizeCollegeIds(ids)
    .map((id) => COLLEGE_MAP.get(id))
    .filter((item): item is CollegeSource => Boolean(item))
}
