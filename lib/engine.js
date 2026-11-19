/**
 * The keep-awake engine: owns the persisted wish, the process watch list, the
 * live power request, and the small set of actions the window and the agent
 * tool share.
 *
 * One rule shapes everything: the Windows power request is **system-wide**.
 * Ticking an app therefore never injects anything into that app — it decides
 * *when* the machine is kept awake, so every background process (the Harness,
 * VMware, a render) keeps running while the lid is shut.
 */

import { promises as fsp } from 'node:fs'
import fsSync from 'node:fs'
import path from 'node:path'
import { keeperCapability, readPowerStatus, setExecutionState, describe } from './win32-power.js'
import { createLidHelper } from './lid-helper.js'

const MODES = ['always', 'apps', 'busy']
const DEFAULT_WATCH = [{ name: 'vmware-vmx', enabled: true }, { name: 'vmware', enabled: true }]
const TICK_MS = 5000
const HEARTBEAT_MAX_BYTES = 256 * 1024
const DEFAULT_BATTERY_FLOOR = 30
const DEFAULT_GRACE_MS = 60000
const GRACE_MAX_MS = 300000

/**
 * Whether a running process satisfies one watch entry.
 * A trailing `*` makes the entry a prefix match, which is how one entry covers
 * a family such as `vmware-*`.
 * @param {string} entry - watched process name.
 * @param {string} processName - a running process name.
 * @returns {boolean}
 */
function nameMatches(entry, processName) {
  const wanted = entry.trim().toLowerCase()
  const actual = processName.toLowerCase()
  if (wanted === '') return false
  if (wanted.endsWith('*')) return actual.startsWith(wanted.slice(0, -1))
  return wanted === actual
}

/**
 * Sanitize a process name typed by a user or the agent.
 * @param {unknown} value
 * @returns {string} trimmed name, or '' when invalid.
 */
function cleanName(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > 120) return ''
  return trimmed.replace(/[\\/:?"<>|]/g, '')
}

export class KeepAwakeEngine {
  /**
   * @param {{homeDir: string, probe: object, logger: object, lidHelper?: object}} options
   */
  constructor({ homeDir, probe, logger, lidHelper }) {
    this.probe = probe
    this.logger = logger
    this.dir = path.join(homeDir, 'keep-awake')
    this.statePath = path.join(this.dir, 'state.json')
    this.heartbeatPath = path.join(this.dir, 'heartbeat.log')
    this.lidHelper = lidHelper || createLidHelper(homeDir, { logger })

    this.state = {
      enabled: false,
      mode: 'always',
      preventDisplaySleep: false,
      watch: DEFAULT_WATCH.map((entry) => ({ ...entry })),
      lidOriginal: null,
      sleepOriginal: null,
      videoOriginal: null,
      modernStandbyOriginal: null,
      batteryFloor: DEFAULT_BATTERY_FLOOR,
      graceMs: DEFAULT_GRACE_MS,
    }
    this.busySessions = new Set()
    this.backgroundJobs = 0
    this.backgroundLabels = []
    this.lastActiveAt = 0
    this.processes = []
    this.env = null
    this.ac = { ac: null, batteryPercent: null }
    this.hold = false
    this.holdDisplay = false
    this.holdSince = null
    this.holdReason = { code: 'disabled' }
    this.lastError = null
    this.lastAutoStop = null
    this.autoStopRunning = false
    this.lidSyncRunning = false
    this.planSyncRunning = false
    this.healedLeftovers = false
    this.lastTickAt = 0
    this.heartbeatAt = 0
    this.heartbeatCount = 0
    this.savedAt = 0
    this.timer = null
    this.ticking = false
    this.pendingSave = null
    this.disposed = false
    this.capability = keeperCapability()
  }

  /** @returns {boolean} whether this machine can hold a request at all. */
  get supported() {
    return process.platform === 'win32' && this.capability.available
  }

  /**
   * Load persisted state and start the tick loop.
   * @returns {Promise<void>}
   */
  async start() {
    await this.load()
    this.timer = setInterval(() => {
      void this.tick()
    }, TICK_MS)
    if (typeof this.timer.unref === 'function') this.timer.unref()
    await this.tick()
  }

  /** Stop the loop, release the request, and flush state. */
  dispose() {
    this.disposed = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.release()
    this.flushSave()
  }

  /**
   * Read the persisted wish file; a corrupt file falls back to defaults instead
   * of failing activation.
   * @returns {Promise<void>}
   */
  async load() {
    try {
      const raw = await fsp.readFile(this.statePath, 'utf8')
      const stored = JSON.parse(raw)
      if (typeof stored?.enabled === 'boolean') this.state.enabled = stored.enabled
      if (MODES.includes(stored?.mode)) this.state.mode = stored.mode
      if (typeof stored?.preventDisplaySleep === 'boolean') this.state.preventDisplaySleep = stored.preventDisplaySleep
      if (Array.isArray(stored?.watch)) {
        const watch = stored.watch
          .map((entry) => ({ name: cleanName(entry?.name), enabled: entry?.enabled !== false }))
          .filter((entry) => entry.name !== '')
        if (watch.length > 0 || stored.watch.length === 0) this.state.watch = watch
      }
      if (stored?.lidOriginal && typeof stored.lidOriginal.ac === 'number') {
        this.state.lidOriginal = { ac: stored.lidOriginal.ac, dc: stored.lidOriginal.dc ?? stored.lidOriginal.ac }
      }
      if (stored?.sleepOriginal && typeof stored.sleepOriginal.ac === 'number') {
        this.state.sleepOriginal = { ac: stored.sleepOriginal.ac, dc: stored.sleepOriginal.dc ?? stored.sleepOriginal.ac }
      }
      if (stored?.videoOriginal && typeof stored.videoOriginal.ac === 'number') {
        this.state.videoOriginal = { ac: stored.videoOriginal.ac, dc: stored.videoOriginal.dc ?? stored.videoOriginal.ac }
      }
      if (stored?.modernStandbyOriginal && typeof stored.modernStandbyOriginal === 'object') {
        const original = stored.modernStandbyOriginal
        const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
        this.state.modernStandbyOriginal = {
          platformAoAcOverride: num(original.platformAoAcOverride),
          csEnabled: num(original.csEnabled),
          modernSleepActions: num(original.modernSleepActions),
          awayModeEnabled: num(original.awayModeEnabled),
        }
      }
      if (typeof stored?.batteryFloor === 'number' && Number.isFinite(stored.batteryFloor)) {
        this.state.batteryFloor = Math.min(100, Math.max(0, Math.round(stored.batteryFloor)))
      }
      if (typeof stored?.graceMs === 'number' && Number.isFinite(stored.graceMs)) {
        this.state.graceMs = Math.min(GRACE_MAX_MS, Math.max(0, Math.round(stored.graceMs / 1000) * 1000))
      }
      if (stored?.lastAutoStop && typeof stored.lastAutoStop === 'object') {
        this.lastAutoStop = {
          at: typeof stored.lastAutoStop.at === 'number' ? stored.lastAutoStop.at : null,
          batteryPercent: typeof stored.lastAutoStop.batteryPercent === 'number' ? stored.lastAutoStop.batteryPercent : null,
          floor: typeof stored.lastAutoStop.floor === 'number' ? stored.lastAutoStop.floor : null,
          lidRestored: stored.lastAutoStop.lidRestored === true,
          lidError: typeof stored.lastAutoStop.lidError === 'string' ? stored.lastAutoStop.lidError : null,
          sleepRestored: stored.lastAutoStop.sleepRestored === true,
          sleepError: typeof stored.lastAutoStop.sleepError === 'string' ? stored.lastAutoStop.sleepError : null,
          videoRestored: stored.lastAutoStop.videoRestored === true,
          videoError: typeof stored.lastAutoStop.videoError === 'string' ? stored.lastAutoStop.videoError : null,
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') this.logger.warn(`state file unreadable, using defaults: ${describe(error)}`)
    }
  }

  /** Schedule one debounced write of the persisted wish. */
  save() {
    if (this.pendingSave) clearTimeout(this.pendingSave)
    this.pendingSave = setTimeout(() => {
      this.pendingSave = null
      this.flushSave()
    }, 250)
    if (typeof this.pendingSave.unref === 'function') this.pendingSave.unref()
  }

  /** Write the persisted wish now. */
  flushSave() {
    if (this.pendingSave) {
      clearTimeout(this.pendingSave)
      this.pendingSave = null
    }
    const body = JSON.stringify(
      {
        version: 1,
        enabled: this.state.enabled,
        mode: this.state.mode,
        preventDisplaySleep: this.state.preventDisplaySleep,
        watch: this.state.watch,
        lidOriginal: this.state.lidOriginal,
        sleepOriginal: this.state.sleepOriginal,
        videoOriginal: this.state.videoOriginal,
        modernStandbyOriginal: this.state.modernStandbyOriginal,
        batteryFloor: this.state.batteryFloor,
        graceMs: this.state.graceMs,
        lastAutoStop: this.lastAutoStop,
      },
      null,
      2,
    )
    // Synchronous on purpose: this also runs on dispose, where an async chain
    // would race process exit and lose the last switch the user flipped.
    try {
      fsSync.mkdirSync(this.dir, { recursive: true })
      fsSync.writeFileSync(this.statePath, body, 'utf8')
      this.savedAt = Date.now()
    } catch (error) {
      this.lastError = `cannot save state: ${describe(error)}`
      this.logger.warn(this.lastError)
    }
  }

  /**
   * Applies the request for a desired hold state; idempotent.
   * @param {boolean} want - hold a system request.
   * @param {boolean} display - also hold the display request.
   * @returns {void}
   */
  apply(want, display) {
    if (!want) {
      this.release()
      return
    }
    if (!this.supported) {
      this.holdReason = { code: 'unsupported' }
      return
    }
    if (this.hold && this.holdDisplay === display) return
    const result = setExecutionState({ system: true, display })
    if (!result.ok) {
      this.lastError = `power request refused: ${result.error}`
      this.hold = false
      this.holdDisplay = false
      this.holdSince = null
      this.holdReason = { code: 'error' }
      return
    }
    const was = this.hold
    this.hold = true
    this.holdDisplay = display
    if (!was) this.holdSince = Date.now()
  }

  /** Drop the request, if one is held. */
  release() {
    if (!this.hold) {
      this.holdDisplay = false
      return
    }
    setExecutionState({ system: false, display: false })
    this.hold = false
    this.holdDisplay = false
    this.holdSince = null
  }

  /**
   * Recompute the wish from state, watched processes, and DSH activity.
   * @returns {Promise<void>}
   */
  async tick() {
    if (this.ticking || this.disposed) return
    this.ticking = true
    try {
      if (!this.env || Date.now() - (this.env.at || 0) > 60000) {
        const env = await this.probe.environment()
        this.env = env.available ? { ...env, at: Date.now() } : { available: false, error: env.error, at: Date.now() }
      }
      const wantedProcesses = this.state.mode === 'apps'
      if (wantedProcesses || Date.now() - (this.processesAt || 0) > 15000) {
        this.processes = await this.probe.processes(wantedProcesses ? undefined : true)
        this.processesAt = Date.now()
      }
      const power = readPowerStatus()
      if (power.ac !== undefined) this.ac = { ac: power.ac, batteryPercent: power.batteryPercent }

      const running = this.runningWatched()
      const decision = this.decide(running)
      this.holdReason = decision.reason
      this.apply(decision.hold, this.state.preventDisplaySleep)
      // Windows ends power requests on its own (a user-initiated sleep entry, or
      // the Digital API / Modern Standby battery rule). Re-asserting every tick
      // keeps the live request and `this.hold` from drifting apart.
      if (decision.hold && this.hold) this.reassert()
      this.lastTickAt = Date.now()
      if (this.hold) this.writeHeartbeat()
      this.syncHoldExtras(decision.hold)
      const guard = this.batteryGuard()
      if (guard) void this.autoStopForBattery(guard)
    } catch (error) {
      this.lastError = describe(error)
    } finally {
      this.ticking = false
    }
  }

  /** Re-issue the live power request after Windows may have dropped it. */
  reassert() {
    const result = setExecutionState({ system: true, display: this.holdDisplay })
    if (result.ok) return
    this.hold = false
    this.holdDisplay = false
    this.lastError = `power request lost: ${result.error}`
  }

  /**
   * Keep the Windows power plan in step with the hold.
   *
   * A power request alone is not enough on this hardware. A closed lid still
   * sleeps the machine while the plan says "sleep when closed", and on battery
   * Windows ends system requests five minutes after the sleep timeout expires,
   * so a finite "sleep after" value outlives the request. Both are power-plan
   * indexes, so while the machine is held the plugin writes "do nothing" for
   * the lid and "never" for the sleep timeout, and puts the user's own values
   * back the moment it stops.
   * @param {boolean} holding
   */
  syncHoldExtras(holding) {
    if (this.planSyncRunning) return
    this.planSyncRunning = true
    void this.applyHoldExtras(holding)
      .catch((error) => this.logger.warn(`power plan sync failed: ${describe(error)}`))
      .finally(() => {
        this.planSyncRunning = false
      })
  }

  /**
   * The body of one sync pass. Prompt-free on purpose: this runs from the tick
   * loop, and a UAC dialog that appears while nobody is looking is not a
   * feature. Only the switch itself may ask.
   * @param {boolean} holding
   * @returns {Promise<void>}
   */
  async applyHoldExtras(holding) {
    if (this.state.enabled !== true) {
      // Switched off, or the Host restarted while it was off: put back anything
      // an earlier run left behind so a closed lid (and the idle timer) sleep
      // again. This is what heals a crashed session — but it runs only once per
      // start, so a deliberate manual override from the advanced row is not
      // reverted five seconds later.
      if (this.healedLeftovers) return
      this.healedLeftovers = true
      if (!this.lidIsOriginal()) await this.restoreLidForSleep({ allowPrompt: false })
      if (!this.sleepIsOriginal()) await this.restoreSleepForSleep({ allowPrompt: false })
      if (!this.videoIsOriginal()) await this.restoreVideoForSleep({ allowPrompt: false })
      return
    }
    if (holding) {
      await this.ensureLidForHold()
      await this.ensureSleepForHold()
      await this.ensureVideoForHold()
      return
    }
    if (!this.lidIsOriginal()) await this.restoreLidForSleep({ allowPrompt: false })
    if (!this.sleepIsOriginal()) await this.restoreSleepForSleep({ allowPrompt: false })
    if (!this.videoIsOriginal()) await this.restoreVideoForSleep({ allowPrompt: false })
  }

  /** @returns {boolean} whether the lid action already matches the recorded original. */
  lidIsOriginal() {
    const original = this.state.lidOriginal
    if (!original) return true
    const env = this.env || {}
    return env.lidAc === original.ac && env.lidDc === original.dc
  }

  /** @returns {boolean} whether the sleep timeouts already match the recorded originals. */
  sleepIsOriginal() {
    const original = this.state.sleepOriginal
    if (!original) return true
    const env = this.env || {}
    return env.standbyAc === original.ac && env.standbyDc === original.dc
  }

  /** @returns {boolean} whether the battery display timeout already matches the recorded value. */
  videoIsOriginal() {
    const original = this.state.videoOriginal
    if (!original) return true
    const env = this.env || {}
    return env.videoDc === original.dc
  }

  /**
   * Watched entries that are currently running.
   * @returns {Array<{name: string, processes: string[]}>}
   */
  runningWatched() {
    const seen = this.processes.map((row) => row.name)
    return this.state.watch
      .filter((entry) => entry.enabled)
      .map((entry) => ({ name: entry.name, processes: seen.filter((name) => nameMatches(entry.name, name)) }))
      .filter((entry) => entry.processes.length > 0)
  }

  /**
   * Pure decision from the current wish and live facts.
   * @param {Array<{name: string, processes: string[]}>} running
   * @returns {{hold: boolean, reason: object}}
   */
  decide(running) {
    if (!this.supported) return { hold: false, reason: { code: 'unsupported' } }
    if (!this.state.enabled) return { hold: false, reason: { code: 'disabled' } }
    if (this.state.mode === 'always') return { hold: true, reason: { code: 'always' } }
    if (this.state.mode === 'apps') {
      if (running.length > 0) {
        const names = [...new Set(running.flatMap((entry) => entry.processes))]
        return { hold: true, reason: { code: 'app-running', apps: names } }
      }
      return { hold: false, reason: { code: 'waiting-app' } }
    }
    if (this.state.mode === 'busy') {
      const activity = this.dshActivity()
      if (activity.total > 0) {
        return {
          hold: true,
          reason: {
            code: 'dsh-busy',
            count: activity.sessions,
            jobs: activity.jobs,
            apps: activity.jobs > 0 ? activity.labels : [],
          },
        }
      }
      // A turn ends before the work it started does: a background job keeps
      // running, a finished reply still needs its files written. Hold through a
      // short grace window instead of dropping the request the same second.
      const graceMs = this.graceRemaining()
      if (graceMs > 0) return { hold: true, reason: { code: 'grace', remainingMs: graceMs } }
      return { hold: false, reason: { code: 'waiting-dsh' } }
    }
    return { hold: false, reason: { code: 'waiting-dsh' } }
  }

  /**
   * What DSH is doing right now, from both activity sources.
   * @returns {{sessions: number, jobs: number, labels: string[], total: number}}
   */
  dshActivity() {
    const sessions = this.busySessions.size
    const jobs = this.backgroundJobs
    return { sessions, jobs, labels: this.backgroundLabels, total: sessions + jobs }
  }

  /**
   * How much of the grace window is left, in milliseconds.
   * @returns {number} 0 when the window is off or already over.
   */
  graceRemaining() {
    const graceMs = this.state.graceMs
    if (typeof graceMs !== 'number' || !Number.isFinite(graceMs) || graceMs <= 0) return 0
    if (!this.lastActiveAt) return 0
    return Math.max(0, this.lastActiveAt + graceMs - Date.now())
  }

  /**
   * The battery guard: while holding on battery, a charge at or below the floor
   * means this run must stop so the machine can sleep again.
   * @returns {{batteryPercent: number, floor: number}|null}
   */
  batteryGuard() {
    const floor = this.state.batteryFloor
    if (typeof floor !== 'number' || !Number.isFinite(floor) || floor <= 0) return null
    if (this.state.enabled !== true || this.hold !== true) return null
    if (this.ac.ac !== false) return null
    const percent = this.ac.batteryPercent
    if (typeof percent !== 'number' || !Number.isFinite(percent)) return null
    if (percent > floor) return null
    if (this.autoStopRunning) return null
    return { batteryPercent: percent, floor }
  }

  /**
   * Stop keep-awake because the battery ran low. Never prompts: the lid action
   * is restored through the silent helper, and when that helper is missing the
   * request is released anyway and the window shows what is left to do.
   * @param {{batteryPercent: number, floor: number}} guard
   * @returns {Promise<void>}
   */
  async autoStopForBattery(guard) {
    if (this.autoStopRunning) return
    this.autoStopRunning = true
    try {
      this.state.enabled = false
      this.holdReason = { code: 'battery-floor', batteryPercent: guard.batteryPercent, floor: guard.floor }
      this.save()
      this.flushSave()
      this.release()
      const lid = await this.restoreLidForSleep({ allowPrompt: false })
      const sleep = await this.restoreSleepForSleep({ allowPrompt: false })
      const video = await this.restoreVideoForSleep({ allowPrompt: false })
      this.lastAutoStop = {
        at: Date.now(),
        batteryPercent: guard.batteryPercent,
        floor: guard.floor,
        lidRestored: lid.applied === true,
        lidError: lid.error ?? null,
        sleepRestored: sleep.applied === true,
        sleepError: sleep.error ?? null,
        videoRestored: video.applied === true,
        videoError: video.error ?? null,
      }
      this.save()
      this.flushSave()
      this.logger.info(
        `auto-stopped: battery ${guard.batteryPercent}% <= floor ${guard.floor}% (lid restored: ${lid.applied === true}, sleep restored: ${sleep.applied === true}, display restored: ${video.applied === true})`,
      )
    } catch (error) {
      this.lastError = describe(error)
      this.logger.warn(`auto-stop failed: ${this.lastError}`)
    } finally {
      this.autoStopRunning = false
    }
  }

  /** Append one heartbeat line, trimming the file when it grows past its cap. */
  writeHeartbeat() {
    const now = new Date()
    this.heartbeatAt = now.getTime()
    this.heartbeatCount += 1
    const line = `${now.toISOString()} holding${this.holdDisplay ? '+display' : ''}\n`
    void fsp
      .mkdir(this.dir, { recursive: true })
      .then(() => fsp.appendFile(this.heartbeatPath, line, 'utf8'))
      .then(async () => {
        if (this.heartbeatCount % 120 !== 0) return
        const stat = await fsp.stat(this.heartbeatPath).catch(() => null)
        if (stat && stat.size > HEARTBEAT_MAX_BYTES) {
          const text = await fsp.readFile(this.heartbeatPath, 'utf8').catch(() => '')
          const kept = text.split('\n').slice(-600).join('\n')
          await fsp.writeFile(this.heartbeatPath, kept, 'utf8').catch(() => {})
        }
      })
      .catch(() => {})
  }

  /**
   * Record one session's running state (mode `busy`).
   * @param {string} sessionId
   * @param {boolean} running
   */
  setSessionBusy(sessionId, running) {
    if (typeof sessionId !== 'string' || sessionId === '') return
    if (running) {
      this.busySessions.add(sessionId)
      this.lastActiveAt = Date.now()
    } else {
      this.busySessions.delete(sessionId)
      if (this.busySessions.size === 0 && this.backgroundJobs === 0) this.lastActiveAt = Date.now()
    }
  }

  /**
   * Record background jobs (a `run_in_background` command, a background
   * subagent) that outlive the turn that started them.
   * @param {number} count - jobs still running or stopping.
   * @param {string[]} [labels] - a few labels, for the window and the tool summary.
   */
  setBackgroundActivity(count, labels = []) {
    const next = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
    if (next > this.backgroundJobs) this.lastActiveAt = Date.now()
    if (next === 0 && this.backgroundJobs > 0) this.lastActiveAt = Date.now()
    this.backgroundJobs = next
    this.backgroundLabels = next > 0 ? labels.filter((label) => typeof label === 'string').slice(0, 3) : []
  }

  /** @returns {object} the payload the window and the tool read. */
  snapshot() {
    const running = this.runningWatched()
    const env = this.env || {}
    return {
      ok: true,
      platform: process.platform,
      supported: this.supported,
      keeper: this.capability,
      state: {
        enabled: this.state.enabled,
        mode: this.state.mode,
        preventDisplaySleep: this.state.preventDisplaySleep,
        watch: this.state.watch.map((entry) => ({
          name: entry.name,
          enabled: entry.enabled,
          running: running.some((item) => item.name === entry.name),
        })),
        lidOriginal: this.state.lidOriginal,
        sleepOriginal: this.state.sleepOriginal,
        videoOriginal: this.state.videoOriginal,
        modernStandbyOriginal: this.state.modernStandbyOriginal,
        batteryFloor: this.state.batteryFloor,
        graceMs: this.state.graceMs,
      },
      hold: {
        active: this.hold,
        display: this.holdDisplay,
        since: this.holdSince,
        reason: this.holdReason,
        heartbeatAt: this.heartbeatAt,
      },
      power: { ac: this.ac.ac, batteryPercent: this.ac.batteryPercent },
      env: {
        available: env.available === true,
        error: env.available === true ? null : env.error ?? null,
        lidAc: env.lidAc ?? null,
        lidDc: env.lidDc ?? null,
        standbyAc: env.standbyAc ?? null,
        standbyDc: env.standbyDc ?? null,
        videoAc: env.videoAc ?? null,
        videoDc: env.videoDc ?? null,
        videoAc: env.videoAc ?? null,
        videoDc: env.videoDc ?? null,
        modernStandby: env.modernStandby === true,
        modernStandbyDisabled: env.modernStandbyDisabled === true,
        platformAoAcOverride: env.platformAoAcOverride ?? null,
        csEnabled: env.csEnabled ?? null,
        modernSleepActions: env.modernSleepActions ?? null,
        // Registry says "no Modern Standby" but the running kernel still reports
        // S0 low-power idle: the change is written and waiting for a reboot.
        pendingReboot: env.modernStandbyDisabled === true && env.modernStandby === true,
        // The switch is off (or the Harness restarted) while the lid action still
        // says "do nothing": the lid no longer sleeps until it is restored.
        lidNeedsRestore:
          this.state.enabled !== true &&
          this.state.lidOriginal !== null &&
          (env.lidAc === 0 || env.lidDc === 0),
        // Same story for the sleep timeout: "never" was written while holding and
        // the switch is off now, so the idle timer no longer puts it to sleep.
        sleepNeedsRestore:
          this.state.enabled !== true &&
          this.state.sleepOriginal !== null &&
          (env.standbyAc === 0 || env.standbyDc === 0),
        // Same for the battery display timeout, which is only borrowed while the
        // machine is held on battery power.
        videoNeedsRestore:
          this.state.enabled !== true && this.state.videoOriginal !== null && env.videoDc === 0,
        // The hidden machine-wide settings the hold currently owns, for the
        // "why is it awake" line in the window.
        holdPlan: {
          lid: env.lidAc === 0 && env.lidDc === 0,
          sleepNever: env.standbyAc === 0 && env.standbyDc === 0,
          displayHeld: env.videoDc === 0 && this.state.videoOriginal !== null,
          sleepOriginal: this.state.sleepOriginal,
          videoOriginal: this.state.videoOriginal,
        },
        // The silent helper task exists, so lid changes no longer ask for UAC.
        lidHelper: typeof this.lidHelper?.installed === 'function' && this.lidHelper.installed() === true,
        elevated: env.elevated === true,
        os: env.os ?? null,
      },
      busy: {
        sessions: this.busySessions.size,
        jobs: this.backgroundJobs,
        labels: this.backgroundLabels,
        graceMs: this.state.graceMs,
        graceRemainingMs: this.graceRemaining(),
        lastActiveAt: this.lastActiveAt || null,
      },
      autoStop: this.lastAutoStop,
      heartbeat: { count: this.heartbeatCount, at: this.heartbeatAt, path: this.heartbeatPath },
      lastError: this.lastError,
      lastTickAt: this.lastTickAt,
      updatedAt: Date.now(),
    }
  }

  /**
   * The single operation behind both the window's buttons and the agent tool.
   * @param {object} input - `{ action, ... }`.
   * @returns {Promise<{ok: boolean, message?: string, error?: string, snapshot?: object}>}
   */
  async act(input) {
    const action = typeof input?.action === 'string' ? input.action : ''
    try {
      switch (action) {
        case 'enable':
        case 'disable':
        case 'toggle': {
          const next = action === 'toggle' ? !this.state.enabled : action === 'enable'
          this.state.enabled = next
          if (next) this.lastAutoStop = null
          else this.lastActiveAt = 0
          this.save()
          await this.refresh()
          // The lid-close action and the "sleep after" timeout are machine-wide
          // settings, so they have to follow the switch: "do nothing" and "never"
          // while keeping awake, the user's original values the moment they
          // switch it off. All of it goes through the prompt-free routes, so
          // flipping the switch never raises a UAC prompt; when a machine refuses
          // the writes the switch still works and the window says what is left.
          const lid = next
            ? await this.ensureLidForHold()
            : await this.restoreLidForSleep({ allowPrompt: false })
          const sleep = next
            ? await this.ensureSleepForHold()
            : await this.restoreSleepForSleep({ allowPrompt: false })
          const video = next
            ? await this.ensureVideoForHold()
            : await this.restoreVideoForSleep({ allowPrompt: false })
          return this.result(next ? 'enabled' : 'disabled', { lid, sleep, video })
        }
        case 'set-mode': {
          const mode = typeof input.mode === 'string' ? input.mode : ''
          if (!MODES.includes(mode)) return { ok: false, error: `unknown mode: ${mode}` }
          this.state.mode = mode
          this.save()
          await this.refresh()
          return this.result(`mode:${mode}`)
        }
        case 'set-display': {
          this.state.preventDisplaySleep = input.preventDisplaySleep === true
          this.save()
          await this.refresh()
          return this.result(this.state.preventDisplaySleep ? 'display:on' : 'display:off')
        }
        case 'set-grace': {
          const raw = typeof input.graceSeconds === 'number' ? input.graceSeconds : input.graceMs
          const ms = typeof input.graceSeconds === 'number' ? input.graceSeconds * 1000 : raw
          if (typeof ms !== 'number' || !Number.isFinite(ms)) return { ok: false, error: 'grace period required' }
          this.state.graceMs = Math.min(GRACE_MAX_MS, Math.max(0, Math.round(ms / 1000) * 1000))
          this.save()
          await this.refresh()
          return this.result(`grace:${this.state.graceMs}`)
        }
        case 'watch-add': {
          const name = cleanName(input.name)
          if (name === '') return { ok: false, error: 'process name required' }
          if (!this.state.watch.some((entry) => entry.name.toLowerCase() === name.toLowerCase())) {
            this.state.watch.push({ name, enabled: true })
            this.save()
          }
          this.processesAt = 0
          await this.refresh()
          return this.result(`watch:add:${name}`)
        }
        case 'watch-remove': {
          const name = cleanName(input.name)
          if (name === '') return { ok: false, error: 'process name required' }
          this.state.watch = this.state.watch.filter((entry) => entry.name.toLowerCase() !== name.toLowerCase())
          this.save()
          await this.refresh()
          return this.result(`watch:remove:${name}`)
        }
        case 'watch-toggle': {
          const name = cleanName(input.name)
          const entry = this.state.watch.find((item) => item.name.toLowerCase() === name.toLowerCase())
          if (!entry) return { ok: false, error: `not watched: ${name}` }
          entry.enabled = input.enabled === undefined ? !entry.enabled : input.enabled === true
          this.save()
          await this.refresh()
          return this.result(`watch:${entry.enabled ? 'on' : 'off'}:${entry.name}`)
        }
        case 'refresh': {
          await this.refresh(true)
          return this.result('refreshed')
        }
        case 'lid-fix': {
          if (this.state.lidOriginal === null) {
            const now = await this.lidNow()
            if (now.available && (typeof now.lidAc === 'number' || typeof now.lidDc === 'number')) {
              this.state.lidOriginal = { ac: now.lidAc ?? 1, dc: now.lidDc ?? 1 }
              this.save()
              this.flushSave()
            }
          }
          const applied = await this.writePlan({ lid: { ac: 0, dc: 0 } }, { allowPrompt: true, label: 'lid' })
          if (!applied.applied) {
            return {
              ok: false,
              error: applied.denied ? 'elevation denied' : applied.error || 'lid settings unchanged',
            }
          }
          return this.result('lid:do-nothing')
        }
        case 'lid-revert': {
          const original = this.state.lidOriginal
          if (original === null) return { ok: false, error: 'no saved lid setting to restore' }
          const applied = await this.writePlan(
            { lid: { ac: original.ac, dc: original.dc } },
            { allowPrompt: true, label: 'lid' },
          )
          if (!applied.applied) {
            return {
              ok: false,
              error: applied.denied ? 'elevation denied' : applied.error || 'lid settings unchanged',
            }
          }
          this.state.lidOriginal = null
          this.save()
          this.flushSave()
          return this.result('lid:reverted')
        }
        case 'sleep-revert': {
          const original = this.state.sleepOriginal
          if (original === null && this.state.videoOriginal === null) {
            return { ok: false, error: 'no saved sleep timeout to restore' }
          }
          let applied = { applied: true }
          if (original !== null) {
            applied = await this.writePlan(
              { standby: { ac: original.ac, dc: original.dc } },
              { allowPrompt: true, label: 'sleep' },
            )
            if (!applied.applied) {
              return {
                ok: false,
                error: applied.denied ? 'elevation denied' : applied.error || 'sleep timeouts unchanged',
              }
            }
            this.state.sleepOriginal = null
            this.save()
            this.flushSave()
          }
          await this.restoreVideoForSleep({ allowPrompt: true })
          return this.result('sleep:reverted')
        }
        case 'modern-standby-disable': {
          const env = await this.probe.environment(true)
          if (!env.available) return { ok: false, error: env.error || 'power scheme unavailable' }
          if (this.state.modernStandbyOriginal === null) {
            const num = (value) => (typeof value === 'number' ? value : null)
            this.state.modernStandbyOriginal = {
              platformAoAcOverride: num(env.platformAoAcOverride),
              csEnabled: num(env.csEnabled),
              modernSleepActions: num(env.modernSleepActions),
              awayModeEnabled: num(env.awayModeEnabled),
            }
            this.save()
            this.flushSave()
          }
          const applied = await this.probe.applyModernStandby(true)
          if (!applied.ok) {
            return {
              ok: false,
              error: applied.denied ? 'elevation denied' : applied.error || 'registry unchanged',
            }
          }
          this.env = { ...(applied.environment || {}), at: Date.now() }
          return this.result('modern-standby:disabled', { rebootRequired: true })
        }
        case 'modern-standby-restore': {
          if (this.state.modernStandbyOriginal === null) {
            return { ok: false, error: 'no saved Modern Standby setting to restore' }
          }
          const applied = await this.probe.applyModernStandby(false, this.state.modernStandbyOriginal)
          if (!applied.ok) {
            return {
              ok: false,
              error: applied.denied ? 'elevation denied' : applied.error || 'registry unchanged',
            }
          }
          this.state.modernStandbyOriginal = null
          this.save()
          this.flushSave()
          const freshModern =
            applied.environment && typeof applied.environment === 'object'
              ? applied.environment
              : await this.probe.environment(true).catch(() => null)
          if (freshModern && freshModern.available !== false) this.env = { ...freshModern, at: Date.now() }
          return this.result('modern-standby:restored', { rebootRequired: true })
        }
        case 'set-battery-floor': {
          const raw = typeof input.batteryFloor === 'number' ? input.batteryFloor : Number(input.percent)
          if (!Number.isFinite(raw)) return { ok: false, error: 'batteryFloor must be a number between 0 and 100' }
          const floor = Math.min(100, Math.max(0, Math.round(raw)))
          this.state.batteryFloor = floor
          this.save()
          this.flushSave()
          await this.refresh()
          return this.result(`battery-floor:${floor}`)
        }
        case 'lid-helper-install': {
          const helper = await this.ensureLidHelper()
          if (!helper.installed) {
            return { ok: false, error: helper.denied ? 'elevation denied' : helper.error || 'scheduled task not created' }
          }
          await this.refresh()
          return this.result(helper.created ? 'lid-helper:installed' : 'lid-helper:already-installed')
        }
        case 'lid-helper-remove': {
          if (typeof this.lidHelper?.installed === 'function' && !this.lidHelper.installed()) {
            return this.result('lid-helper:absent')
          }
          const removed = await this.lidHelper.uninstall()
          if (!removed.ok) {
            return { ok: false, error: removed.denied ? 'elevation denied' : removed.error || 'scheduled task not removed' }
          }
          return this.result('lid-helper:removed')
        }
        case 'dismiss-auto-stop': {
          this.lastAutoStop = null
          this.save()
          this.flushSave()
          return this.result('auto-stop:dismissed')
        }
        case 'diagnostics': {
          const diag = await this.probe.diagnostics()
          return { ok: true, message: 'diagnostics', diagnostics: diag, snapshot: this.snapshot() }
        }
        case 'status':
          await this.refresh()
          return this.result('status')
        default:
          return { ok: false, error: `unknown action: ${action || '(none)'}` }
      }
    } catch (error) {
      this.lastError = describe(error)
      return { ok: false, error: this.lastError }
    }
  }

  /**
   * Make the lid-close action “do nothing” for as long as the switch is on.
   * Records the user's original values the first time and asks for administrator
   * rights once; a cancelled prompt leaves the machine exactly as it was.
   * @returns {Promise<{applied: boolean, changed: boolean, denied?: boolean, error?: string}>}
   */
  async ensureLidForHold() {
    try {
      const helperReady = typeof this.lidHelper?.installed === 'function' && this.lidHelper.installed() === true
      const env = this.env || {}
      // Already "do nothing" on both power sources: no probe and no write.
      if (env.lidAc === 0 && env.lidDc === 0) return { applied: true, changed: false, helper: helperReady }
      const now = await this.lidNow()
      if (!now.available) return { applied: false, changed: false, error: 'power scheme unavailable' }
      if (now.lidAc === 0 && now.lidDc === 0) {
        return { applied: true, changed: false, helper: helperReady }
      }
      if (this.state.lidOriginal === null) {
        this.state.lidOriginal = {
          ac: typeof now.lidAc === 'number' ? now.lidAc : 1,
          dc: typeof now.lidDc === 'number' ? now.lidDc : 1,
        }
        this.save()
        this.flushSave()
      }
      // Never prompt here: the switch flips instantly and the lid follows through
      // the silent helper. Without the helper the caller gets `lid:helper-missing`
      // and the window offers the one-time setup instead of an unexpected UAC.
      if (this.state.mode !== 'always' && this.hold !== true) {
        // `busy`/`apps` are idle right now: record the original action, but
        // leave the lid sleeping until there is actually work to protect.
        return { applied: true, changed: false, helper: helperReady, deferred: true }
      }
      const switched = await this.switchLid(0, 0, { allowPrompt: false })
      return { ...switched, helper: helperReady }
    } catch (error) {
      this.lastError = describe(error)
      return { applied: false, changed: false, error: this.lastError }
    }
  }

  /**
   * Read the current lid-close actions the cheap way.
   *
   * The switch only needs two registry values, so the 1.5 s environment probe
   * (PowerShell startup, sleep states) must not sit between the click and the
   * decision; it stays as the fallback for odd machines.
   * @returns {Promise<{available: boolean, lidAc?: number|null, lidDc?: number|null}>}
   */
  async lidNow() {
    try {
      if (typeof this.probe.lidActions === 'function') {
        const fast = await this.probe.lidActions()
        if (fast && fast.available) return fast
      }
    } catch (error) {
      this.logger?.warn?.(`lid read failed: ${describe(error)}`)
    }
    const env = await this.probe.environment(true)
    return { available: env.available !== false, lidAc: env.lidAc, lidDc: env.lidDc }
  }

  /**
   * Write already-known lid values into the cached environment.
   *
   * Keeps the window honest the instant a switch lands, instead of making it
   * wait for a fresh probe.
   * @param {number|null} lidAc
   * @param {number|null} lidDc
   */
  patchLid(lidAc, lidDc) {
    if (typeof lidAc !== 'number' && typeof lidDc !== 'number') return
    const base = this.env && typeof this.env === 'object' ? this.env : { available: true }
    this.env = {
      ...base,
      lidAc: typeof lidAc === 'number' ? lidAc : base.lidAc ?? null,
      lidDc: typeof lidDc === 'number' ? lidDc : base.lidDc ?? null,
      at: Date.now(),
    }
  }

  /**
   * Make sure the silent helper exists. Installing it is the one UAC prompt.
   * @returns {Promise<{installed: boolean, created: boolean, denied?: boolean, error?: string}>}
   */
  async ensureLidHelper() {
    try {
      if (typeof this.lidHelper?.installed === 'function' && this.lidHelper.installed()) {
        return { installed: true, created: false }
      }
      if (typeof this.lidHelper?.install !== 'function') return { installed: false, created: false }
      const result = await this.lidHelper.install()
      if (result.ok) return { installed: true, created: true }
      return { installed: false, created: false, denied: result.denied === true, error: result.error }
    } catch (error) {
      return { installed: false, created: false, error: describe(error) }
    }
  }

  /**
   * Write power-plan indexes, trying the prompt-free routes first.
   *
   * 1. `powercfg` from this process: instant, silent, works on battery, and the
   *    values are verified by a registry readback.
   * 2. The elevated helper task, for a machine whose power scheme is locked.
   * 3. One UAC prompt, only where the caller allows it (the switch itself).
   * @param {{lid?: {ac: number, dc: number}, standby?: {ac: number, dc: number}}} request
   * @param {{allowPrompt?: boolean, label?: string}} [options]
   * @returns {Promise<{applied: boolean, changed: boolean, silent?: boolean, direct?: boolean, denied?: boolean, error?: string}>}
   */
  async writePlan(request, { allowPrompt = true, label = 'power' } = {}) {
    try {
      if (typeof this.probe.writePlan === 'function') {
        const direct = await this.probe.writePlan(request)
        if (direct.ok) {
          this.patchPlan(direct.plan)
          return { applied: true, changed: direct.changed === true, silent: true, direct: true }
        }
        this.logger.warn(`${label}: direct power-plan write failed: ${direct.error || 'unknown'}`)
        this.lastError = `${label}:direct:${direct.error || 'failed'}`
      }
      if (typeof this.lidHelper?.installed === 'function' && this.lidHelper.installed() === true) {
        const silent = await this.lidHelper.apply(request)
        if (silent.ok) {
          this.patchPlan({
            lidAc: silent.lidAc,
            lidDc: silent.lidDc,
            standbyAc: silent.standbyAc,
            standbyDc: silent.standbyDc,
          })
          this.refreshEnvironmentSoon()
          return { applied: true, changed: true, silent: true, direct: false }
        }
        this.logger.warn(`${label}: silent power-plan write failed: ${silent.error || 'unknown'}`)
        this.lastError = `${label}:helper:${silent.error || 'failed'}`
        if (!allowPrompt) return { applied: false, changed: false, silent: true, error: this.lastError }
      }
      if (!allowPrompt) {
        this.lastError = `${label}:needs-admin`
        return { applied: false, changed: false, error: this.lastError }
      }
      const elevated = request.standby
        ? await this.probe.applyStandbyIdle(request.standby.ac, request.standby.dc)
        : await this.probe.applyLid(request.lid.ac, request.lid.dc)
      if (!elevated.ok) {
        this.lastError = elevated.denied ? `${label}:denied` : elevated.error || `${label}:unchanged`
        return { applied: false, changed: false, denied: elevated.denied === true, error: this.lastError }
      }
      const fresh = elevated.environment
      if (fresh && typeof fresh === 'object' && fresh.available !== false) this.env = { ...fresh, at: Date.now() }
      else this.refreshEnvironmentSoon()
      return { applied: true, changed: true, silent: false }
    } catch (error) {
      this.lastError = describe(error)
      return { applied: false, changed: false, error: this.lastError }
    }
  }

  /** Refresh the cached environment without making the caller wait for it. */
  refreshEnvironmentSoon() {
    void Promise.resolve()
      .then(() => this.probe.environment(true))
      .then((fresh) => {
        if (fresh && fresh.available !== false) this.env = { ...fresh, at: Date.now() }
      })
      .catch(() => {})
  }

  /**
   * Write already-known plan values into the cached environment.
   * @param {{lidAc?: number|null, lidDc?: number|null, standbyAc?: number|null, standbyDc?: number|null}} values
   */
  patchPlan(values) {
    const patch = {}
    for (const key of ['lidAc', 'lidDc', 'standbyAc', 'standbyDc', 'videoAc', 'videoDc']) {
      const value = values?.[key]
      if (typeof value === 'number' && Number.isFinite(value)) patch[key] = value
    }
    if (Object.keys(patch).length === 0) return
    const base = this.env && typeof this.env === 'object' ? this.env : { available: true }
    this.env = { ...base, ...patch, at: Date.now() }
  }

  /**
   * Apply one lid-close action.
   * @param {number} ac
   * @param {number} dc
   * @param {{allowPrompt?: boolean}} [options] - `false` for unattended paths.
   * @returns {Promise<object>}
   */
  async switchLid(ac, dc, options) {
    const out = await this.writePlan({ lid: { ac, dc } }, { ...options, label: 'lid' })
    if (out.applied) this.patchLid(ac, dc)
    return out
  }

  /**
   * Apply one pair of "sleep after" timeouts (0 = never).
   * @param {number} ac - seconds on AC.
   * @param {number} dc - seconds on battery.
   * @param {{allowPrompt?: boolean}} [options]
   * @returns {Promise<object>}
   */
  async switchSleep(ac, dc, options) {
    const out = await this.writePlan({ standby: { ac, dc } }, { ...options, label: 'sleep' })
    if (out.applied) this.patchPlan({ standbyAc: ac, standbyDc: dc })
    return out
  }

  /**
   * Make the idle sleep timer "never" for as long as the machine is held.
   *
   * On battery, Windows ends system power requests five minutes after the sleep
   * timeout expires (PowerSetRequest), so a finite "sleep after" value outlives
   * any request. Writing "never" removes the condition instead of fighting it,
   * and is the same configuration people find works when they set it by hand.
   * @returns {Promise<{applied: boolean, changed: boolean, deferred?: boolean, error?: string}>}
   */
  async ensureSleepForHold() {
    try {
      const env = this.env || {}
      if (env.standbyAc === 0 && env.standbyDc === 0) return { applied: true, changed: false }
      const now = await this.sleepNow()
      if (!now.available) return { applied: false, changed: false, error: 'power scheme unavailable' }
      const ac = typeof now.standbyAc === 'number' ? now.standbyAc : 0
      const dc = typeof now.standbyDc === 'number' ? now.standbyDc : 0
      if (ac === 0 && dc === 0) return { applied: true, changed: false }
      if (this.state.sleepOriginal === null) {
        this.state.sleepOriginal = { ac, dc }
        this.save()
        this.flushSave()
      }
      if (this.state.mode !== 'always' && this.hold !== true) {
        // Idle in `apps`/`busy`: remember the original, but do not touch the
        // user's sleep timeout until there is actually work to protect.
        return { applied: true, changed: false, deferred: true }
      }
      return await this.switchSleep(0, 0, { allowPrompt: false })
    } catch (error) {
      this.lastError = describe(error)
      return { applied: false, changed: false, error: this.lastError }
    }
  }

  /**
   * Put the recorded "sleep after" timeouts back.
   *
   * Only values this plugin wrote (0 = never) are reverted: if the user changed
   * one by hand meanwhile, their choice wins and stays.
   * @param {{allowPrompt?: boolean}} [options] - the battery guard passes `false`.
   * @returns {Promise<{applied: boolean, changed: boolean, silent?: boolean, denied?: boolean, error?: string}>}
   */
  async restoreSleepForSleep({ allowPrompt = true } = {}) {
    const original = this.state.sleepOriginal
    if (original === null) return { applied: true, changed: false }
    try {
      const now = await this.sleepNow()
      if (!now.available) return { applied: false, changed: false, error: 'power scheme unavailable' }
      const targetAc = now.standbyAc === 0 ? original.ac : now.standbyAc
      const targetDc = now.standbyDc === 0 ? original.dc : now.standbyDc
      if (targetAc === now.standbyAc && targetDc === now.standbyDc) {
        this.state.sleepOriginal = null
        this.save()
        this.flushSave()
        return { applied: true, changed: false }
      }
      const switched = await this.switchSleep(targetAc, targetDc, { allowPrompt })
      if (switched.applied) {
        this.state.sleepOriginal = null
        this.save()
        this.flushSave()
      }
      return switched
    } catch (error) {
      this.lastError = describe(error)
      return { applied: false, changed: false, error: this.lastError }
    }
  }

  /**
   * Read the power-plan indexes the cheap way: registry, no PowerShell.
   * @returns {Promise<{available: boolean, lidAc?: number|null, lidDc?: number|null, standbyAc?: number|null, standbyDc?: number|null, videoAc?: number|null, videoDc?: number|null}>}
   */
  async planNow() {
    try {
      if (typeof this.probe.plan === 'function') {
        const fast = await this.probe.plan()
        if (fast && fast.available) return fast
      }
    } catch (error) {
      this.logger?.warn?.(`power plan read failed: ${describe(error)}`)
    }
    const env = await this.probe.environment(true)
    return {
      available: env.available !== false,
      lidAc: env.lidAc ?? null,
      lidDc: env.lidDc ?? null,
      standbyAc: env.standbyAc ?? null,
      standbyDc: env.standbyDc ?? null,
      videoAc: env.videoAc ?? null,
      videoDc: env.videoDc ?? null,
    }
  }

  /**
   * Read the "sleep after" timeouts the cheap way.
   * @returns {Promise<object>}
   */
  async sleepNow() {
    return this.planNow()
  }

  /**
   * On battery, keep the display on while the machine is held.
   *
   * Modern Standby begins when the display turns off, and its first phase lets
   * power requests block that transition only "for up to 5 minutes on DC power"
   * (Prepare software for modern standby). With the screen dark, zeroing the
   * sleep timeout is therefore not enough on battery: the display timeout is
   * the one that has to give. On AC the request blocks that phase indefinitely,
   * so the screen may turn off as usual and the user's AC setting is left
   * alone.
   * @returns {Promise<{applied: boolean, changed: boolean, deferred?: boolean, error?: string}>}
   */
  async ensureVideoForHold() {
    try {
      if (this.ac.ac !== false) return { applied: true, changed: false }
      const env = this.env || {}
      if (env.videoDc === 0) return { applied: true, changed: false }
      const now = await this.planNow()
      if (!now.available) return { applied: false, changed: false, error: 'power scheme unavailable' }
      const dc = typeof now.videoDc === 'number' ? now.videoDc : 0
      if (dc === 0) return { applied: true, changed: false }
      if (this.state.videoOriginal === null) {
        this.state.videoOriginal = { ac: typeof now.videoAc === 'number' ? now.videoAc : 0, dc }
        this.save()
        this.flushSave()
      }
      if (this.state.mode !== 'always' && this.hold !== true) {
        return { applied: true, changed: false, deferred: true }
      }
      const out = await this.writePlan({ video: { dc: 0 } }, { allowPrompt: false, label: 'display' })
      if (out.applied) this.patchPlan({ videoDc: 0 })
      return out
    } catch (error) {
      this.lastError = describe(error)
      return { applied: false, changed: false, error: this.lastError }
    }
  }

  /**
   * Put the battery display timeout back.
   * @param {{allowPrompt?: boolean}} [options]
   * @returns {Promise<object>}
   */
  async restoreVideoForSleep({ allowPrompt = true } = {}) {
    const original = this.state.videoOriginal
    if (original === null) return { applied: true, changed: false }
    try {
      const now = await this.planNow()
      if (!now.available) return { applied: false, changed: false, error: 'power scheme unavailable' }
      const target = now.videoDc === 0 ? original.dc : now.videoDc
      if (target === now.videoDc) {
        this.state.videoOriginal = null
        this.save()
        this.flushSave()
        return { applied: true, changed: false }
      }
      const out = await this.writePlan({ video: { dc: target } }, { allowPrompt, label: 'display' })
      if (out.applied) {
        this.patchPlan({ videoDc: target })
        this.state.videoOriginal = null
        this.save()
        this.flushSave()
      }
      return out
    } catch (error) {
      this.lastError = describe(error)
      return { applied: false, changed: false, error: this.lastError }
    }
  }

  /**
   * Put the lid-close action back to the recorded original so closing the lid
   * sleeps (and locks) the machine again. No-op when nothing was ever changed.
   * @param {{allowPrompt?: boolean}} [options] - the battery guard passes `false`.
   * @returns {Promise<{applied: boolean, changed: boolean, silent?: boolean, denied?: boolean, error?: string}>}
   */
  async restoreLidForSleep({ allowPrompt = true } = {}) {
    const original = this.state.lidOriginal
    if (original === null) return { applied: true, changed: false }
    try {
      const now = await this.lidNow()
      if (now.available && now.lidAc === original.ac && now.lidDc === original.dc) {
        return { applied: true, changed: false }
      }
      return await this.switchLid(original.ac, original.dc, { allowPrompt })
    } catch (error) {
      this.lastError = describe(error)
      return { applied: false, changed: false, error: this.lastError }
    }
  }

  /**
   * Force a fresh evaluation; used by actions so the UI never shows stale facts.
   * @param {boolean} [force] - bypass the probe caches.
   * @returns {Promise<void>}
   */
  async refresh(force = false) {
    if (force) {
      this.env = null
      this.processesAt = 0
    }
    await this.tick()
  }

  /**
   * Wrap a successful action into the shared envelope.
   * @param {string} message
   * @param {object} [extra] - additional flags, such as `rebootRequired`.
   * @returns {{ok: true, message: string, snapshot: object}}
   */
  result(message, extra = {}) {
    return { ok: true, message, snapshot: this.snapshot(), ...extra }
  }
}
