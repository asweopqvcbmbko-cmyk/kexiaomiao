import { useRef } from 'react'
import { Icon } from '../icons'

export type OnboardingProps = {
  step: number
  replayMode?: boolean
  onStepChange: (step: number) => void
  onBindAccount: () => void
  onStartDemo: () => void
  onSkip: () => void
}

const SLIDES = [
  {
    badge: '河科大校园助手',
    title: '课表、电费、通知\n一屏就够了',
    desc: '把分散在各个校园系统里的核心信息聚合成清晰卡片，打开即看今天最重要的事。',
    features: [
      { icon: 'book', title: '今日课表 & 考试倒计时', sub: '下一节课、教室地点与期末倒数一目了然' },
      { icon: 'air', title: '宿舍空调电量', sub: '随时查看剩余度数与余额，偏低提前提醒' },
      { icon: 'bell', title: '教务与学院通知', sub: '未读消息直达首页，点开即读正文与附件' }
    ]
  },
  {
    badge: '隐私与双网离线',
    title: '数据纯本地保存\n校内外都能秒开',
    desc: '不建中转服务器，所有课表、通知缓存与加密凭据都只留在你的手机本地。',
    features: [
      { icon: 'storage', title: '零云端托管', sub: '凭据经本机系统安全存储加密，切换或清除一键可控' },
      { icon: 'sync', title: '双网自动适配', sub: '校内直连、校外走 WebVPN，离线也能回看已缓存内容' },
      { icon: 'bolt', title: '静默增量刷新', sub: '冷启动秒出上次快照，有新变化时轻波纹提示更新' }
    ]
  },
  {
    badge: '开始使用',
    title: '选择你的体验方式',
    desc: '绑定河科大校园账号即可同步真实课表、通知与电费；也可以先用示例数据逛一逛。',
    features: [
      { icon: 'cat', title: '随时可切换', sub: '演示模式下不读取任何真实信息，顶部入口随时可登录绑定' }
    ]
  }
] as const

export function Onboarding({ step, replayMode, onStepChange, onBindAccount, onStartDemo, onSkip }: OnboardingProps) {
  const touchStartX = useRef<number | null>(null)
  const current = SLIDES[Math.max(0, Math.min(SLIDES.length - 1, step))]
  const isLast = step >= SLIDES.length - 1

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null
  }
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current == null) return
    const endX = e.changedTouches[0]?.clientX ?? touchStartX.current
    const dx = endX - touchStartX.current
    touchStartX.current = null
    if (dx < -48 && step < SLIDES.length - 1) onStepChange(step + 1)
    else if (dx > 48 && step > 0) onStepChange(step - 1)
  }

  return (
    <div
      className="onboarding"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      role="region"
      aria-label="新手引导"
    >
      <header className="onboarding-top">
        <div className="onboarding-brand">
          <span className="onboarding-logo">
            <Icon name="cat" />
          </span>
          <span>科小喵</span>
        </div>
        <button className="onboarding-skip" type="button" onClick={onSkip}>
          {replayMode ? '关闭' : '跳过'}
        </button>
      </header>

      <main className="onboarding-body" key={step}>
        <span className="onboarding-badge">{current.badge}</span>
        <h1 className="onboarding-title">{current.title}</h1>
        <p className="onboarding-desc">{current.desc}</p>

        <div className="onboarding-list">
          {current.features.map((f) => (
            <div className="onboarding-item" key={f.title}>
              <span className="onboarding-item-icon">
                <Icon name={f.icon} />
              </span>
              <span className="onboarding-item-copy">
                <b>{f.title}</b>
                <small>{f.sub}</small>
              </span>
            </div>
          ))}
        </div>
      </main>

      <footer className="onboarding-foot">
        <div className="onboarding-dots" role="tablist" aria-label="引导进度">
          {SLIDES.map((_, idx) => (
            <button
              key={idx}
              type="button"
              role="tab"
              aria-selected={idx === step}
              aria-label={`第 ${idx + 1} 屏`}
              className={`onboarding-dot${idx === step ? ' active' : ''}`}
              onClick={() => onStepChange(idx)}
            />
          ))}
        </div>

        {isLast ? (
          <div className="onboarding-actions">
            <button className="primary onboarding-primary" type="button" onClick={onBindAccount}>
              {replayMode ? '去登录 / 切换账号' : '立即绑定校园账号'}
            </button>
            <button className="softbtn onboarding-secondary" type="button" onClick={onStartDemo}>
              {replayMode ? '返回主页' : '先用示例数据逛逛'}
            </button>
          </div>
        ) : (
          <div className="onboarding-actions">
            <button className="primary onboarding-primary" type="button" onClick={() => onStepChange(step + 1)}>
              下一步
            </button>
          </div>
        )}
      </footer>
    </div>
  )
}
