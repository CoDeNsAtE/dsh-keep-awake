/**
 * Host half of `dsh-keep-awake`.
 *
 * It owns the engine, a small JSON HTTP surface for the floating window, and a
 * `keep_awake` tool so the agent can keep long jobs running across a lid close.
 * Both callers funnel through `KeepAwakeEngine.act`, so a button in the window
 * and a tool call have exactly the same meaning.
 */

import os from 'node:os'
import path from 'node:path'
import { KeepAwakeEngine } from './lib/engine.js'
import { createProbe } from './lib/win-probe.js'
import { describe } from './lib/win32-power.js'

export const name = 'dsh-keep-awake'

// Revision marker: bumping it (or editing any line) asks the Host's HMR to
// reload this row, which also re-reads `lib/engine.js`.
const REVISION = 2

const ROUTE_ROOT = '/keep-awake'
const MAX_BODY_BYTES = 64 * 1024

/**
 * Build the JSON response helper for one route.
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} value
 */
function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/**
 * Read a JSON request body with a hard byte cap.
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<object>} parsed body, `{}` when empty.
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (text === '') {
        resolve({})
        return
      }
      try {
        const parsed = JSON.parse(text)
        resolve(parsed && typeof parsed === 'object' ? parsed : {})
      } catch (error) {
        reject(new Error(`invalid JSON body: ${describe(error)}`))
      }
    })
    req.on('error', reject)
  })
}

/**
 * Only this machine's browser may drive power state through these routes.
 * @param {import('node:http').IncomingMessage} req
 * @returns {boolean}
 */
function isLoopback(req) {
  const address = req.socket?.remoteAddress || ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/**
 * Lid-close action indexes as the agent reads them.
 */
const LID_WORDS = { 0: '不操作', 1: '睡眠', 2: '休眠', 3: '关机' }

/**
 * @param {unknown} value
 * @returns {string}
 */
function lidWord(value) {
  return typeof value === 'number' ? LID_WORDS[value] || `索引 ${value}` : '系统默认'
}

/**
 * @param {number} ms
 * @returns {string}
 */
function duration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟`
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
}

/**
 * Human-readable one-liner for the tool result.
 * @param {object} snapshot
 * @returns {string}
 */
function summarize(snapshot) {
  const state = snapshot.state
  const hold = snapshot.hold
  const env = snapshot.env || {}
  const mode = state.mode === 'always' ? '一直保持' : state.mode === 'apps' ? '按选中应用' : 'DSH 工作时'
  const parts = [hold.active ? `保活中（${mode}）` : `未保活（${mode}）`]
  if (hold.active && hold.since) parts.push(`已持续 ${duration(Date.now() - hold.since)}`)
  if (!state.enabled) parts.push('总开关关闭')
  const running = state.watch.filter((entry) => entry.running).map((entry) => entry.name)
  parts.push(running.length ? `运行中: ${running.join(', ')}` : `待命中: ${state.watch.map((entry) => entry.name).join(', ') || '(未选择应用)'}`)
  if (snapshot.power?.ac === false) {
    const floor = state.batteryFloor
    const guard = typeof floor === 'number' && floor > 0 ? `（≤${floor}% 自动停止）` : ''
    parts.push(`电池 ${snapshot.power.batteryPercent ?? '?'}%${guard}`)
  }
  if (env.available) {
    const ac = lidWord(env.lidAc)
    const dc = lidWord(env.lidDc)
    parts.push(`合盖动作: ${ac === dc ? ac : `交流 ${ac} / 电池 ${dc}`}`)
    if (env.lidNeedsRestore) parts.push('注意: 合盖动作仍是「不采取任何操作」，合盖不会睡眠（点恢复合盖睡眠）')
    if (env.pendingReboot) parts.push('现代待机: 已禁用，等重启生效')
    else if (env.modernStandbyDisabled) parts.push('现代待机: 已禁用')
    else if (env.modernStandby) parts.push('现代待机: 开启（合盖会被强制待机）')
  }
  if (snapshot.hold.reason?.code === 'unsupported') parts.push('此机器无法申请电源请求')
  const stop = snapshot.autoStop
  if (stop && typeof stop === 'object') {
    const how = stop.lidRestored ? '合盖睡眠已恢复' : '合盖动作未恢复，需手动恢复'
    parts.push(`电池保护已触发: 电量 ${stop.batteryPercent ?? '?'}% ≤ ${stop.floor ?? '?'}%，已自动停止（${how}）`)
  }
  if (snapshot.lastError) parts.push(`最近错误: ${snapshot.lastError}`)
  return parts.join(' · ')
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} config
 */
export function apply(ctx, config = {}) {
  const logger = {
    info: (...args) => console.log('[keep-awake]', ...args),
    warn: (...args) => console.warn('[keep-awake]', ...args),
  }
  const homeDir = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const engine = new KeepAwakeEngine({ homeDir, probe: createProbe(), logger })

  ctx.effect(() => () => engine.dispose())
  void engine.start().catch((error) => logger.warn(`engine start failed: ${describe(error)}`))

  // DSH activity drives mode `busy`; both events are plain global emits.
  ctx.on('api-session/status', (sessionId, running) => {
    engine.setSessionBusy(sessionId, running === true)
  })
  ctx.on('agent/status', (payload) => {
    const id = payload?.agent?.id
    if (typeof id === 'string') engine.setSessionBusy(id, payload?.status === 'running')
  })
  try {
    const agents = ctx.get?.('agents')
    for (const agent of agents?.list?.() || []) {
      if (agent?.status === 'running') engine.setSessionBusy(agent.id, true)
    }
  } catch {
    /* no registry yet: the status events will seed it. */
  }

  /**
   * Register one HTTP route, keeping the disposer on the owning scope.
   * @param {object} scope - injected scope (or ctx).
   * @param {object} webServer
   * @param {{path: string, method: string, handle: Function}} route
   */
  const addRoute = (scope, webServer, route) => {
    const handler = async (req, res) => {
      try {
        if (!isLoopback(req)) {
          sendJson(res, 403, { ok: false, error: 'local access only' })
          return
        }
        if (req.method !== route.method && !(route.method === 'GET' && req.method === 'HEAD')) {
          res.writeHead(405, { allow: route.method })
          res.end()
          return
        }
        await route.handle(req, res)
      } catch (error) {
        sendJson(res, 500, { ok: false, error: describe(error) })
      }
    }
    scope.effect(() => webServer.register({ kind: 'exact', path: `${ROUTE_ROOT}/${route.path}`, handler }))
  }

  const registerRoutes = (webServer, scope) => {
    if (!webServer || typeof webServer.register !== 'function') {
      logger.warn('no webServer service: the floating window cannot reach the host')
      return
    }
    addRoute(scope, webServer, {
      path: 'status',
      method: 'GET',
      handle: async (req, res) => {
        await engine.refresh()
        sendJson(res, 200, engine.snapshot())
      },
    })
    addRoute(scope, webServer, {
      path: 'action',
      method: 'POST',
      handle: async (req, res) => {
        const body = await readJsonBody(req)
        const result = await engine.act(body)
        sendJson(res, result.ok ? 200 : 400, result)
      },
    })
    addRoute(scope, webServer, {
      path: 'apps',
      method: 'GET',
      handle: async (req, res) => {
        const url = new URL(req.url || '/', 'http://local')
        const query = (url.searchParams.get('q') || '').trim().toLowerCase()
        const rows = await engine.probe.processes(true)
        const filtered = query === '' ? rows : rows.filter((row) => row.name.toLowerCase().includes(query) || row.title.toLowerCase().includes(query))
        sendJson(res, 200, { ok: true, apps: filtered.slice(0, 200) })
      },
    })
  }

  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['webServer'], (scope) => registerRoutes(scope?.webServer ?? ctx.get('webServer'), scope ?? ctx))
    } catch (error) {
      logger.warn(`webServer injection failed: ${describe(error)}`)
    }
  } else {
    registerRoutes(ctx.get?.('webServer'), ctx)
  }

  const tool = {
    name: 'keep_awake',
    description:
      'Keep this Windows machine (and every background app, such as VMware) running after the laptop lid closes, instead of entering Modern Standby. ' +
      'Actions: status, enable, disable, toggle, set-mode, watch-add, watch-remove, watch-toggle, set-display, lid-fix, lid-revert, modern-standby-disable, modern-standby-restore, refresh. ' +
      'Mode `always` holds while enabled; `apps` holds only while a watched process runs; `busy` holds while a DSH session runs a turn. ' +
      'The request is system-wide: watching an app only decides when the machine stays awake. ' +
      '`enable` also sets the lid-close action to “do nothing” and `disable` puts the recorded original action back, so a closed lid sleeps again once keep-awake is off. Both transitions are silent: they run through an elevated scheduled task (`DshKeepAwakeLid`) that one `lid-helper-install` call creates with a single administrator prompt, so flipping the switch never asks for permission. Without that task the switch still works and reports `lid:helper-missing` for the lid part. ' +
      'A battery guard stops keep-awake by itself: while running on battery, a charge at or below `batteryFloor` (default 30%, 0 disables it) releases the request and restores the lid action, silently. `set-battery-floor` changes the threshold, `dismiss-auto-stop` clears the notice. ' +
      '`lid-fix` rewrites the lid-close power action and raises one Windows administrator prompt. ' +
      '`modern-standby-disable` switches Modern Standby off in the registry so a closed lid can no longer suspend the machine; it also raises one administrator prompt and needs a reboot, and `modern-standby-restore` puts the recorded values back.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'status',
            'enable',
            'disable',
            'toggle',
            'set-mode',
            'set-display',
            'watch-add',
            'watch-remove',
            'watch-toggle',
            'lid-fix',
            'lid-revert',
            'lid-helper-install',
            'lid-helper-remove',
            'set-battery-floor',
            'dismiss-auto-stop',
            'modern-standby-disable',
            'modern-standby-restore',
            'refresh',
          ],
          description: 'Operation to perform.',
        },
        mode: { type: 'string', enum: ['always', 'apps', 'busy'], description: 'Hold policy for set-mode.' },
        name: { type: 'string', description: 'Process name (for example vmware-vmx) for watch-add, watch-remove, watch-toggle.' },
        enabled: { type: 'boolean', description: 'Explicit on/off for watch-toggle.' },
        preventDisplaySleep: { type: 'boolean', description: 'Also keep the display awake for set-display.' },
        batteryFloor: {
          type: 'integer',
          minimum: 0,
          maximum: 100,
          description: 'Battery percentage at or below which keep-awake stops on battery power; 0 turns the guard off (set-battery-floor).',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => {
        const text = value && typeof value === 'object' && typeof value.summary === 'string' ? value.summary : JSON.stringify(value)
        return [{ type: 'text', text }]
      },
    },
    async execute(args) {
      const result = await engine.act(args && typeof args === 'object' ? args : {})
      if (!result.ok) {
        return { ok: false, error: result.error || 'keep_awake failed', summary: `合盖保活操作失败：${result.error || 'unknown'}` }
      }
      const snapshot = result.snapshot || engine.snapshot()
      return {
        ok: true,
        summary: summarize(snapshot),
        state: {
          enabled: snapshot.state.enabled === true,
          mode: snapshot.state.mode,
          preventDisplaySleep: snapshot.state.preventDisplaySleep === true,
          batteryFloor: snapshot.state.batteryFloor ?? null,
          watch: snapshot.state.watch.map((entry) => ({ name: entry.name, enabled: entry.enabled === true, running: entry.running === true })),
        },
        hold: {
          active: snapshot.hold.active === true,
          display: snapshot.hold.display === true,
          since: snapshot.hold.since ?? null,
          reason: snapshot.hold.reason ?? { code: 'unknown' },
        },
        power: { ac: snapshot.power.ac, batteryPercent: snapshot.power.batteryPercent },
        env: {
          available: snapshot.env.available === true,
          lidAc: snapshot.env.lidAc ?? null,
          lidDc: snapshot.env.lidDc ?? null,
          modernStandby: snapshot.env.modernStandby === true,
          modernStandbyDisabled: snapshot.env.modernStandbyDisabled === true,
          pendingReboot: snapshot.env.pendingReboot === true,
          lidNeedsRestore: snapshot.env.lidNeedsRestore === true,
          lidHelper: snapshot.env.lidHelper === true,
        },
        autoStop: snapshot.autoStop
          ? {
              at: snapshot.autoStop.at ?? null,
              batteryPercent: snapshot.autoStop.batteryPercent ?? null,
              floor: snapshot.autoStop.floor ?? null,
              lidRestored: snapshot.autoStop.lidRestored === true,
              lidError: snapshot.autoStop.lidError ?? null,
            }
          : null,
        rebootRequired: result.rebootRequired === true,
        lid: result.lid ?? null,
        lastError: snapshot.lastError ?? null,
      }
    },
  }

  const registerTool = (tools, scope) => {
    if (!tools || typeof tools.register !== 'function') {
      logger.warn('no tools service: keep_awake tool not registered')
      return
    }
    scope.effect(() => tools.register(tool))
  }

  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['tools'], (scope) => registerTool(scope?.tools ?? ctx.get('tools'), scope ?? ctx))
    } catch (error) {
      logger.warn(`tools injection failed: ${describe(error)}`)
    }
  } else {
    registerTool(ctx.get?.('tools'), ctx)
  }

  logger.info(`ready (keeper ${engine.supported ? 'available' : 'unavailable'}, state ${engine.statePath})`)
}
