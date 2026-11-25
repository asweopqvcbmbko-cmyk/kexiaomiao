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
    title: '课表、学习通、电费\n一屏就够了',
    features: [
      { icon: 'book', title: '今日课表 & 考试倒计时', sub: '下一节课、教室地点与期末倒数一目了然' },
      { icon: 'grid', title: '学习通仪表盘聚合', sub: '自动汇总待办作业、考试、课堂任务与课程进度' },
      { icon: 'air', title: '宿舍电量 & 校园通知', sub: '空调余量随时查，教务与学院通知增量直达' }
    ]
  },
  {
    badge: '无感体验 & 隐私本地',
    title: '一次登录无感畅用\n数据纯本地保存',
    features: [
      { icon: 'storage', title: '本机加密 & 静默续登', sub: '凭据经 Android Keystore 加密留存本机，会话过期后台无感续登' },
      { icon: 'sync', title: '全屏原生登录 & 离线快照', sub: '校内外双网自动适配，冷启动秒开上次缓存' },
      { icon: 'bolt', title: '内置云端自动更新', sub: '支持正式版 / Beta 频道切换，应用内一键校验升级' }
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
        {'desc' in current && <p className="onboarding-desc">{current.desc}</p>}

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
