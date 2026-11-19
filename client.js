window.__ModuleLoader__.load({
  id: 'dsh-keep-awake',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const BASE = '/keep-awake'

    /** Locale dictionaries for the small window. */
    const DICT = {
      en: {
        title: 'Keep awake',
        'status.active': 'Holding',
        'status.waiting': 'Waiting',
        'status.off': 'Off',
        'status.unsupported': 'Unsupported',
        'switch.label': 'Stay awake with the lid closed',
        'switch.hint': 'Holds a Windows system power request, so the Harness and background apps keep running instead of entering Modern Standby.',
        'mode.label': 'When to hold',
        'mode.always': 'Always',
        'mode.always.hint': 'Hold until you switch it off.',
        'mode.apps': 'While selected apps run',
        'mode.apps.hint': 'Hold only while one of the apps below is running.',
        'mode.busy': 'While DSH is working',
        'mode.busy.hint': 'Hold only while a session is running a turn.',
        'watch.label': 'Background apps',
        'watch.hint': 'The power request is machine-wide: ticking an app decides when the machine stays awake, so that app (and everything else) keeps running.',
        'watch.empty': 'No app selected yet.',
        'watch.running': 'running',
        'watch.idle': 'not running',
        'watch.remove': 'Remove',
        'watch.placeholder': 'Process name, e.g. vmware-vmx',
        'watch.add': 'Add',
        'watch.pick': 'Pick a running app…',
        'watch.noApps': 'No running app matched.',
        'advanced': 'Advanced',
        'advanced.lid': 'Lid-close action',
        'advanced.lidValue': 'AC {ac} · battery {dc}',
        'advanced.fix': 'Set to “do nothing”',
        'advanced.revert': 'Restore previous action',
        'advanced.sleep': 'Sleep after',
        'advanced.sleepValue': 'AC {ac} · battery {dc}',
        'advanced.sleepNever': 'never',
        'advanced.sleepHeld': 'set to “never” while keeping awake — Windows ends power requests 5 min after a battery sleep timeout',
        'advanced.sleepHint': 'On Modern Standby hardware running on battery, Windows terminates every power request 5 minutes after the sleep timeout expires, so a finite value puts the machine to sleep even while keep-awake holds. The plugin therefore writes “never” while it holds, and puts your own values back when it stops.',
        'advanced.sleepRevert': 'Restore my sleep timeout',
        'advanced.displayBattery': 'On battery the display also stays on: Modern Standby starts the moment it turns off, and a power request can only delay that by five minutes.',
        'advanced.minutes': 'min',
        'advanced.hours': 'h',
        'advanced.modern': 'Modern Standby',
        'advanced.modernOn': 'on — a closed lid forces standby, whatever the action above says',
        'advanced.modernOff': 'off — a closed lid no longer sleeps the machine',
        'advanced.modernPending': 'written, waiting for a reboot',
        'advanced.modernFix': 'Switch Modern Standby off (admin, reboot)',
        'advanced.modernRestore': 'Restore the saved Modern Standby setting',
        'advanced.modernHint': 'The only switch Windows honours on builds that ignore “do nothing”. Takes effect after a reboot; while off, the machine has no sleep at all on this hardware.',
        'advanced.display': 'Also keep the display awake',
        'advanced.displayHint': 'Rarely needed by hand: the plugin turns it on by itself if its self-check catches Windows entering Modern Standby during a hold (system-only 0x80000001 → system + display 0x80000003).',
        'advanced.grace': 'Grace after work ends',
        'advanced.graceHint': 'Keep holding this long after DSH goes idle, so a background job or a trailing file write is not cut off. 0 releases at once.',
        'advanced.seconds': 's',
        'advanced.helper': 'Silent lid switch',
        'advanced.helperOn': 'ready — lid changes no longer ask for permission',
        'advanced.helperOff': 'not installed — switching asks once for permission',
        'advanced.helperInstall': 'Install (admin)',
        'advanced.helperRemove': 'Remove',
        'advanced.cleanup': 'Leave no trace',
        'advanced.cleanupHint': 'Switches keep-awake off, puts the lid action and both timeouts back, removes the silent helper task and its files, and restores Modern Standby if this plugin turned it off. Do this before uninstalling.',
        'advanced.cleanupAction': 'Restore & clean up',
        'notice.cleaned': 'All power settings restored; the silent helper was removed.',
        'notice.cleanedPartial': 'Settings restored, but the helper task could not be removed without permission.',
        'battery.label': 'Battery guard',
        'battery.hint': 'On battery power, keep-awake stops at or below this level and the lid action returns to sleep — without asking for permission.',
        'battery.min': '0 turns it off.',
        'battery.fixed': 'Battery guard set to {floor}%.',
        'alert.autoStop': 'Battery reached {percent}%, so keep-awake stopped automatically.',
        'alert.autoStopLid': 'The lid action could not be restored without a prompt — restore lid sleep below.',
        'alert.dismiss': 'Dismiss',
        'notice.helperInstalled': 'Silent lid switch installed.',
        'notice.helperRemoved': 'Silent lid switch removed.',
        'notice.graceSet': 'Grace period set to {seconds}s.',
        'advanced.diag': 'Show diagnostics',
        'advanced.keeper': 'Power request: {state}',
        'advanced.hideDiag': 'Hide diagnostics',
        'lid.0': 'do nothing',
        'lid.1': 'sleep',
        'lid.2': 'hibernate',
        'lid.3': 'shut down',
        'lid.default': 'system default',
        'power.ac': 'Plugged in',
        'power.battery': 'Battery {percent}%',
        'power.unknown': 'Power state unknown',
        'hold.since': 'held {duration}',
        'hold.heartbeat': 'last heartbeat {time}',
        'hold.none': 'not holding',
        'error.host': 'Host unreachable — is the plugin enabled?',
        'busy': 'Working…',
        'notice.added': 'Added {name}',
        'notice.removed': 'Removed {name}',
        'notice.lidFixed': 'Lid-close action is now “do nothing” on AC and battery.',
        'notice.lidReverted': 'Lid-close action restored.',
        'notice.sleepReverted': 'Sleep timeout restored.',
        'notice.modernFixed': 'Modern Standby is off in the registry — reboot to make it real.',
        'notice.modernRestored': 'Modern Standby setting restored — reboot to make it real.',
        'notice.enabled': 'Keeping awake.',
        'notice.disabled': 'Power request released.',
        'notice.lidDenied': 'Administrator permission was cancelled — the lid-close action is unchanged.',
        'notice.lidHelperNeeded': 'Silent lid switch is not installed yet — open Advanced and install it once; switching stays instant afterwards.',
        'switch.lidHint': 'Switching on sets “do nothing” for lid close and “never” for the sleep timeout, so Windows cannot put the machine to sleep under the request; switching off puts your own values back.',
        'hero.floor': 'stops under {floor}%',
        'hero.apps': '{count} watched',
        'hero.grace': 'grace {seconds}s',
        'alert.lidLeftOn': 'The lid-close action is still “do nothing”, so closing the lid no longer sleeps or locks the machine.',
        'alert.lidRestore': 'Restore lid sleep',
        'alert.sleepLeftOn': 'The sleep timeout is still “never”, so the machine will not sleep when idle.',
        'alert.sleepRestore': 'Restore sleep timeout',
        'alert.escalated': 'Windows entered Modern Standby while keep-awake was holding ({reason}, {time}).',
        'alert.escalatedDisplay': 'The power request was upgraded from system-only (0x80000001) to system + display (0x80000003), so the screen stays on and Modern Standby cannot start.',
        'alert.escalatedModern': 'That was not enough either — switching Modern Standby off is the last lever on this hardware (admin, reboot).',
        'alert.escalatedReset': 'Use the plain request again',
        'notice.escalationReset': 'Back to the plain power request.',
        'footer.note': 'Stops when off.',
        'close': 'Close',
        'minimize': 'Minimize',
        'open': 'Open the keep-awake window',
        'unsupported': 'This machine cannot hold a Windows power request, so the switch stays off.',
        'diag.copy': 'Copy',
        'diag.copied': 'Copied',
      },
      zh: {
        title: '合盖保活',
        'status.active': '保活中',
        'status.waiting': '等待中',
        'status.off': '已关闭',
        'status.unsupported': '不可用',
        'switch.label': '合盖时保持运行',
        'switch.hint': '向 Windows 申请系统级电源请求，宿主与后台应用继续运行，而不是进入「现代待机」。',
        'mode.label': '何时保活',
        'mode.always': '一直',
        'mode.always.hint': '开启后一直保持，直到你关掉。',
        'mode.apps': '选中应用运行时',
        'mode.apps.hint': '只在下面某个应用正在运行时保活。',
        'mode.busy': 'DSH 工作时',
        'mode.busy.hint': '只在某个会话正在跑任务时保活。',
        'watch.label': '后台应用',
        'watch.hint': '电源请求是整机级别的：勾选应用决定「什么时候保活」，保活期间这个应用（以及其它所有程序）都会继续跑。',
        'watch.empty': '还没有选择应用。',
        'watch.running': '运行中',
        'watch.idle': '未运行',
        'watch.remove': '移除',
        'watch.placeholder': '进程名，例如 vmware-vmx',
        'watch.add': '添加',
        'watch.pick': '从运行中的应用选择…',
        'watch.noApps': '没有匹配的运行中应用。',
        'advanced': '高级',
        'advanced.lid': '合盖动作',
        'advanced.lidValue': '交流 {ac} · 电池 {dc}',
        'advanced.fix': '改为「不采取任何操作」',
        'advanced.revert': '恢复原来的合盖动作',
        'advanced.sleep': '睡眠超时',
        'advanced.sleepValue': '交流 {ac} · 电池 {dc}',
        'advanced.sleepNever': '从不',
        'advanced.sleepHeld': '保活期间已设为「从不」——电池上 Windows 会在睡眠超时后 5 分钟终止电源请求',
        'advanced.sleepHint': '在这类「现代待机」机器上，用电池时 Windows 会在睡眠超时到期 5 分钟后终止所有电源请求，所以只要睡眠超时是个具体时间，保活也拦不住它入睡。插件因此在保活期间把睡眠超时写成「从不」，停止保活后再把你原来的值放回去。',
        'advanced.sleepRevert': '恢复我的睡眠超时',
        'advanced.displayBattery': '用电池保活时屏幕也会保持点亮：屏幕一关，Windows 就进入现代待机，电源请求最多只能再拖五分钟。',
        'advanced.minutes': '分钟',
        'advanced.hours': '小时',
        'advanced.modern': '现代待机',
        'advanced.modernOn': '开启——合盖会被强制进入待机，上面的合盖动作说了也不算',
        'advanced.modernOff': '已关闭——合盖不会再让机器睡眠',
        'advanced.modernPending': '已写入，等重启生效',
        'advanced.modernFix': '关闭现代待机（管理员，需重启）',
        'advanced.modernRestore': '恢复保存的现代待机设置',
        'advanced.modernHint': '只有在那些忽略「不采取任何操作」的版本上才管用的一招。重启后生效；关闭期间，这台机器就没有任何睡眠状态了。',
        'advanced.display': '同时保持屏幕常亮',
        'advanced.displayHint': '一般不用手动打开：自检发现保活期间仍进过现代待机时，插件自己会把请求从「仅系统」0x80000001 升级为「系统 + 显示」0x80000003。',
        'advanced.grace': '结束后宽限',
        'advanced.graceHint': 'DSH 空闲后继续保活这么久，免得后台任务或收尾写文件被掐断。填 0 表示立刻释放。',
        'advanced.seconds': '秒',
        'advanced.helper': '免确认切换',
        'advanced.helperOn': '已就绪——切换合盖动作不再询问权限',
        'advanced.helperOff': '未安装——切换时会询问一次权限',
        'advanced.helperInstall': '安装（管理员）',
        'advanced.helperRemove': '移除',
        'advanced.cleanup': '彻底还原',
        'advanced.cleanupHint': '关掉保活，把合盖动作、睡眠超时、电池屏幕超时都放回原值，移除免确认切换的计划任务和它的文件，如果插件关过现代待机也一并恢复。卸载前点一下，机器就跟没装过一样。',
        'advanced.cleanupAction': '还原并清理',
        'notice.cleaned': '电源设置已全部还原，免确认切换已移除。',
        'notice.cleanedPartial': '电源设置已还原，但免确认切换的计划任务没权限删除。',
        'battery.label': '电池保护',
        'battery.hint': '使用电池时，电量降到这个值以下就自动停止保活，并把合盖动作恢复成睡眠——不会再弹管理员确认。',
        'battery.min': '填 0 表示关闭。',
        'battery.fixed': '电池保护阈值已设为 {floor}%。',
        'alert.autoStop': '电量已到 {percent}%，保活已自动停止。',
        'alert.autoStopLid': '没能在不弹窗的情况下恢复合盖动作——请用下面的按钮恢复合盖睡眠。',
        'alert.dismiss': '知道了',
        'notice.helperInstalled': '免确认切换已安装。',
        'notice.helperRemoved': '免确认切换已移除。',
        'notice.graceSet': '结束后宽限已设为 {seconds} 秒。',
        'advanced.diag': '查看诊断信息',
        'advanced.keeper': '电源请求能力：{state}',
        'advanced.hideDiag': '收起诊断信息',
        'lid.0': '不采取任何操作',
        'lid.1': '睡眠',
        'lid.2': '休眠',
        'lid.3': '关机',
        'lid.default': '系统默认',
        'power.ac': '已接通电源',
        'power.battery': '电池 {percent}%',
        'power.unknown': '电源状态未知',
        'hold.since': '已持续 {duration}',
        'hold.heartbeat': '最近心跳 {time}',
        'hold.none': '未保活',
        'error.host': '连不上宿主——插件是否已启用？',
        'busy': '处理中…',
        'notice.added': '已添加 {name}',
        'notice.removed': '已移除 {name}',
        'notice.lidFixed': '合盖动作已改为「不采取任何操作」（交流与电池）。',
        'notice.lidReverted': '合盖动作已恢复。',
        'notice.sleepReverted': '睡眠超时已恢复。',
        'notice.modernFixed': '注册表里的现代待机已关闭——重启后生效。',
        'notice.modernRestored': '现代待机设置已恢复——重启后生效。',
        'notice.enabled': '已开始保活。',
        'notice.disabled': '电源请求已释放。',
        'notice.lidDenied': '管理员授权被取消——合盖动作没有改动。',
        'notice.lidHelperNeeded': '还没安装免确认切换——请在「高级」里安装一次，之后切换都是瞬间完成。',
        'switch.lidHint': '打开开关会把合盖动作设为「不采取任何操作」、把睡眠超时设为「从不」，这样 Windows 在你保活时就不能把机器睡下去；关掉开关会把你原来的值放回去。',
        'hero.floor': '低于 {floor}% 自动停止',
        'hero.apps': '监视 {count} 个应用',
        'hero.grace': '宽限 {seconds} 秒',
        'alert.lidLeftOn': '合盖动作还是「不采取任何操作」，现在合盖不会睡眠、也不会锁屏。',
        'alert.lidRestore': '恢复合盖睡眠',
        'alert.sleepLeftOn': '睡眠超时还是「从不」，机器空闲后不会自动睡眠。',
        'alert.sleepRestore': '恢复睡眠超时',
        'alert.escalated': '保活期间 Windows 仍进过一次现代待机（{reason}，{time}）。',
        'alert.escalatedDisplay': '电源请求已从「仅系统」(0x80000001) 升级为「系统 + 显示」(0x80000003)：屏幕保持点亮，现代待机就不会启动。',
        'alert.escalatedModern': '升级后仍然发生过待机——这台机器上最后的手段是关闭现代待机（需管理员，重启生效）。',
        'alert.escalatedReset': '改回普通保活',
        'notice.escalationReset': '已改回普通电源请求。',
        'footer.note': '关闭即停止。',
        'close': '关闭',
        'minimize': '收起',
        'open': '打开合盖保活小窗',
        'unsupported': '这台机器无法申请 Windows 电源请求，开关会保持关闭。',
        'diag.copy': '复制',
        'diag.copied': '已复制',
      },
    }

    /**
     * Pick a dictionary from the live Client locale, falling back to the
     * browser language when the locale service is unavailable.
     * @param {object} ctx
     * @returns {(key: string, params?: object) => string}
     */
    function createTranslate(ctx) {
      let id = ''
      try {
        const locale = ctx?.locale
        const snapshot = (locale?.getLocale?.() ?? locale?.getSnapshot?.()) || {}
        id = String(snapshot.id ?? snapshot.locale ?? snapshot.tag ?? snapshot.localeId ?? '')
      } catch {
        id = ''
      }
      if (id === '') {
        try {
          id = String(navigator.language || 'en')
        } catch {
          id = 'en'
        }
      }
      const dict = /^zh/i.test(id) ? DICT.zh : DICT.en
      return (key, params) => {
        let text = dict[key] ?? DICT.en[key] ?? key
        if (params) {
          for (const [name, value] of Object.entries(params)) {
            text = text.split(`{${name}}`).join(String(value))
          }
        }
        return text
      }
    }

    /** @param {string} path @returns {Promise<any>} */
    async function apiGet(path) {
      const response = await fetch(`${BASE}${path}`, { cache: 'no-store', headers: { accept: 'application/json' } })
      const body = await response.json().catch(() => null)
      if (!response.ok || body === null) throw new Error(body && body.error ? body.error : `HTTP ${response.status}`)
      return body
    }

    /** @param {string} action @param {object} payload @returns {Promise<any>} */
    async function apiAct(action, payload = {}) {
      const response = await fetch(`${BASE}/action`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      })
      const body = await response.json().catch(() => null)
      if (body === null) throw new Error(`HTTP ${response.status}`)
      if (!response.ok || body.ok === false) throw new Error(body.error || `HTTP ${response.status}`)
      return body
    }

    /** @param {number} ms @returns {string} */
    function duration(ms) {
      if (!Number.isFinite(ms) || ms <= 0) return '0:00'
      const total = Math.floor(ms / 1000)
      const hours = Math.floor(total / 3600)
      const minutes = Math.floor((total % 3600) / 60)
      const seconds = total % 60
      return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}` : `${minutes}:${String(seconds).padStart(2, '0')}`
    }

    /** @param {number} timestamp @returns {string} */
    function clock(timestamp) {
      if (!timestamp) return '—'
      const date = new Date(timestamp)
      return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
    }

    /**
     * Tiny external store: one page-scoped view model shared by the window and
     * the sidebar button.
     * @returns {object} store API.
     */
    function createStore() {
      let state = {
        open: false,
        collapsed: false,
        x: null,
        y: null,
        status: null,
        error: null,
        loading: false,
        pending: '',
        notice: null,
        apps: null,
        query: '',
        diag: null,
        advanced: false,
        floorInput: null,
        graceInput: null,
      }
      const listeners = new Set()
      return {
        get() {
          return state
        },
        set(patch) {
          state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
          for (const listener of listeners) listener()
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      }
    }

    /** @param {object} store */
    function useStore(store) {
      const [snapshot, setSnapshot] = React.useState(store.get())
      React.useEffect(() => store.subscribe(() => setSnapshot(store.get())), [store])
      return snapshot
    }

    /**
     * Refresh the host snapshot into the store.
     * @param {object} store
     */
    async function refreshStatus(store) {
      store.set({ loading: true })
      try {
        const status = await apiGet('/status')
        store.set({ status, error: null, loading: false })
      } catch (error) {
        store.set({ error: String(error?.message || error), loading: false })
      }
    }

    /**
     * Run one action, then adopt the returned snapshot.
     * @param {object} store
     * @param {string} action
     * @param {object} payload
     * @param {(result: object, state: object) => string} [note]
     */
    async function run(store, action, payload, note) {
      store.set({ pending: action, notice: null })
      try {
        const result = await apiAct(action, payload)
        if (result.snapshot) store.set({ status: result.snapshot, error: null })
        store.set({ pending: '', notice: note ? note(result, store.get()) : null })
        setTimeout(() => {
          const current = store.get()
          if (current.notice) store.set({ notice: null })
        }, 2600)
      } catch (error) {
        store.set({ pending: '', error: String(error?.message || error), notice: null })
      }
    }

    /**
     * Fetch the running-application catalog once per window open.
     * @param {object} store
     */
    async function refreshApps(store) {
      try {
        const result = await apiGet('/apps')
        store.set({ apps: Array.isArray(result.apps) ? result.apps : [] })
      } catch {
        store.set({ apps: [] })
      }
    }

    /** @param {object} props @returns {object} style */
    const theme = () => ({
      surface: 'var(--dsw-alias-bg-overlay)',
      layer: 'var(--dsw-alias-bg-layer-1)',
      layer2: 'var(--dsw-alias-bg-layer-2)',
      border: 'var(--dsw-alias-border-l1)',
      borderStrong: 'var(--dsw-alias-border-l2)',
      text: 'var(--dsw-alias-label-primary)',
      muted: 'var(--dsw-alias-label-secondary)',
      brand: 'var(--dsw-alias-brand-primary)',
      ok: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      bad: 'var(--dsw-alias-state-error-primary)',
      idle: 'var(--dsw-alias-state-idle-primary)',
    })

    const STYLE = `
.dsh-ka-window{position:fixed;right:18px;bottom:76px;width:360px;max-height:calc(100vh - 128px);display:flex;flex-direction:column;
  overflow:hidden;pointer-events:auto;z-index:40;color:var(--dsw-alias-label-primary);
  background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-bg-overlay) 94%,#fff 6%),var(--dsw-alias-bg-overlay));
  border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2) 70%,transparent);border-radius:16px;
  box-shadow:0 28px 64px -16px rgba(0,0,0,.55),0 2px 10px rgba(0,0,0,.22),inset 0 1px 0 color-mix(in srgb,#fff 7%,transparent);
  backdrop-filter:blur(18px) saturate(140%);
  font:13px/1.5 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
.dsh-ka-head{display:flex;align-items:center;gap:8px;padding:0 8px 0 14px;height:46px;cursor:grab;user-select:none;
  border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 80%,transparent)}
.dsh-ka-head:active{cursor:grabbing}
.dsh-ka-title{font-weight:600;font-size:13px;letter-spacing:.01em;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-ka-pill{font-size:11px;font-weight:500;padding:3px 9px;border-radius:999px;border:1px solid transparent;white-space:nowrap}
.dsh-ka-iconbtn{appearance:none;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);
  width:24px;height:24px;border-radius:7px;display:grid;place-items:center;cursor:pointer;padding:0;font-size:14px;line-height:1}
.dsh-ka-iconbtn:hover{background:color-mix(in srgb,#fff 8%,transparent);color:var(--dsw-alias-label-primary)}
.dsh-ka-body{padding:13px 14px 15px;display:flex;flex-direction:column;gap:15px;overflow:auto;scrollbar-width:thin}
.dsh-ka-hero{display:flex;flex-direction:column;gap:11px;padding:14px;border-radius:13px;
  background:linear-gradient(160deg,color-mix(in srgb,var(--dsw-alias-bg-layer-2) 70%,var(--dsw-alias-bg-layer-1)),var(--dsw-alias-bg-layer-1));
  border:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 90%,transparent)}
.dsh-ka-hero.is-on{background:linear-gradient(160deg,color-mix(in srgb,var(--dsw-alias-state-success-primary) 13%,var(--dsw-alias-bg-layer-1)),var(--dsw-alias-bg-layer-1));
  border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 30%,var(--dsw-alias-border-l1))}
.dsh-ka-hero-top{display:flex;align-items:center;gap:12px}
.dsh-ka-hero-text{flex:1;min-width:0}
.dsh-ka-hero-title{font-size:16px;font-weight:650;line-height:1.3;letter-spacing:.01em}
.dsh-ka-hero-sub{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:3px}
.dsh-ka-hero-foot{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.dsh-ka-chip{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:999px;font-size:11px;
  color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,#fff 5%,transparent);
  border:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 85%,transparent)}
.dsh-ka-chip-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
.dsh-ka-hero-note{font-size:11.5px;line-height:1.45;color:var(--dsw-alias-label-secondary)}
.dsh-ka-row{display:flex;align-items:flex-start;gap:10px}
.dsh-ka-row-main{flex:1;min-width:0}
.dsh-ka-label{font-weight:600}
.dsh-ka-hint{color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:1.45}
.dsh-ka-switch{position:relative;width:40px;height:23px;border-radius:999px;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2) 80%,transparent);
  background:color-mix(in srgb,#fff 8%,transparent);cursor:pointer;flex:none;transition:background .18s ease,border-color .18s ease;padding:0}
.dsh-ka-switch[aria-checked="true"]{background:var(--dsw-alias-state-success-primary);border-color:transparent}
.dsh-ka-switch[disabled]{opacity:.5;cursor:default}
.dsh-ka-switch span{position:absolute;top:2px;left:2px;width:17px;height:17px;border-radius:50%;background:#fff;
  transition:transform .18s cubic-bezier(.2,.8,.3,1);box-shadow:0 1px 3px rgba(0,0,0,.35)}
.dsh-ka-switch[aria-checked="true"] span{transform:translateX(17px)}
.dsh-ka-seg{display:flex;gap:2px;padding:2px;border-radius:11px;background:var(--dsw-alias-bg-layer-1);
  border:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 85%,transparent)}
.dsh-ka-seg button{flex:1;appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);
  border-radius:8px;padding:6px 4px;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap;transition:background .15s ease,color .15s ease}
.dsh-ka-seg button:hover{color:var(--dsw-alias-label-primary)}
.dsh-ka-seg button[data-on="true"]{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 20%,var(--dsw-alias-bg-layer-2));
  color:var(--dsw-alias-brand-primary);font-weight:600}
.dsh-ka-sec{display:flex;flex-direction:column;gap:9px}
.dsh-ka-sec-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;font-weight:600;
  letter-spacing:.07em;color:var(--dsw-alias-label-secondary)}
.dsh-ka-watch{display:flex;flex-direction:column;gap:5px}
.dsh-ka-watchrow{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:10px;border:1px solid transparent;
  background:var(--dsw-alias-bg-layer-1);transition:border-color .15s ease,background .15s ease}
.dsh-ka-watchrow:hover{border-color:color-mix(in srgb,var(--dsw-alias-border-l1) 90%,transparent)}
.dsh-ka-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-state-idle-primary);
  box-shadow:0 0 0 3px color-mix(in srgb,currentColor 12%,transparent)}
.dsh-ka-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,Consolas,monospace;font-size:12px}
.dsh-ka-tag{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dsh-ka-x{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;
  width:20px;height:20px;border-radius:6px;font-size:13px;line-height:1;padding:0;opacity:.55;transition:opacity .15s ease,background .15s ease}
.dsh-ka-watchrow:hover .dsh-ka-x{opacity:1}
.dsh-ka-x:hover{background:color-mix(in srgb,#fff 8%,transparent);color:var(--dsw-alias-state-error-primary);opacity:1}
.dsh-ka-addrow{display:flex;gap:6px}
.dsh-ka-input,.dsh-ka-select{flex:1;min-width:0;box-sizing:border-box;height:32px;background:var(--dsw-alias-bg-layer-1);
  color:var(--dsw-alias-label-primary);border:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 90%,transparent);border-radius:9px;
  padding:0 9px;font:inherit;font-size:12px;transition:border-color .15s ease,background .15s ease}
.dsh-ka-select{height:32px;padding:0 6px}
.dsh-ka-input:focus,.dsh-ka-select:focus{outline:none;border-color:var(--dsw-alias-brand-primary);
  background:var(--dsw-alias-bg-layer-2)}
.dsh-ka-input::placeholder{color:var(--dsw-alias-label-secondary)}
.dsh-ka-btn{appearance:none;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2) 90%,transparent);
  background:color-mix(in srgb,#fff 5%,transparent);color:var(--dsw-alias-label-primary);border-radius:9px;
  height:32px;padding:0 12px;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap;
  transition:border-color .15s ease,background .15s ease}
.dsh-ka-btn:hover{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 60%,transparent);
  background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent)}
.dsh-ka-btn[disabled]{opacity:.5;cursor:default}
.dsh-ka-btn-ghost{background:transparent;border-color:transparent;color:var(--dsw-alias-label-secondary);padding:0 8px;height:26px}
.dsh-ka-btn-ghost:hover{color:var(--dsw-alias-label-primary);background:color-mix(in srgb,#fff 7%,transparent);border-color:transparent}
.dsh-ka-foot{padding:9px 14px 11px;border-top:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 70%,transparent);
  display:flex;flex-direction:column;gap:4px;color:var(--dsw-alias-label-secondary);font-size:11px;
  background:color-mix(in srgb,#fff 3%,transparent)}
.dsh-ka-footline{display:flex;justify-content:space-between;gap:8px}
.dsh-ka-notice{padding:9px 11px;border-radius:10px;font-size:12px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);
  border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 26%,transparent);color:var(--dsw-alias-label-primary)}
.dsh-ka-alert{padding:10px 11px;border-radius:11px;font-size:12px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 11%,transparent);
  border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 30%,transparent);
  border-left:3px solid var(--dsw-alias-state-warn-primary);display:flex;flex-direction:column;gap:7px}
.dsh-ka-err{color:var(--dsw-alias-state-error-primary);font-size:12px}
.dsh-ka-pre{margin:0;max-height:150px;overflow:auto;background:var(--dsw-alias-bg-layer-1);border:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 80%,transparent);
  border-radius:9px;padding:9px;font:11px/1.45 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-all;
  color:var(--dsw-alias-label-secondary)}
.dsh-ka-collapsed{padding:0}
.dsh-ka-footerbtn{display:flex;align-items:center;gap:8px;width:100%;appearance:none;border:0;background:transparent;
  color:var(--dsw-alias-label-secondary);padding:6px 10px;border-radius:8px;cursor:pointer;font:inherit;font-size:13px;
  text-align:left}
.dsh-ka-footerbtn:hover{background:color-mix(in srgb,#fff 7%,transparent);color:var(--dsw-alias-label-primary)}
.dsh-ka-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0}
@media (max-width:520px){.dsh-ka-window{width:min(100vw - 20px,360px);right:10px;bottom:70px}}
`

    /** Glyph used by the window header and the sidebar action. */
    function Glyph(props) {
      const size = props && props.size ? props.size : 18
      const color = props && props.color ? props.color : 'currentColor'
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('rect', { x: 2.5, y: 4.5, width: 19, height: 12.5, rx: 2, stroke: color, strokeWidth: 1.6 }),
        h('path', { d: 'M7 20.5h10', stroke: color, strokeWidth: 1.6, strokeLinecap: 'round' }),
        h('path', {
          d: 'M15.4 8.2a3.4 3.4 0 1 0 3.5 4.1 2.9 2.9 0 0 1-3.5-4.1z',
          fill: color === 'currentColor' ? 'currentColor' : color,
          opacity: 0.9,
        }),
      )
    }

    function Switch(props) {
      return h(
        'button',
        {
          type: 'button',
          className: 'dsh-ka-switch',
          role: 'switch',
          'aria-checked': props.checked ? 'true' : 'false',
          'aria-label': props.label,
          title: props.label,
          disabled: props.disabled,
          onClick: props.onChange,
        },
        h('span', null),
      )
    }

    /** @param {object} props @returns {object} status colour pair */
    function pillStyle(status, t) {
      if (!status || !status.supported) return { color: 'var(--dsw-alias-state-idle-primary)', border: '1px solid var(--dsw-alias-border-l1)' }
      if (status.hold && status.hold.active) {
        return {
          color: 'var(--dsw-alias-state-success-primary)',
          background: 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent)',
          border: '1px solid color-mix(in srgb, var(--dsw-alias-state-success-primary) 35%, transparent)',
        }
      }
      if (status.state && status.state.enabled) {
        return {
          color: 'var(--dsw-alias-state-warn-primary)',
          background: 'color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent)',
          border: '1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 35%, transparent)',
        }
      }
      return { color: 'var(--dsw-alias-label-secondary)', border: '1px solid var(--dsw-alias-border-l1)' }
    }

    /**
     * Build the shared view helpers.
     * @param {object} ctx
     * @param {object} store
     */
    function createView(ctx, store) {
      const t = createTranslate(ctx)

      function statusText(status) {
        if (!status) return t('status.off')
        if (!status.supported) return t('status.unsupported')
        if (status.hold && status.hold.active) return t('status.active')
        if (status.state && status.state.enabled) return t('status.waiting')
        return t('status.off')
      }

      function lidText(value) {
        if (value === null || value === undefined) return t('lid.default')
        return t(`lid.${value}`)
      }

      /**
       * "Sleep after" index in words: 0 means "never", anything else a duration.
       * @param {number|null|undefined} value - seconds.
       * @returns {string}
       */
      function sleepText(value) {
        if (value === null || value === undefined) return t('lid.default')
        if (!Number.isFinite(value) || value <= 0) return t('advanced.sleepNever')
        const seconds = Math.round(value)
        if (seconds % 3600 === 0) return `${seconds / 3600} ${t('advanced.hours')}`
        if (seconds % 60 === 0) return `${seconds / 60} ${t('advanced.minutes')}`
        return `${seconds} ${t('advanced.seconds')}`
      }

      /**
       * Wall-clock text for an event timestamp.
       * @param {number|null|undefined} ms
       * @returns {string}
       */
      function clockText(ms) {
        if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—'
        try {
          return new Date(ms).toLocaleTimeString(undefined, { hour12: false })
        } catch {
          return '—'
        }
      }

      function StartWindow() {
        const view = useStore(store)
        const status = view.status
        const pending = view.pending !== ''

        React.useEffect(() => {
          if (!view.open) return undefined
          let cancelled = false
          const load = () => {
            if (!cancelled) void refreshStatus(store)
          }
          load()
          const timer = setInterval(load, 2000)
          return () => {
            cancelled = true
            clearInterval(timer)
          }
        }, [view.open])

        React.useEffect(() => {
          if (!view.open || view.apps !== null) return
          void refreshApps(store)
        }, [view.open, view.apps])

        React.useEffect(() => {
          const onKey = (event) => {
            if (event.key === 'Escape' && store.get().open) store.set({ open: false })
          }
          window.addEventListener('keydown', onKey)
          return () => window.removeEventListener('keydown', onKey)
        }, [])

        if (!view.open) return null

        const mode = status?.state?.mode || 'always'
        const enabled = status?.state?.enabled === true
        const supported = status ? status.supported === true : true
        const holding = enabled && status?.hold?.active === true

        const startDrag = (event) => {
          if (event.button !== 0) return
          const target = event.currentTarget.closest('.dsh-ka-window')
          if (!target) return
          const rect = target.getBoundingClientRect()
          const origin = { px: event.clientX, py: event.clientY, left: rect.left, top: rect.top }
          const move = (ev) => {
            const x = Math.max(6, Math.min(window.innerWidth - 120, origin.left + ev.clientX - origin.px))
            const y = Math.max(6, Math.min(window.innerHeight - 80, origin.top + ev.clientY - origin.py))
            store.set({ x, y })
          }
          const up = () => {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', up)
          }
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', up)
        }

        const position = {}
        if (view.x !== null && view.y !== null) {
          position.left = `${view.x}px`
          position.top = `${view.y}px`
          position.right = 'auto'
          position.bottom = 'auto'
        }

        const notice = view.notice ? h('div', { className: 'dsh-ka-notice' }, view.notice) : null
        const error = view.error
          ? h('div', { className: 'dsh-ka-err', role: 'alert' }, `${t('error.host')} — ${view.error}`)
          : null

        const powerLine =
          status?.power?.ac === true
            ? t('power.ac')
            : status?.power?.ac === false
              ? t('power.battery', { percent: status.power.batteryPercent ?? '?' })
              : t('power.unknown')

        const held = status?.hold
        const holdLine = held?.active && held.since ? t('hold.since', { duration: duration(Date.now() - held.since) }) : t('hold.none')
        const holdReason = held?.reason || {}
        const graceSeconds = holdReason.code === 'grace' ? Math.max(1, Math.ceil((holdReason.remainingMs || 0) / 1000)) : 0

        const watchRows = (status?.state?.watch || []).map((entry) =>
          h(
            'div',
            { className: 'dsh-ka-watchrow', key: entry.name },
            h('span', {
              className: 'dsh-ka-dot',
              style: { background: entry.running ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-idle-primary)' },
            }),
            h('span', { className: 'dsh-ka-name', title: entry.name }, entry.name),
            h('span', { className: 'dsh-ka-tag' }, entry.running ? t('watch.running') : t('watch.idle')),
            h('button', { type: 'button', className: 'dsh-ka-x', 'aria-label': t('watch.remove'), title: t('watch.remove'), onClick: () => void run(store, 'watch-remove', { name: entry.name }, () => t('notice.removed', { name: entry.name })) }, '×'),
          ),
        )

        const apps = view.apps || []
        const watched = new Set((status?.state?.watch || []).map((entry) => entry.name.toLowerCase()))
        const options = apps.filter((app) => !watched.has(String(app.name).toLowerCase())).slice(0, 120)

        const inputValue = view.query || ''
        const addName = () => {
          const name = (store.get().query || '').trim()
          if (name === '') return
          store.set({ query: '' })
          void run(store, 'watch-add', { name }, () => t('notice.added', { name }))
        }

        const floorValue = view.floorInput ?? (status?.state?.batteryFloor ?? 30)
        const commitFloor = () => {
          const raw = store.get().floorInput
          if (raw === null || raw === undefined) return
          store.set({ floorInput: null })
          const value = Math.round(Number(raw))
          if (!Number.isFinite(value)) return
          const floor = Math.max(0, Math.min(100, value))
          void run(store, 'set-battery-floor', { batteryFloor: floor }, () => t('battery.fixed', { floor }))
        }

        const graceValue = view.graceInput ?? Math.round((status?.state?.graceMs ?? 60000) / 1000)
        const commitGrace = () => {
          const raw = store.get().graceInput
          if (raw === null || raw === undefined) return
          store.set({ graceInput: null })
          const value = Math.round(Number(raw))
          if (!Number.isFinite(value)) return
          const seconds = Math.max(0, Math.min(300, value))
          void run(store, 'set-grace', { graceSeconds: seconds }, () => t('notice.graceSet', { seconds }))
        }

        const advancedBody = view.advanced
          ? h(
              React.Fragment,
              null,
              h(
                'div',
                { className: 'dsh-ka-row' },
                h(
                  'div',
                  { className: 'dsh-ka-row-main' },
                  h('div', { className: 'dsh-ka-label' }, t('advanced.grace')),
                ),
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: '4px', flex: 'none' } },
                  h('input', {
                    className: 'dsh-ka-input',
                    type: 'number',
                    min: 0,
                    max: 300,
                    step: 5,
                    inputMode: 'numeric',
                    style: { width: '62px', flex: 'none', textAlign: 'right' },
                    value: graceValue,
                    disabled: pending,
                    'aria-label': t('advanced.grace'),
                    onChange: (event) => store.set({ graceInput: event.target.value }),
                    onBlur: commitGrace,
                    onKeyDown: (event) => {
                      if (event.key === 'Enter') commitGrace()
                    },
                  }),
                  h('span', { className: 'dsh-ka-tag' }, t('advanced.seconds')),
                ),
              ),
              h('div', { className: 'dsh-ka-hint' }, t('advanced.graceHint')),
              h(
                'div',
                { className: 'dsh-ka-row' },
                h(
                  'div',
                  { className: 'dsh-ka-row-main' },
                  h('div', { className: 'dsh-ka-label' }, t('advanced.lid')),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-ka-btn',
                    disabled: pending,
                    onClick: () =>
                      void run(store, 'lid-fix', {}, () => t('notice.lidFixed')).then(() => refreshApps(store)),
                  },
                  t('advanced.fix'),
                ),
              ),
              h(
                'div',
                { className: 'dsh-ka-hint' },
                t('advanced.lidValue', { ac: lidText(status?.env?.lidAc), dc: lidText(status?.env?.lidDc) }),
              ),
              status?.state?.lidOriginal
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-ka-btn dsh-ka-btn-ghost',
                      style: { alignSelf: 'flex-start' },
                      disabled: pending,
                      onClick: () => void run(store, 'lid-revert', {}, () => t('notice.lidReverted')),
                    },
                    t('advanced.revert'),
                  )
                : null,
              h(
                'div',
                { className: 'dsh-ka-row' },
                h(
                  'div',
                  { className: 'dsh-ka-row-main' },
                  h('div', { className: 'dsh-ka-label' }, t('advanced.sleep')),
                  h(
                    'div',
                    { className: 'dsh-ka-hint' },
                    t('advanced.sleepValue', {
                      ac: sleepText(status?.env?.standbyAc),
                      dc: sleepText(status?.env?.standbyDc),
                    }),
                  ),
                ),
                holding && status?.env?.standbyAc === 0 && status?.env?.standbyDc === 0
                  ? h('span', { className: 'dsh-ka-tag' }, t('advanced.sleepNever'))
                  : null,
              ),
              h(
                'div',
                { className: 'dsh-ka-hint' },
                holding && status?.env?.standbyAc === 0 && status?.env?.standbyDc === 0
                  ? t('advanced.sleepHeld')
                  : t('advanced.sleepHint'),
                status?.env?.holdPlan?.displayHeld ? ` ${t('advanced.displayBattery')}` : '',
              ),
              status?.state?.sleepOriginal
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-ka-btn dsh-ka-btn-ghost',
                      style: { alignSelf: 'flex-start' },
                      disabled: pending,
                      onClick: () => void run(store, 'sleep-revert', {}, () => t('notice.sleepReverted')),
                    },
                    t('advanced.sleepRevert'),
                  )
                : null,
              h(
                'div',
                { className: 'dsh-ka-row' },
                h(
                  'div',
                  { className: 'dsh-ka-row-main' },
                  h('div', { className: 'dsh-ka-label' }, t('advanced.helper')),
                ),
                status?.env?.lidHelper
                  ? h(
                      'button',
                      {
                        type: 'button',
                        className: 'dsh-ka-btn dsh-ka-btn-ghost',
                        disabled: pending,
                        onClick: () => void run(store, 'lid-helper-remove', {}, () => t('notice.helperRemoved')),
                      },
                      t('advanced.helperRemove'),
                    )
                  : h(
                      'button',
                      {
                        type: 'button',
                        className: 'dsh-ka-btn',
                        disabled: pending,
                        onClick: () => void run(store, 'lid-helper-install', {}, () => t('notice.helperInstalled')),
                      },
                      t('advanced.helperInstall'),
                    ),
              ),
              h(
                'div',
                { className: 'dsh-ka-hint' },
                status?.env?.lidHelper ? t('advanced.helperOn') : t('advanced.helperOff'),
              ),
              h(
                'div',
                { className: 'dsh-ka-row' },
                h(
                  'div',
                  { className: 'dsh-ka-row-main' },
                  h('div', { className: 'dsh-ka-label' }, t('advanced.modern')),
                ),
                status?.state?.modernStandbyOriginal
                  ? h(
                      'button',
                      {
                        type: 'button',
                        className: 'dsh-ka-btn dsh-ka-btn-ghost',
                        disabled: pending,
                        onClick: () => void run(store, 'modern-standby-restore', {}, () => t('notice.modernRestored')),
                      },
                      t('advanced.modernRestore'),
                    )
                  : status?.env?.modernStandbyDisabled
                    ? null
                    : h(
                        'button',
                        {
                          type: 'button',
                          className: 'dsh-ka-btn',
                          disabled: pending,
                          onClick: () => void run(store, 'modern-standby-disable', {}, () => t('notice.modernFixed')),
                        },
                        t('advanced.modernFix'),
                      ),
              ),
              h(
                'div',
                { className: 'dsh-ka-hint' },
                status?.env?.pendingReboot
                  ? t('advanced.modernPending')
                  : status?.env?.modernStandbyDisabled
                    ? t('advanced.modernOff')
                    : t('advanced.modernOn'),
              ),
              h('div', { className: 'dsh-ka-hint' }, t('advanced.modernHint')),
              h(
                'div',
                { className: 'dsh-ka-row' },
                h(
                  'div',
                  { className: 'dsh-ka-row-main' },
                  h('div', { className: 'dsh-ka-label' }, t('advanced.display')),
                  h('div', { className: 'dsh-ka-hint' }, t('advanced.displayHint')),
                ),
                h(Switch, {
                  checked: status?.state?.preventDisplaySleep === true,
                  disabled: pending,
                  label: t('advanced.display'),
                  onChange: () => void run(store, 'set-display', { preventDisplaySleep: !(status?.state?.preventDisplaySleep === true) }),
                }),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-ka-btn dsh-ka-btn-ghost',
                  style: { alignSelf: 'flex-start' },
                  onClick: async () => {
                    if (view.diag) {
                      store.set({ diag: null })
                      return
                    }
                    try {
                      const result = await apiAct('diagnostics')
                      store.set({ diag: result.diagnostics || null })
                    } catch (diagError) {
                      store.set({ diag: { error: String(diagError?.message || diagError) } })
                    }
                  },
                },
                view.diag ? t('advanced.hideDiag') : t('advanced.diag'),
              ),
              view.diag
                ? h('pre', { className: 'dsh-ka-pre' }, JSON.stringify(view.diag, null, 2))
                : null,
              h(
                'div',
                { className: 'dsh-ka-row' },
                h(
                  'div',
                  { className: 'dsh-ka-row-main' },
                  h('div', { className: 'dsh-ka-label' }, t('advanced.cleanup')),
                  h('div', { className: 'dsh-ka-hint' }, t('advanced.cleanupHint')),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-ka-btn',
                    disabled: pending,
                    title: t('advanced.cleanupHint'),
                    onClick: () =>
                      void run(store, 'restore-defaults', {}, (result) =>
                        result?.helper && result.helper.ok === false ? t('notice.cleanedPartial') : t('notice.cleaned'),
                      ),
                  },
                  t('advanced.cleanupAction'),
                ),
              ),
            )
          : null

        return h(
          'div',
          { className: 'dsh-ka-window', style: position, role: 'dialog', 'aria-label': t('title') },
          h(
            'div',
            { className: 'dsh-ka-head', onPointerDown: startDrag },
            h(Glyph, { size: 16, color: 'var(--dsw-alias-brand-primary)' }),
            h('div', { className: 'dsh-ka-title' }, t('title')),
            h('span', { className: 'dsh-ka-pill', style: pillStyle(status, t) }, statusText(status)),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-ka-iconbtn',
                title: t('minimize'),
                'aria-label': t('minimize'),
                onClick: () => store.set({ open: false }),
              },
              '–',
            ),
          ),
          h(
            'div',
            { className: 'dsh-ka-body' },
            notice,
            error,
            h(
              'div',
              { className: `dsh-ka-hero${enabled && status?.hold?.active ? ' is-on' : ''}` },
              h(
                'div',
                { className: 'dsh-ka-hero-top' },
                h(
                  'div',
                  { className: 'dsh-ka-hero-text' },
                  h('div', { className: 'dsh-ka-hero-title' }, statusText(status)),
                  h(
                    'div',
                    { className: 'dsh-ka-hero-sub' },
                    enabled
                      ? supported
                        ? graceSeconds > 0
                          ? t('hero.grace', { seconds: graceSeconds })
                          : holdLine
                        : t('unsupported')
                      : t('switch.hint'),
                  ),
                ),
                h(Switch, {
                  checked: enabled,
                  disabled: pending || !supported,
                  label: t('switch.label'),
                  onChange: () => {
                    const next = !enabled
                    // Flip the switch locally first: the host needs a moment to
                    // switch the lid action, and the click must feel immediate.
                    if (status) {
                      store.set({
                        status: { ...status, state: { ...(status.state || {}), enabled: next } },
                      })
                    }
                    void run(store, next ? 'enable' : 'disable', {}, (result) => {
                      // The lid and the sleep timeout are separate writes; either
                      // one can be refused on a locked-down machine.
                      for (const part of [result?.lid, result?.sleep]) {
                        if (!part || part.applied !== false) continue
                        const reason = String(part.error || '')
                        if (reason.includes('helper-missing') || reason.includes('needs-admin')) {
                          return t('notice.lidHelperNeeded')
                        }
                        return t('notice.lidDenied')
                      }
                      return t(next ? 'notice.enabled' : 'notice.disabled')
                    })
                  },
                }),
              ),
              h(
                'div',
                { className: 'dsh-ka-hero-foot' },
                h(
                  'span',
                  { className: 'dsh-ka-chip' },
                  h('span', {
                    className: 'dsh-ka-chip-dot',
                    style: {
                      background:
                        status?.power?.ac === true
                          ? 'var(--dsw-alias-state-success-primary)'
                          : status?.power?.ac === false
                            ? 'var(--dsw-alias-state-warn-primary)'
                            : 'var(--dsw-alias-state-idle-primary)',
                    },
                  }),
                  powerLine,
                ),
                enabled && Number(status?.state?.batteryFloor) > 0
                  ? h(
                      'span',
                      { className: 'dsh-ka-chip' },
                      h('span', { className: 'dsh-ka-chip-dot', style: { background: 'var(--dsw-alias-label-secondary)' } }),
                      t('hero.floor', { floor: status.state.batteryFloor }),
                    )
                  : null,
                enabled && Array.isArray(status?.state?.watch) && status.state.watch.length > 0
                  ? h(
                      'span',
                      { className: 'dsh-ka-chip' },
                      h('span', { className: 'dsh-ka-chip-dot', style: { background: 'var(--dsw-alias-label-secondary)' } }),
                      t('hero.apps', { count: status.state.watch.length }),
                    )
                  : null,
              ),
              h('div', { className: 'dsh-ka-hero-note' }, t('switch.lidHint')),
            ),
            status?.env?.lidNeedsRestore
              ? h(
                  'div',
                  { className: 'dsh-ka-alert' },
                  h('div', null, t('alert.lidLeftOn')),
                  h(
                    'div',
                    { style: { display: 'flex', justifyContent: 'flex-end' } },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dsh-ka-btn',
                        disabled: pending,
                        onClick: () => void run(store, 'lid-revert', {}, () => t('notice.lidReverted')),
                      },
                      t('alert.lidRestore'),
                    ),
                  ),
                )
              : null,
            status?.env?.sleepNeedsRestore || status?.env?.videoNeedsRestore
              ? h(
                  'div',
                  { className: 'dsh-ka-alert' },
                  h('div', null, t('alert.sleepLeftOn')),
                  h(
                    'div',
                    { style: { display: 'flex', justifyContent: 'flex-end' } },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dsh-ka-btn',
                        disabled: pending,
                        onClick: () => void run(store, 'sleep-revert', {}, () => t('notice.sleepReverted')),
                      },
                      t('alert.sleepRestore'),
                    ),
                  ),
                )
              : null,
            status?.escalation && Number(status.escalation.level) >= 2
              ? h(
                  'div',
                  { className: 'dsh-ka-alert' },
                  h(
                    'div',
                    null,
                    t('alert.escalated', {
                      reason: status.escalation.reasonText || '—',
                      time: clockText(status.escalation.eventAt),
                    }),
                  ),
                  h(
                    'div',
                    { className: 'dsh-ka-hint' },
                    Number(status.escalation.level) >= 3 ? t('alert.escalatedModern') : t('alert.escalatedDisplay'),
                  ),
                  h(
                    'div',
                    { style: { display: 'flex', justifyContent: 'flex-end', gap: '6px' } },
                    Number(status.escalation.level) >= 3
                      ? h(
                          'button',
                          {
                            type: 'button',
                            className: 'dsh-ka-btn',
                            disabled: pending,
                            onClick: () => void run(store, 'modern-standby-disable', {}, () => t('notice.modernFixed')),
                          },
                          t('advanced.modernFix'),
                        )
                      : h(
                          'button',
                          {
                            type: 'button',
                            className: 'dsh-ka-btn dsh-ka-btn-ghost',
                            disabled: pending,
                            onClick: () => void run(store, 'reset-escalation', {}, () => t('notice.escalationReset')),
                          },
                          t('alert.escalatedReset'),
                        ),
                  ),
                )
              : null,
            status?.autoStop
              ? h(
                  'div',
                  { className: 'dsh-ka-alert' },
                  h('div', null, t('alert.autoStop', { percent: status.autoStop.batteryPercent ?? '?' })),
                  status.autoStop.lidRestored === false ? h('div', { className: 'dsh-ka-hint' }, t('alert.autoStopLid')) : null,
                  h(
                    'div',
                    { style: { display: 'flex', justifyContent: 'flex-end', gap: '6px' } },
                    status.autoStop.lidRestored === false
                      ? h(
                          'button',
                          {
                            type: 'button',
                            className: 'dsh-ka-btn',
                            disabled: pending,
                            onClick: () => void run(store, 'lid-revert', {}, () => t('notice.lidReverted')),
                          },
                          t('alert.lidRestore'),
                        )
                      : null,
                    status.autoStop.sleepRestored === false
                      ? h(
                          'button',
                          {
                            type: 'button',
                            className: 'dsh-ka-btn',
                            disabled: pending,
                            onClick: () => void run(store, 'sleep-revert', {}, () => t('notice.sleepReverted')),
                          },
                          t('alert.sleepRestore'),
                        )
                      : null,
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dsh-ka-btn dsh-ka-btn-ghost',
                        disabled: pending,
                        onClick: () => void run(store, 'dismiss-auto-stop', {}, () => ''),
                      },
                      t('alert.dismiss'),
                    ),
                  ),
                )
              : null,
            h(
              'div',
              { className: 'dsh-ka-sec' },
              h('div', { className: 'dsh-ka-sec-head' }, t('mode.label')),
              h(
                'div',
                { className: 'dsh-ka-seg', role: 'tablist' },
                ['always', 'apps', 'busy'].map((value) =>
                  h(
                    'button',
                    {
                      type: 'button',
                      key: value,
                      role: 'tab',
                      'aria-selected': mode === value ? 'true' : 'false',
                      'data-on': mode === value ? 'true' : 'false',
                      disabled: pending || !supported,
                      title: t(`mode.${value}.hint`),
                      onClick: () => void run(store, 'set-mode', { mode: value }),
                    },
                    t(`mode.${value}`),
                  ),
                ),
              ),
              h('div', { className: 'dsh-ka-hint' }, t(`mode.${mode}.hint`)),
            ),
            h(
              'div',
              { className: 'dsh-ka-sec' },
              h(
                'div',
                { className: 'dsh-ka-sec-head' },
                t('watch.label'),
                h('span', { className: 'dsh-ka-tag' }, `(${(status?.state?.watch || []).length})`),
              ),
              h('div', { className: 'dsh-ka-watch' }, watchRows.length ? watchRows : h('div', { className: 'dsh-ka-hint' }, t('watch.empty'))),
              h(
                'div',
                { className: 'dsh-ka-addrow' },
                h('input', {
                  className: 'dsh-ka-input',
                  value: inputValue,
                  placeholder: t('watch.placeholder'),
                  'aria-label': t('watch.placeholder'),
                  onChange: (event) => store.set({ query: event.target.value }),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') addName()
                  },
                }),
                h('button', { type: 'button', className: 'dsh-ka-btn', disabled: pending || inputValue.trim() === '', onClick: addName }, t('watch.add')),
              ),
              h(
                'select',
                {
                  className: 'dsh-ka-select',
                  value: '',
                  'aria-label': t('watch.pick'),
                  onFocus: () => {
                    if (view.apps === null) void refreshApps(store)
                  },
                  onChange: (event) => {
                    const name = event.target.value
                    if (!name) return
                    event.target.value = ''
                    void run(store, 'watch-add', { name }, () => t('notice.added', { name }))
                  },
                },
                h('option', { value: '' }, options.length ? t('watch.pick') : t('watch.noApps')),
                options.map((app) =>
                  h(
                    'option',
                    { value: app.name, key: app.name },
                    `${app.name}${app.count > 1 ? ` ×${app.count}` : ''}${app.title ? ` · ${app.title}` : ''}`,
                  ),
                ),
              ),
              h('div', { className: 'dsh-ka-hint' }, t('watch.hint')),
            ),
            h(
              'div',
              { className: 'dsh-ka-sec' },
              h('div', { className: 'dsh-ka-sec-head' }, t('battery.label')),
              h(
                'div',
                { className: 'dsh-ka-row' },
                h('div', { className: 'dsh-ka-row-main' }, h('div', { className: 'dsh-ka-hint' }, t('battery.hint'))),
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: '4px', flex: 'none' } },
                  h('input', {
                    className: 'dsh-ka-input',
                    type: 'number',
                    min: 0,
                    max: 100,
                    step: 1,
                    inputMode: 'numeric',
                    style: { width: '62px', flex: 'none', textAlign: 'right' },
                    value: floorValue,
                    disabled: pending,
                    'aria-label': t('battery.label'),
                    onChange: (event) => store.set({ floorInput: event.target.value }),
                    onBlur: commitFloor,
                    onKeyDown: (event) => {
                      if (event.key === 'Enter') commitFloor()
                    },
                  }),
                  h('span', { className: 'dsh-ka-tag' }, '%'),
                ),
              ),
              h('div', { className: 'dsh-ka-hint' }, t('battery.min')),
            ),
            h(
              'div',
              { className: 'dsh-ka-sec' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-ka-btn dsh-ka-btn-ghost',
                  style: { alignSelf: 'flex-start', fontWeight: 600 },
                  'aria-expanded': view.advanced ? 'true' : 'false',
                  onClick: () => store.set({ advanced: !view.advanced }),
                },
                `${view.advanced ? '▾' : '▸'} ${t('advanced')}`,
              ),
              advancedBody,
              h(
                'div',
                { className: 'dsh-ka-hint' },
                t('advanced.keeper', { state: status?.keeper?.available ? 'ok' : status?.keeper?.error || 'unavailable' }),
              ),
            ),
          ),
          h(
            'div',
            { className: 'dsh-ka-foot' },
            h('div', { className: 'dsh-ka-footline' }, h('span', null, powerLine), h('span', null, holdLine)),
            h(
              'div',
              { className: 'dsh-ka-footline' },
              h('span', null, pending ? t('busy') : t('hold.heartbeat', { time: clock(status?.hold?.heartbeatAt) })),
              h('span', null, t('footer.note')),
            ),
          ),
        )
      }

      function SidebarAction() {
        const view = useStore(store)
        const active = view.status?.hold?.active === true
        return h(
          'button',
          {
            type: 'button',
            className: 'dsh-ka-footerbtn',
            title: t('open'),
            'aria-label': t('open'),
            onClick: () => {
              const next = !store.get().open
              store.set({ open: next })
              if (next) {
                void refreshStatus(store)
                void refreshApps(store)
              }
            },
          },
          h('span', {
            style: {
              display: 'grid',
              placeItems: 'center',
              width: 20,
              height: 20,
              borderRadius: 6,
              background: active ? 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 22%, transparent)' : 'transparent',
            },
          }, h(Glyph, { size: 16, color: active ? 'var(--dsw-alias-state-success-primary)' : 'currentColor' })),
          h('span', null, t('title')),
        )
      }

      return { StartWindow, SidebarAction, t }
    }

    const store = createStore()

    return {
      inject: [],
      apply(ctx) {
        const view = createView(ctx, store)
        const slots = (() => {
          try {
            return ctx.get?.('slots')
          } catch {
            return undefined
          }
        })()

        const register = (owner, service, spec, component) => {
          owner.effect(() =>
            spec.name === 'shell.overlay'
              ? service.register({ name: spec.name, id: spec.id, order: spec.order }, () =>
                  h(React.Fragment, null, h('style', null, STYLE), h(component, null)),
                )
              : service.register(spec, component),
          )
        }

        const mount = (scope) => {
          const owner = scope && typeof scope.effect === 'function' ? scope : ctx
          const service = owner?.slots || (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || slots
          if (!service || typeof service.inject !== 'function') {
            console.warn('[keep-awake] slots service unavailable: window disabled')
            return
          }
          try {
            service.inject('shell.overlay', () =>
              register(owner, service, { name: 'shell.overlay', id: 'dsh-keep-awake-window', order: 90 }, view.StartWindow),
            )
            service.inject('sidebar.footer.action', () =>
              register(owner, service, { name: 'sidebar.footer.action', id: 'dsh-keep-awake-action', order: 20, label: () => view.t('title') }, view.SidebarAction),
            )
          } catch (error) {
            console.warn('[keep-awake] slot registration failed:', error)
          }
        }

        if (typeof ctx.inject === 'function') {
          try {
            ctx.inject(['slots'], (scope) => mount(scope))
            return
          } catch (error) {
            console.warn('[keep-awake] slots injection failed:', error)
          }
        }
        mount(ctx)
      },
    }
  },
})
