import assert from 'node:assert/strict'
import vm from 'node:vm'
import { fetchCard } from '../src/android/lib/card.ts'
import {
  fetchList,
  fetchBody,
  toWebVpnUrl,
  toDirectUrl,
  buildCandidateUrls
} from '../src/android/lib/notices.ts'
import {
  COLLEGES,
  MAX_SUBSCRIBED_COLLEGES,
  SUBSCRIBED_COLLEGES_KEY,
  readSubscribedColleges,
  sanitizeCollegeIds,
  writeSubscribedColleges
} from '../src/college-notices.ts'
import { createCloudPaymentSession } from '../../desktop/src/lib/aircon-session.mjs'
import {
  WebVpnAuthError,
  collectIncrementalPages,
  getCachedNoticeBody,
  normalizeNoticeKey,
  saveNoticeBody,
  upsertNotices
} from '../src/notice-db.ts'
import {
  buildChaoxingTodos,
  fetchChaoxingActivities,
  fetchChaoxingDashboard,
  fetchChaoxingProgress,
  filterByIgnoredCourses,
  isChaoxingLoginUrl,
  mergeChaoxingExams,
  parseCourseListJson,
  parseLeftTimeMinutes
} from '../src/android/lib/chaoxing.ts'
import { authPageScript, classifyAuthError, classifyAuthRisk } from '../src/android/lib/auth-flow.ts'
import {
  CHAOXING_LAST_ACCOUNT_KEY,
  classifyChaoxingQrStatus,
  driveChaoxingAuth,
  isChaoxingDestination,
  readChaoxingAccount,
  rememberChaoxingAccount
} from '../src/android/lib/chaoxing-auth.ts'
import { buildApkDownloadUrls, buildManifestUrls, isUpdateRepoConfigured } from '../src/update-config.ts'
import { compareSemver, pickBestRelease, shouldAutoCheckToday } from '../src/updater.ts'
import { hasExistingUserConfig, readChaoxingSnapshot } from '../src/snapshot.ts'

async function runTests() {
  assert.equal(COLLEGES.length, 30)
  assert.equal(new Set(COLLEGES.map(({ id }) => id)).size, 30)
  for (const college of COLLEGES) {
    const url = new URL(college.listUrl)
    assert.equal(url.protocol, 'https:')
    assert.match(url.hostname, /^[a-z0-9-]+\.haust\.edu\.cn$/)
    assert.equal(url.hostname, college.host)
  }
  assert.equal(MAX_SUBSCRIBED_COLLEGES, 5)
  const collegeIds = [' jd ', 'jd', 'unknown', 'cl', 'ng', 'dx', 'wl', 'ty']
  const cleanCollegeIds = ['jd', 'cl', 'ng', 'dx', 'wl']
  assert.deepEqual(sanitizeCollegeIds(collegeIds), cleanCollegeIds)
  assert.deepEqual(sanitizeCollegeIds('jd'), [])
  const subscriptionStorage = new Map()
  const collegeStorage = {
    getItem: (key) => subscriptionStorage.get(key) ?? null,
    setItem: (key, value) => subscriptionStorage.set(key, value)
  }
  assert.deepEqual(readSubscribedColleges(collegeStorage), [])
  assert.deepEqual(writeSubscribedColleges(collegeIds, collegeStorage), cleanCollegeIds)
  assert.deepEqual(readSubscribedColleges(collegeStorage), cleanCollegeIds)
  assert.deepEqual(writeSubscribedColleges([], collegeStorage), [])
  assert.deepEqual(readSubscribedColleges(collegeStorage), [])
  collegeStorage.setItem(SUBSCRIBED_COLLEGES_KEY, 'invalid JSON')
  assert.deepEqual(readSubscribedColleges(collegeStorage), [])

  // 1. card.ts: 落地到登录页应立刻抛出 NO_SESSION
  await assert.rejects(
    () =>
      fetchCard({
        load: async () => 'https://cas-haust-edu-cn-s.haust.edu.cn/cas/login?service=...',
        waitFor: async () => {
          throw new Error('should not wait after login redirect')
        },
        run: async () => {
          throw new Error('should not run after login redirect')
        }
      }),
    (err) => err && err.code === 'NO_SESSION'
  )

  // 2. card.ts: load-error 快速失败（非 NO_SESSION）
  await assert.rejects(
    () =>
      fetchCard({
        load: async () => 'load-error:-2:ERR_INTERNET_DISCONNECTED',
        waitFor: async () => false,
        run: async () => '{}'
      }),
    (err) => err && err.code !== 'NO_SESSION'
  )

  // 3. card.ts: 正文渲染出登录页时应抛出 NO_SESSION
  await assert.rejects(
    () =>
      fetchCard({
        load: async () => 'https://i-haust-edu-cn-s.haust.edu.cn/main.html#/Index',
        waitFor: async () => true,
        run: async () =>
          JSON.stringify({
            balance: null,
            isLogin: true,
            url: 'https://cas.haust.edu.cn/cas/login',
            context: ''
          })
      }),
    (err) => err && err.code === 'NO_SESSION'
  )

  // 4. card.ts: 正常返回余额
  const cardRes = await fetchCard({
    load: async () => 'https://i-haust-edu-cn-s.haust.edu.cn/main.html#/Index',
    waitFor: async () => true,
    run: async () =>
      JSON.stringify({
        balance: '128.50',
        isLogin: false,
        url: 'https://i-haust-edu-cn-s.haust.edu.cn/main.html#/Index',
        context: '校园卡余额 128.50元'
      })
  })
  assert.equal(cardRes.balance, '128.50')

  // 5. notices.ts: 全部通知源失败时必须抛错，不能返回空数组
  await assert.rejects(
    () =>
      fetchList({
        load: async () => 'load-error:-2:ERR_NAME_NOT_RESOLVED',
        run: async () => '',
        waitFor: async () => ''
      }),
    /全部通知源抓取失败/
  )

  // 6. notices.ts: PORTAL 异步启动 + waitFor 取数正常，且自动为教务处匹配镜像
  let portalStarted = false
  const listRes = await fetchList({
    load: async (url) => url,
    run: async (js) => {
      if (js.includes('__haustPortalNotices')) {
        assert.ok(js.includes('new XMLHttpRequest()'), 'PORTAL_LIST_START_JS must use async XHR for WebVPN hook')
        assert.ok(!js.includes(', false)'), 'PORTAL_LIST_START_JS must not use synchronous XHR')
        portalStarted = true
        return 'started'
      }
      if (js.includes("source: 'jwc'")) {
        return JSON.stringify([
          {
            source: 'jwc',
            sourceName: '教务处',
            id: '101',
            title: '关于期末考试安排的通知',
            date: '2026-11-20',
            dept: '教务处',
            url: 'https://jwc-haust-edu-cn-s.haust.edu.cn/info/101.htm'
          }
        ])
      }
      return JSON.stringify([])
    },
    waitFor: async () => {
      assert.equal(portalStarted, true)
      return JSON.stringify({
        done: true,
        okCount: 1,
        items: [
          {
            source: 'school',
            sourceName: '全校通知',
            id: '201',
            title: '关于期末考试安排的通知',
            date: '2026-11-21',
            dept: '校办',
            url: 'https://www.haust.edu.cn/info/201.htm'
          }
        ]
      })
    }
  })
  assert.equal(listRes.items.length, 2)
  const jwcItem = listRes.items.find((x) => x.source === 'jwc')
  assert.equal(jwcItem.mirrorUrl, 'https://www.haust.edu.cn/info/201.htm')

  // Android 隐藏 WebView 注入的学院列表脚本：静态/动态链接、日期、翻页和故障隔离。
  const jd = COLLEGES.find(({ id }) => id === 'jd')
  const ng = COLLEGES.find(({ id }) => id === 'ng')
  const cl = COLLEGES.find(({ id }) => id === 'cl')
  const jdNext = 'https://jd.haust.edu.cn/xwtz/tzgg/2.htm'
  const collegeLink = (href, title, date, tag = 'li') => {
    const row = { innerText: `${title} ${date}`, matches: () => false }
    return {
      getAttribute: () => href,
      title: '',
      textContent: title,
      parentElement: row,
      closest: () => tag === 'div' ? null : row
    }
  }
  const collegePages = new Map([
    [jd.listUrl, [
      collegeLink('../info/1001/1.htm', '首页', ''),
      collegeLink('../info/1001/1.htm', '机电学院公告一', '2026-1-2'),
      collegeLink('list.jsp?wbnewsid=1', '重复的动态链接', '2026-1-2')
    ]],
    [jdNext, [
      collegeLink('http://jd.haust.edu.cn/info/1001/2.htm', '机电学院公告二', '2026/2/3', 'tr'),
      collegeLink('/info/1001/3.htm', '机电学院公告三', '2026.3.4', 'div')
    ]],
    [ng.listUrl, [
      collegeLink('article.jsp?urltype=news.NewsContentUrl&wbnewsid=4', '农业装备学院公告四', '2026年4月5日'),
      collegeLink('/info/1037/5.htm', '农业装备学院公告五', '5-6')
    ]]
  ])
  const collegeLoads = []
  let collegePageUrl
  const collegeEngine = {
    load: async (url) => {
      collegeLoads.push(url)
      if (url === cl.listUrl) throw new Error('timeout')
      collegePageUrl = url
      return url
    },
    run: async (js) => {
      if (js.includes('__haustPortalNotices')) return 'started'
      if (js.includes("source: 'jwc'")) return JSON.stringify([jwcItem])
      const links = js.includes('const next =') ? (
        collegePageUrl === jd.listUrl ? [collegeLink('tzgg/2.htm', '下一页', '')] : []
      ) : collegePages.get(collegePageUrl)
      return vm.runInNewContext(js, {
        URL,
        location: new URL(collegePageUrl),
        document: { querySelectorAll: () => links }
      })
    },
    waitFor: async () => ({ okCount: 2, items: [
      { source: 'school', id: '201', title: '全校通知测试' },
      { source: 'news', id: '202', title: '校园新闻测试' }
    ] })
  }
  const coreKeys = ['school:201', 'news:202', 'jwc:101']
  const coreList = await fetchList(collegeEngine, { existingKeys: coreKeys })
  const coreLoads = collegeLoads.splice(0)
  assert.equal(coreLoads.length, 2)
  assert.deepEqual(coreList.items.map(({ source }) => source).sort(), ['jwc', 'news', 'school'])
  const subscribedList = await fetchList(collegeEngine, {
    existingKeys: coreKeys,
    collegeIds: ['jd', 'cl', 'ng', 'jd', 'unknown']
  })
  assert.deepEqual(collegeLoads.splice(0), [...coreLoads, jd.listUrl, jdNext, cl.listUrl, ng.listUrl])
  const jdItems = subscribedList.items.filter(({ source }) => source === 'jd').reverse()
  assert.deepEqual(jdItems.map(({ date, url }) => [date, url]), [
    ['2026-01-02', 'https://jd.haust.edu.cn/info/1001/1.htm'],
    ['2026-02-03', 'https://jd.haust.edu.cn/info/1001/2.htm'],
    ['2026-03-04', 'https://jd.haust.edu.cn/info/1001/3.htm']
  ])
  assert.equal(jdItems[0].sourceName, jd.shortName)
  assert.equal(jdItems[0].dept, jd.fullName)
  const ngItems = subscribedList.items.filter(({ source }) => source === 'ng')
  assert.equal(ngItems.find(({ id }) => id === '4').date, '2026-04-05')
  assert.equal(ngItems.find(({ id }) => id === '1037_5').date, `${new Date().getFullYear()}-05-06`)
  await fetchList(collegeEngine, { existingKeys: [...coreKeys, 'jd:1001_1'], collegeIds: ['jd'] })
  assert.deepEqual(collegeLoads.splice(0), [...coreLoads, jd.listUrl])

  const publicBodyUrl = jdItems[0].url
  const collegeBody = await fetchBody({
    load: async (url) => {
      collegeLoads.push(url)
      return url
    },
    run: async (js) => vm.runInNewContext(js, {
      location: new URL(publicBodyUrl),
      document: {
        body: { innerText: '统一身份认证 学院公告正文' },
        title: '机电工程学院',
        querySelector: () => ({ innerHTML: '学院公告正文', querySelectorAll: () => [], querySelector: () => null }),
        createElement: () => ({ set innerHTML(value) { this.value = value } })
      }
    })
  }, { ...jdItems[0], url: publicBodyUrl.replace('https:', 'http:') })
  assert.deepEqual(collegeLoads, [publicBodyUrl])
  assert.equal(collegeBody.sourceUrl, publicBodyUrl)
  assert.equal(collegeBody.text, '学院公告正文')

  // 7. notices.ts: 校内域名 <-> WebVPN 代理域名双向转换
  assert.equal(
    toWebVpnUrl('http://jwc.haust.edu.cn/info/1001/2026.htm'),
    'https://jwc-haust-edu-cn-s.haust.edu.cn/info/1001/2026.htm'
  )
  assert.equal(
    toWebVpnUrl('https://cl.haust.edu.cn/index/tzgg.htm'),
    'https://cl-haust-edu-cn-s.haust.edu.cn/index/tzgg.htm'
  )
  assert.equal(
    toWebVpnUrl('https://cas.haust.edu.cn/cas/login'),
    'https://cas.haust.edu.cn/cas/login'
  )
  assert.equal(
    toDirectUrl('https://jwc-haust-edu-cn-s.haust.edu.cn/tzgg.htm'),
    'https://jwc.haust.edu.cn/tzgg.htm'
  )
  assert.deepEqual(buildCandidateUrls('https://jwc.haust.edu.cn/tzgg.htm', false), [
    'https://jwc.haust.edu.cn/tzgg.htm',
    'https://jwc-haust-edu-cn-s.haust.edu.cn/tzgg.htm'
  ])

  // 8. notices.ts: 非校园网下教务处直连失败(load-error)自动回退 WebVPN 拉取列表与正文并转换资源链接
  const loadedUrls = []
  const vpnListRes = await fetchList({
    load: async (url) => {
      loadedUrls.push(url)
      if (url.includes('://jwc.haust.edu.cn/') || url.includes('://cl.haust.edu.cn/')) {
        return 'load-error:-2:ERR_CONNECTION_TIMED_OUT'
      }
      return url
    },
    run: async (js) => {
      if (js.includes('__haustPortalNotices')) return 'started'
      if (js.includes("source: 'jwc'")) {
        return JSON.stringify([
          {
            source: 'jwc',
            sourceName: '教务处',
            id: '888',
            title: '关于选课的通知',
            date: '2026-11-22',
            dept: '教务处',
            url: 'http://jwc.haust.edu.cn/info/1001/888.htm'
          }
        ])
      }
      return JSON.stringify([])
    },
    waitFor: async () => JSON.stringify({ done: true, okCount: 0, items: [] })
  })
  assert.ok(loadedUrls.includes('https://jwc-haust-edu-cn-s.haust.edu.cn/tzgg.htm'))
  assert.equal(vpnListRes.items.length, 1)

  let bodyReferer = ''
  const vpnBodyRes = await fetchBody(
    {
      load: async (url, _timeout, referer) => {
        if (url.includes('://jwc.haust.edu.cn/')) return 'load-error:-2:ERR_CONNECTION_TIMED_OUT'
        bodyReferer = referer || ''
        return url
      },
      run: async () =>
        JSON.stringify({
          title: '关于选课的通知',
          text: '请按时完成选课。',
          imgs: ['http://jwc.haust.edu.cn/_upload/a.png'],
          attachments: [{ name: '选课手册.pdf', url: 'https://jwc.haust.edu.cn/_upload/guide.pdf' }],
          date: '2026-11-22',
          url: 'https://jwc-haust-edu-cn-s.haust.edu.cn/info/1001/888.htm',
          pageType: 'article',
          articleMatch: true
        })
    },
    {
      source: 'jwc',
      sourceName: '教务处',
      id: '888',
      title: '关于选课的通知',
      date: '2026-11-22',
      dept: '教务处',
      url: 'http://jwc.haust.edu.cn/info/1001/888.htm'
    }
  )
  assert.equal(vpnBodyRes.failure, undefined)
  assert.equal(bodyReferer, 'https://jwc-haust-edu-cn-s.haust.edu.cn/tzgg.htm')
  assert.equal(vpnBodyRes.imgs[0], 'https://jwc-haust-edu-cn-s.haust.edu.cn/_upload/a.png')
  assert.equal(vpnBodyRes.attachments[0].url, 'https://jwc-haust-edu-cn-s.haust.edu.cn/_upload/guide.pdf')

  // 9. aircon-session.mjs: 显式透传 Set-Cookie: JSESSIONID 与移动端请求头
  const airconCalls = []
  const airconSession = createCloudPaymentSession(async (url, headers) => {
    airconCalls.push({ url, headers })
    if (url.includes('selectPayProject.do')) {
      assert.ok(url.includes('payProId=4620'))
      return {
        status: 200,
        data: '<html>ok</html>',
        location: '',
        setCookies: ['JSESSIONID=TEST_SID_123; Path=/CloudPayment; HttpOnly']
      }
    }
    assert.equal(headers.Cookie, 'JSESSIONID=TEST_SID_123')
    assert.equal(headers['X-Requested-With'], 'XMLHttpRequest')
    assert.ok(headers.Referer && headers.Referer.includes('selectPayProject.do'))
    assert.ok(headers['User-Agent'] && headers['User-Agent'].includes('SuperApp'))
    if (url.includes('checkRoomCount.do')) {
      return { status: 200, data: '{"code":"SUCCESS"}', location: '', setCookies: [] }
    }
    return { status: 200, data: '{"returncode":"100","quantity":"42.5","quantityunit":"度"}', location: '', setCookies: [] }
  })
  const airconRes = await airconSession(
    'https://h5cloud.17wanxiao.com:18443/CloudPayment/user/getRoomState.do?payProId=4620&schoolcode=1007&businesstype=2&roomverify=12345'
  )
  assert.equal(airconRes.status, 200)
  assert.equal(airconCalls.length, 3)

  // 10. aircon-session.mjs: 直连无 Set-Cookie 时走 bootstrapBrowser 并透传失败阶段与状态码
  const failedSession = createCloudPaymentSession(
    async () => ({ status: 502, data: 'Bad Gateway', location: '', setCookies: [] }),
    async () => ({ cookies: '', mode: 'default-cookie-backup', httpStatus: 502, error: 'HTTP 502' })
  )
  const failedRes = await failedSession(
    'https://h5cloud.17wanxiao.com:18443/CloudPayment/user/getRoom.do?payProId=4620&schoolcode=1007&businesstype=2&optype=2&areaid=1&buildid=0&unitid=0&levelid=0'
  )
  assert.equal(failedRes.status, 502)
  assert.ok(String(failedRes.data?.msg || '').includes('selectPayProject HTTP 502'))
  assert.ok(String(failedRes.data?.msg || '').includes('default-cookie-backup'))

  // 11. aircon-session.mjs: 直连 TLS 重置抛出异常时自动回退 webViewFallback 并成功返回
  let webViewCalled = false
  const fallbackSession = createCloudPaymentSession(
    async () => {
      throw new Error('ECONNRESET')
    },
    async () => ({ cookies: '', mode: 'default-cookie-backup', error: 'timeout' }),
    async (_project, _activate, targetUrl) => {
      webViewCalled = true
      assert.ok(targetUrl.includes('getRoomState.do'))
      return { status: 200, data: '{"returncode":"100","quantity":"33.8","quantityunit":"度"}' }
    }
  )
  const fallbackRes = await fallbackSession(
    'https://h5cloud.17wanxiao.com:18443/CloudPayment/user/getRoomState.do?payProId=4620&schoolcode=1007&businesstype=2&roomverify=12345'
  )
  assert.equal(webViewCalled, true)
  assert.equal(fallbackRes.status, 200)
  assert.ok(String(fallbackRes.data).includes('33.8'))

  // 12. notices.ts: 全校通知落地到 CAS 登录页时标记 portalAuthRequired=true
  const authListRes = await fetchList({
    load: async (url) => {
      if (url.includes('i-haust-edu-cn-s')) return 'https://cas.haust.edu.cn/cas/login?service=https://vpn.haust.edu.cn/'
      return url
    },
    run: async (js) => {
      if (js.includes("source: 'jwc'")) {
        return JSON.stringify([
          { source: 'jwc', sourceName: '教务处', id: '999', title: '测试通知', date: '2026-11-24', dept: '教务处', url: 'https://jwc.haust.edu.cn/info/999.htm' }
        ])
      }
      return JSON.stringify([])
    },
    waitFor: async () => ''
  })
  assert.equal(authListRes.portalAuthRequired, true)
  assert.equal(authListRes.items.length, 1)

  // 13. aircon-session.mjs: 已认证 SESSION Cookie 引导 + 未保存凭据返回 401 引导
  const noCredSession = createCloudPaymentSession(
    async () => {
      throw new Error('should not hit network when credential is missing')
    },
    async () => ({ cookies: '', error: 'NO_SAVED_CREDENTIAL' })
  )
  const noCredRes = await noCredSession(
    'https://h5cloud.17wanxiao.com:18443/CloudPayment/user/getRoomState.do?payProId=4620&schoolcode=1007&businesstype=2&roomverify=12345'
  )
  assert.equal(noCredRes.status, 401)
  assert.ok(String(noCredRes.data?.msg || '').includes('保存密码'))

  const authSessionCalls = []
  const authSession = createCloudPaymentSession(
    async (url, headers) => {
      authSessionCalls.push({ url, headers })
      assert.equal(headers.Cookie, 'SESSION=AUTH_UUID_999')
      if (url.includes('selectPayProject.do')) {
        return { status: 200, data: '<html>ok</html>', location: '', setCookies: [] }
      }
      return { status: 200, data: '{"returncode":"100","quantity":"18.6","quantityunit":"度"}', location: '', setCookies: [] }
    },
    async () => ({ cookies: 'SESSION=AUTH_UUID_999', mode: 'auth-multi-profile' })
  )
  const authAirconRes = await authSession(
    'https://h5cloud.17wanxiao.com:18443/CloudPayment/user/getRoomState.do?payProId=4620&schoolcode=1007&businesstype=2&roomverify=12345'
  )
  assert.equal(authAirconRes.status, 200)
  assert.equal(authSessionCalls.length, 2)

  // 14. notice-db.ts: 双网 ID 归一化（校内直连与 WebVPN 代理产出完全相同的主键）
  const kDirect = normalizeNoticeKey({
    source: 'jwc',
    id: '5678',
    title: '期末考试安排',
    url: 'https://jwc.haust.edu.cn/info/1024/5678.htm'
  })
  const kVpn = normalizeNoticeKey({
    source: 'jwc',
    id: '5678',
    title: '期末考试安排',
    url: 'https://jwc-haust-edu-cn-s.haust.edu.cn/content.jsp?wbtreeid=1024&wbnewsid=5678'
  })
  assert.equal(kDirect, 'jwc:1024_5678')
  assert.equal(kVpn, 'jwc:1024_5678')

  // 15. notice-db.ts: 首次建库最多 3 页；日常刷新仅第 1 页且置顶历史通知不会误截断新通知
  const makeNotice = (id, date) => ({
    source: 'jwc',
    sourceName: '教务处',
    id: String(id),
    title: `通知 ${id}`,
    date,
    dept: '教务处',
    url: `https://jwc.haust.edu.cn/info/1024/${id}.htm`
  })
  const initPlan = collectIncrementalPages(
    [
      [makeNotice(101, '2026-11-24')],
      [makeNotice(102, '2026-11-23')],
      [makeNotice(103, '2026-11-22')],
      [makeNotice(104, '2026-11-21')]
    ],
    new Set(),
    3
  )
  assert.equal(initPlan.pagesProcessed, 3)
  assert.equal(initPlan.newItems.length, 3)

  const dailyPlan = collectIncrementalPages(
    [
      // 第 0 条是历史置顶，第 1 条是新通知，第 2 条是已缓存旧通知
      [makeNotice(101, '2026-10-01'), makeNotice(201, '2026-11-25'), makeNotice(102, '2026-11-23')],
      [makeNotice(202, '2026-11-20')]
    ],
    new Set(['jwc:1024_101', 'jwc:1024_102']),
    3
  )
  assert.equal(dailyPlan.pagesProcessed, 1)
  assert.equal(dailyPlan.hitExisting, true)
  assert.deepEqual(dailyPlan.newItems.map((n) => n.id), ['1024_201'])

  // 16. notice-db.ts + notices.ts: 全部源重定向到 CAS 登录时抛出 WebVpnAuthError，正文缓存可离线直读
  await assert.rejects(
    () =>
      fetchList({
        load: async () => 'https://cas.haust.edu.cn/cas/login?service=https://vpn.haust.edu.cn/',
        run: async () => '',
        waitFor: async () => ''
      }),
    (err) => err instanceof WebVpnAuthError && err.code === 'WEBVPN_AUTH_REQUIRED'
  )

  const savedItem = makeNotice(301, '2026-11-25')
  await upsertNotices([savedItem])
  await saveNoticeBody(savedItem, { title: '通知 301', text: '离线正文内容', date: '2026-11-25' })
  const offlineBody = await getCachedNoticeBody({
    ...savedItem,
    url: 'https://jwc-haust-edu-cn-s.haust.edu.cn/info/1024/301.htm'
  })
  assert.equal(offlineBody?.text, '离线正文内容')

  // 17. chaoxing.ts: 登录页识别、剩余时间解析与待办汇总排序
  assert.equal(isChaoxingLoginUrl('https://passport2.chaoxing.com/login?fid=&newversion=true'), true)
  assert.equal(isChaoxingLoginUrl('https://mooc1-api.chaoxing.com/work/stu-work'), false)
  assert.equal(parseLeftTimeMinutes('剩余271小时7分钟'), 271 * 60 + 7)
  assert.equal(parseLeftTimeMinutes('剩余3天2小时'), 3 * 1440 + 2 * 60)
  assert.equal(parseLeftTimeMinutes('剩余45分钟'), 45)
  assert.equal(parseLeftTimeMinutes('已截止'), null)

  const todos = buildChaoxingTodos(
    [
      { workId: 'w1', courseId: 'c1', clazzId: 'z1', title: '作业A', course: '高数', leftTime: '剩余10小时', status: '待提交', uncommitted: true, url: 'https://mooc1-api.chaoxing.com/work/1' },
      { workId: 'w2', courseId: 'c1', clazzId: 'z1', title: '作业B', course: '高数', leftTime: '', status: '已提交', uncommitted: false, url: 'https://mooc1-api.chaoxing.com/work/2' }
    ],
    [
      { examId: 'e1', courseId: 'c2', classId: 'z2', title: '考试A', course: '线代', timeLeft: '剩余2小时', status: '进行中', finished: false, expired: false, url: 'https://mooc1-api.chaoxing.com/exam/1' },
      { examId: 'e2', courseId: 'c2', classId: 'z2', title: '考试B', course: '线代', timeLeft: '', status: '已完成', finished: true, expired: false, url: 'https://mooc1-api.chaoxing.com/exam/2' }
    ]
  )
  assert.equal(todos.length, 2)
  assert.equal(todos[0].title, '考试A')
  assert.equal(todos[0].urgent, true)
  assert.equal(todos[1].title, '作业A')

  // 18. chaoxing.ts: 重定向到超星登录页时优雅返回 authRequired=true
  const cxAuth = await fetchChaoxingDashboard({
    load: async () => 'https://passport2.chaoxing.com/login?fid=&newversion=true',
    run: async () => {
      throw new Error('should not run on login page')
    }
  })
  assert.equal(cxAuth.loggedIn, false)
  assert.equal(cxAuth.authRequired, true)

  // 19. Preserve primary exams and merge distinct rows from the table.
  const primary = { ...todos[0], course: '' }
  const named = { ...primary, examId: '', title: '无编号考试' }
  const extra = { ...primary, examId: 'e3', title: '补充考试' }
  const merged = mergeChaoxingExams(
    [primary, named], [{ ...primary, course: '线代', finished: true }, { ...named }, extra]
  )
  assert.deepEqual(merged.map(({ title }) => title), ['考试A', '无编号考试', '补充考试'])
  assert.equal(merged[0].course, '线代')
  assert.equal(merged[0].finished, false)
  assert.equal(primary.course, '')

  // 20. Parse class identities, skip unrelated channels, and deduplicate by course and class.
  const courseChannel = (id, name = ' Linear Algebra ') => ({
    cataid: '100000002',
    content: { clazz: { data: [{ id }] }, cpi: 42, enc: 'example', course: {
      data: [{ id: 12, name, teacherfactor: '张老师' }]
    } }
  })
  const rawCourses = { channelList: [courseChannel(7), courseChannel(7), courseChannel(8, '高等数学'),
    { ...courseChannel(9), cataid: 'other' }, { cataid: '100000002' }, null] }
  const courses = parseCourseListJson(rawCourses)
  assert.deepEqual(courses, [
    { courseId: '12', clazzId: '7', cpi: '42', enc: 'example', pEnc: undefined, courseName: 'Linear Algebra', teacherName: '张老师' },
    { courseId: '12', clazzId: '8', cpi: '42', enc: 'example', pEnc: undefined, courseName: '高等数学', teacherName: '张老师' }
  ])
  assert.deepEqual(parseCourseListJson(null), [])

  // 21. Match normalized names exactly, leaving unknown and similarly named courses visible.
  assert.deepEqual(filterByIgnoredCourses(
    [' Linear Algebra ', 'Linear Algebra II', '', '高等数学'], [' linear ALGEBRA ', '  '], (name) => name
  ), ['Linear Algebra II', '', '高等数学'])

  // 22. Exercise the Android course loaders with the same load/evaluate contract as SchoolBrowser.
  const requests = []
  let response
  const courseEngine = {
    load: async (url) => (requests.push(url), url),
    run: async (js) => {
      const target = /fetch\((".*?"),/.exec(js)?.[1]
      if (target) {
        const url = JSON.parse(target)
        requests.push(url)
        response = url.includes('backclazzdata') ? rawCourses : {
          data: { activeList: [{ id: 1, nameOne: '课堂签到', activeType: 2, status: 1 }] }
        }
        return true
      }
      if (js.includes('__haustCourseFetch')) return JSON.stringify({ data: response })
      return JSON.stringify({ counts: ['7', '12'], login: false })
    }
  }
  const activities = await fetchChaoxingActivities(courseEngine, ['linear algebra'], 0)
  assert.equal(activities.activities[0].type, '签到')
  assert.equal(activities.activities[0].ongoing, true)
  assert.equal(activities.courses.length, 2)
  assert.equal(requests.filter((url) => url.includes('activelist')).length, 1)
  assert.ok(requests.some((url) => url.includes('classId=8')))
  const progress = await fetchChaoxingProgress(courseEngine, ['高等数学'], 0)
  assert.equal(progress.progress[0].percent, 58)
  assert.equal(requests.filter((url) => url.includes('/study-data/index')).length, 1)

  // 23. auth-flow.ts: 错误文案分类与分级风控判定（图形验证码 vs 滑块复杂风控）
  assert.equal(classifyAuthError('用户名或密码错误，请重试')?.reason, 'credentials')
  assert.equal(classifyAuthError('该账号已被锁定，请10分钟后再试')?.reason, 'locked')
  assert.equal(classifyAuthError('短信验证码已过期')?.reason, 'sms_code')
  assert.equal(classifyAuthError('图形验证码输入有误')?.reason, 'captcha')
  assert.equal(classifyAuthRisk({ captcha: true, image: true }), 'image')
  assert.equal(classifyAuthRisk({ complex: true, captcha: true, image: true }), 'complex')
  assert.equal(classifyAuthRisk({ text: '请拖动滑块完成拼图验证' }), 'complex')
  assert.equal(classifyAuthRisk({ text: '请输入手机号和密码' }), 'none')

  // 24. chaoxing-auth.ts: 登录目标页与二维码状态判定
  assert.equal(isChaoxingDestination('https://i.chaoxing.com/base'), true)
  assert.equal(isChaoxingDestination('https://passport2.chaoxing.com/login'), false)
  assert.equal(isChaoxingDestination('https://mooc1.chaoxing.com/verify/slider'), false)
  assert.equal(classifyChaoxingQrStatus('https://passport2.chaoxing.com/login', '请使用学习通扫码'), 'waiting')
  assert.equal(classifyChaoxingQrStatus('https://passport2.chaoxing.com/login', '已扫码，请在学习通确认'), 'scanned')
  assert.equal(classifyChaoxingQrStatus('https://passport2.chaoxing.com/login', '二维码已过期，请刷新二维码'), 'expired')
  assert.equal(classifyChaoxingQrStatus('https://i.chaoxing.com/base', ''), 'confirmed')

  // 25. chaoxing-auth.ts: 仅记住学习通账号，绝不落盘密码
  const mem = new Map()
  const mockStorage = {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => mem.set(k, v)
  }
  rememberChaoxingAccount(mockStorage, ' 13800138000 ')
  assert.equal(readChaoxingAccount(mockStorage), '13800138000')
  assert.deepEqual([...mem.keys()], [CHAOXING_LAST_ACCOUNT_KEY])

  // 26. authPageScript 真实超星 DOM 回归：密码(#phone/#pwd/#loginBtn)、短信(#phone/#sendCodeBtn/#vercode/#loginBtn)、二维码(img#quickCode)
  class MockInput {
    constructor(id, type = 'text', extra = {}) {
      this.id = id
      this.type = type
      this.name = extra.name || ''
      this.placeholder = extra.placeholder || ''
      this.events = []
      this._v = ''
    }
    get value() { return this._v }
    set value(v) { this._v = v }
    closest() { return null }
    getAttribute() { return null }
    getClientRects() { return [{}] }
    dispatchEvent(e) { this.events.push(e.type) }
  }
  const cxPhone = new MockInput('phone', 'text', { placeholder: '手机号/超星号' })
  const cxPwd = new MockInput('pwd', 'password', { placeholder: '学习通密码' })
  const cxVercode = new MockInput('vercode', 'text', { placeholder: '验证码' })
  const cxClicks = []
  const mkBtn = (label) => ({
    innerText: label,
    getClientRects: () => [{}],
    closest: () => null,
    getAttribute: () => null,
    click: () => cxClicks.push([label, cxPhone.value, cxPwd.value, cxVercode.value])
  })
  const cxLoginBtn = mkBtn('登录')
  const cxSendBtn = mkBtn('获取验证码')
  const cxQrImg = {
    id: 'quickCode',
    src: 'data:image/png;base64,iVBORw0KGgo=',
    complete: true,
    naturalWidth: 180,
    naturalHeight: 180,
    clientWidth: 180,
    clientHeight: 180,
    closest: (sel) => (sel.includes('hidden') ? null : {}),
    getAttribute: (k) => (k === 'src' ? '/createqr?uuid=abc&fid=-1' : null),
    getClientRects: () => [{}]
  }
  const runCxDom = (mode, command, fields = {}, scanQr = false) =>
    vm.runInNewContext(authPageScript(false, command, fields, scanQr), {
      location: { protocol: 'https:', hostname: 'passport2.chaoxing.com', pathname: '/login' },
      document: {
        body: { innerText: '使用学习通APP扫码登录' },
        querySelectorAll: (sel) => {
          if (sel === 'input') return mode === 'sms' ? [cxPhone, cxVercode] : [cxPhone, cxPwd]
          if (sel === '#phone') return [cxPhone]
          if (sel === '#vercode') return mode === 'sms' ? [cxVercode] : []
          if (sel === '#loginBtn') return [cxLoginBtn]
          if (sel === '#sendCodeBtn') return mode === 'sms' ? [cxSendBtn] : []
          if (sel.includes('img#quickCode')) return [cxQrImg]
          return []
        }
      },
      getComputedStyle: () => ({ visibility: 'visible' }),
      HTMLInputElement: MockInput,
      HTMLCanvasElement: class {},
      Event
    })
  assert.equal(runCxDom('password', 'password', { account: '13800001111', password: 'secret' }), 'submitted')
  assert.deepEqual(cxClicks[0], ['登录', '13800001111', 'secret', ''])
  assert.equal(runCxDom('sms', 'sms_send', { account: '13900002222' }), 'submitted')
  assert.deepEqual(cxClicks[1], ['获取验证码', '13900002222', 'secret', ''])
  const smsInspect = JSON.parse(runCxDom('sms', 'inspect'))
  assert.equal(smsInspect.captcha, false)
  assert.equal(runCxDom('sms', 'sms_submit', { code: '654321' }), 'submitted')
  assert.equal(cxClicks[2][3], '654321')
  const qrInspect = JSON.parse(runCxDom('password', 'inspect', {}, true))
  assert.equal(qrInspect.qr, 'data:image/png;base64,iVBORw0KGgo=')
  assert.equal(qrInspect.qrVisible, true)

  // 27. driveChaoxingAuth: 开启 desktopUa、正常提取二维码并在跳转 https://i.chaoxing.com/base 后收窗成功
  let openedOpts = null
  let closedCount = 0
  let step = 0
  const qrEvents = []
  await driveChaoxingAuth(
    {
      open: async (opts) => ((openedOpts = opts), { shown: true }),
      isOpen: async () => ({ open: true }),
      currentUrl: async () => ({
        url: ++step >= 2 ? 'https://i.chaoxing.com/base?ws=1' : 'https://passport2.chaoxing.com/login?newversion=true'
      }),
      reveal: async () => ({ revealed: true }),
      conceal: async () => ({ concealed: true }),
      close: async () => { closedCount += 1 }
    },
    async () =>
      JSON.stringify({
        text: '使用学习通APP扫码登录',
        error: '',
        complex: false,
        captcha: false,
        image: false,
        qr: 'data:image/png;base64,iVBORw0KGgo=',
        qrVisible: true,
        qrText: '使用学习通APP扫码登录',
        smsSent: false
      }),
    { platform: 'chaoxing', mode: 'qr' },
    {
      signal: new AbortController().signal,
      onProgress: (ev) => { if (ev.type === 'qr') qrEvents.push(ev.status) }
    }
  )
  assert.equal(openedOpts?.silent, true)
  assert.equal(openedOpts?.desktopUa, true)
  assert.deepEqual(qrEvents, ['waiting', 'confirmed'])
  assert.equal(closedCount, 1)

  // 28. updater.ts: SemVer 比较与同版本正式版升级提示（0.2.0 > 0.2.0-beta.2 > 0.2.0-beta.1）
  assert.ok(compareSemver('0.2.0', '0.2.0-beta.2') > 0)
  assert.ok(compareSemver('0.2.0-beta.2', '0.2.0-beta.1') > 0)
  assert.equal(compareSemver('0.2.0', 'v0.2.0'), 0)

  const sampleManifest = {
    stable: { versionCode: 20, versionName: '0.2.0', channel: 'stable', apkUrl: 'https://github.com/a/b/releases/download/v0.2.0/app.apk', sha256: 'aaa', notes: 'stable' },
    beta: { versionCode: 21, versionName: '0.2.1-beta.1', channel: 'beta', apkUrl: 'https://github.com/a/b/releases/download/v0.2.1-beta.1/app.apk', sha256: 'bbb', notes: 'beta' }
  }
  // 关闭 Beta：仅收正式版
  assert.equal(pickBestRelease(sampleManifest, { versionCode: 11, versionName: '0.1.10' }, false)?.versionName, '0.2.0')
  // 开启 Beta：收更高的 Beta 版
  assert.equal(pickBestRelease(sampleManifest, { versionCode: 11, versionName: '0.1.10' }, true)?.versionName, '0.2.1-beta.1')
  // 同版本正式版发布时，Beta 用户也会收到正式版升级提示
  const sameVerManifest = {
    stable: { versionCode: 20, versionName: '0.2.0', channel: 'stable', apkUrl: 'https://github.com/a/b/releases/download/v0.2.0/app.apk', sha256: 'aaa', notes: 'stable' },
    beta: { versionCode: 19, versionName: '0.2.0-beta.2', channel: 'beta', apkUrl: 'https://github.com/a/b/releases/download/v0.2.0-beta.2/app.apk', sha256: 'bbb', notes: 'beta' }
  }
  assert.equal(pickBestRelease(sameVerManifest, { versionCode: 19, versionName: '0.2.0-beta.2' }, true)?.versionName, '0.2.0')

  // 29. update-config.ts: 占位仓库检测与多路镜像回退 URL 构造
  assert.equal(isUpdateRepoConfigured('YOUR_GITHUB_USER/kexiaomiao-releases'), false)
  assert.equal(isUpdateRepoConfigured('alice/kexiaomiao-releases'), true)
  const manifestUrls = buildManifestUrls('alice/kexiaomiao-releases', 'main', 123456)
  assert.ok(manifestUrls.length >= 4)
  assert.ok(manifestUrls[0].includes('raw.githubusercontent.com') && manifestUrls[0].includes('t=123456'))
  assert.ok(manifestUrls[manifestUrls.length - 1].startsWith('https://cdn.jsdelivr.net/'))
  const apkUrls = buildApkDownloadUrls('https://github.com/alice/kexiaomiao-releases/releases/download/v0.2.0/app.apk')
  assert.ok(apkUrls.length >= 4)
  assert.equal(apkUrls[apkUrls.length - 1], 'https://github.com/alice/kexiaomiao-releases/releases/download/v0.2.0/app.apk')

  // 30. updater.ts: 每天首次打开应用自动检查节流
  assert.equal(shouldAutoCheckToday({ autoCheck: true, includeBeta: false, lastAutoCheckDay: '2026-11-23', ignoredVersion: '' }, new Date('2026-11-24T09:00:00')), true)
  assert.equal(shouldAutoCheckToday({ autoCheck: true, includeBeta: false, lastAutoCheckDay: '2026-11-24', ignoredVersion: '' }, new Date('2026-11-24T21:00:00')), false)
  assert.equal(shouldAutoCheckToday({ autoCheck: false, includeBeta: false, lastAutoCheckDay: '', ignoredVersion: '' }, new Date('2026-11-24T09:00:00')), false)

  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const snapshotStorage = new Map()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (key) => snapshotStorage.get(key) ?? null }
  })
  try {
    const expired = { loggedIn: false, authRequired: true, works: [{ title: '作业A' }], exams: [] }
    const legacy = { loggedIn: true, works: [], exams: [] }
    snapshotStorage.set('haust.cache.chaoxing', JSON.stringify(expired))
    snapshotStorage.set('haust.cache.v1.chaoxing', JSON.stringify(legacy))
    assert.deepEqual(readChaoxingSnapshot(), { ...expired, loggedIn: true, stale: true })
    snapshotStorage.delete('haust.cache.chaoxing')
    assert.deepEqual(readChaoxingSnapshot(), { ...legacy, stale: true })
    snapshotStorage.clear()
    assert.equal(readChaoxingSnapshot(), null)
    assert.equal(hasExistingUserConfig(), false)
    snapshotStorage.set('haust.cache.session', JSON.stringify({ loggedIn: true }))
    assert.equal(hasExistingUserConfig(), true)
    snapshotStorage.set('haust.cache.session', JSON.stringify({ loggedIn: false }))
    snapshotStorage.set('haust.cache.courses', JSON.stringify({ courses: [{ name: '高数' }] }))
    assert.equal(hasExistingUserConfig(), true)
  } finally {
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor)
    else delete globalThis.localStorage
  }

  console.log('ALL OFFLINE UNIT TESTS PASSED')
}

runTests().catch((err) => {
  console.error(err)
  process.exit(1)
})
