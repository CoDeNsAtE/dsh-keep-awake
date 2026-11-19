/**
 * Power-plan indexes written straight from the Host.
 *
 * Windows documents one rule that defeats every keep-awake app on Modern
 * Standby hardware running on battery: "On Modern Standby systems on DC power,
 * system and execution required power requests are terminated 5 minutes after
 * the system sleep timeout has expired" (PowerSetRequest). A finite
 * "sleep after" value therefore wins over any power request, which is exactly
 * the report this module exists for: with a duration the machine slept anyway,
 * with "never" it stayed up.
 *
 * The only lever that survives that rule is the timeout itself, so while the
 * request is held the engine writes 0 ("never") and puts the user's own value
 * back the moment it stops. The same module also writes the lid-close action,
 * because those two indexes live in the same place and a single `powercfg`
 * round is cheaper than two.
 *
 * These writes normally need administrator rights. On a build where the
 * interactive user may write the power scheme they succeed unelevated, which is
 * why every write is verified by reading the values back: when the readback
 * matches, the plugin can promise "silent, works on battery"; when it does not,
 * the caller falls back to the elevated helper task and finally to one UAC
 * prompt.
 */

import { execFile, execFileSync } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe } from './win32-power.js'

const execFileAsync = promisify(execFile)

/** Power-scheme registry root, as `reg.exe` spells it. */
const POWER_SCHEMES = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Power\\User\\PowerSchemes'
/** Subgroup and setting GUIDs the plugin reads and writes. */
export const SYSTEM_BUTTONS = '4f971e89-eebd-4455-a8de-9e59040e7347'
export const LID_ACTION = '5ca83367-6e45-459f-a27b-476b1d01c936'
export const SUB_SLEEP = '238c9fa8-0aad-41ed-83f4-97be242c8f20'
export const STANDBY_IDLE = '29f6c1db-86da-48c5-9fdb-f2b67b1f44da'
export const SUB_VIDEO = '7516b95f-f776-4464-8c53-06167f40cc99'
export const VIDEO_IDLE = '3c0bc021-c8a8-4e07-a973-6b14cbcb2b7e'

/** Which `powercfg` aliases turn a setting kind into one command pair. */
const WRITABLE = {
  lid: { sub: 'SUB_BUTTONS', setting: 'LIDACTION', group: SYSTEM_BUTTONS, key: LID_ACTION },
  standby: { sub: 'SUB_SLEEP', setting: 'STANDBYIDLE', group: SUB_SLEEP, key: STANDBY_IDLE },
  video: { sub: 'SUB_VIDEO', setting: 'VIDEOIDLE', group: SUB_VIDEO, key: VIDEO_IDLE },
}

/** @returns {string} absolute path of `reg.exe`. */
function regPath() {
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe')
}

/** @returns {string} absolute path of `powercfg.exe`. */
function powercfgPath() {
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'powercfg.exe')
}

/**
 * Run one command and return its stdout, or '' when it failed.
 * @param {string} file
 * @param {string[]} args
 * @param {number} [timeoutMs]
 * @returns {Promise<string>}
 */
async function run(file, args, timeoutMs = 8000) {
  try {
    const { stdout } = await execFileAsync(file, args, { windowsHide: true, timeout: timeoutMs, encoding: 'latin1' })
    return String(stdout || '')
  } catch {
    return ''
  }
}

/** @param {string} key @returns {Promise<string>} */
function regQuery(key) {
  return run(regPath(), ['query', key])
}

/** @param {string} text @param {string} name @returns {number|null} */
function parseDword(text, name) {
  const match = new RegExp(`${name}\\s+REG_DWORD\\s+0x([0-9a-fA-F]+)`).exec(text)
  return match ? Number.parseInt(match[1], 16) : null
}

/**
 * Read the AC and DC indexes of one power setting from the active scheme.
 * @param {string} scheme
 * @param {string} group
 * @param {string} key
 * @returns {Promise<{ac: number|null, dc: number|null}>}
 */
async function readIndexes(scheme, group, key) {
  const text = await regQuery(`${POWER_SCHEMES}\\${scheme}\\${group}\\${key}`)
  return { ac: parseDword(text, 'ACSettingIndex'), dc: parseDword(text, 'DCSettingIndex') }
}

/**
 * Read the active scheme's lid action and both sleep timeouts.
 *
 * `reg.exe` costs about 120 ms for the four calls, against roughly 1.5 s for
 * the full environment probe, which is why the switch path uses this and not
 * `environment()`.
 * @returns {Promise<{available: boolean, scheme?: string|null, lidAc?: number|null, lidDc?: number|null, standbyAc?: number|null, standbyDc?: number|null, videoAc?: number|null, videoDc?: number|null, error?: string}>}
 */
export async function readPlan() {
  const schemeText = await run(regPath(), ['query', POWER_SCHEMES, '/v', 'ActivePowerScheme'])
  const scheme = /REG_SZ\s+([0-9a-fA-F-]{36})/.exec(schemeText)?.[1] ?? null
  if (!scheme) return { available: false, error: 'cannot read the active power scheme' }
  const [lid, sleep, video] = await Promise.all([
    readIndexes(scheme, SYSTEM_BUTTONS, LID_ACTION),
    readIndexes(scheme, SUB_SLEEP, STANDBY_IDLE),
    readIndexes(scheme, SUB_VIDEO, VIDEO_IDLE),
  ])
  return {
    available: true,
    scheme,
    lidAc: lid.ac,
    lidDc: lid.dc,
    standbyAc: sleep.ac,
    standbyDc: sleep.dc,
    videoAc: video.ac,
    videoDc: video.dc,
  }
}

/**
 * `powercfg` calls that apply one request.
 * @param {{lid?: {ac?: number, dc?: number}, standby?: {ac?: number, dc?: number}, video?: {ac?: number, dc?: number}}} request
 * @returns {string[][]}
 */
function callsFor(request) {
  const calls = []
  for (const kind of Object.keys(WRITABLE)) {
    const want = request?.[kind]
    if (!want) continue
    const meta = WRITABLE[kind]
    if (typeof want.ac === 'number') {
      calls.push(['/setacvalueindex', 'SCHEME_CURRENT', meta.sub, meta.setting, String(want.ac)])
    }
    if (typeof want.dc === 'number') {
      calls.push(['/setdcvalueindex', 'SCHEME_CURRENT', meta.sub, meta.setting, String(want.dc)])
    }
  }
  return calls
}

/**
 * Compare the plan just read with what the request asked for.
 * @param {object} plan
 * @param {object} request
 * @returns {{ok: true} | {ok: false, error: string}}
 */
function verifyPlan(plan, request) {
  for (const kind of Object.keys(WRITABLE)) {
    const want = request?.[kind]
    if (!want) continue
    const acKey = `${kind}Ac`
    const dcKey = `${kind}Dc`
    if ((typeof want.ac === 'number' && plan[acKey] !== want.ac) || (typeof want.dc === 'number' && plan[dcKey] !== want.dc)) {
      return { ok: false, error: `${kind} readback ${plan[acKey]}/${plan[dcKey]}` }
    }
  }
  return { ok: true }
}

/**
 * Write lid and/or timeout indexes and verify them by reading them back.
 *
 * Every value is optional: `{ lid: { ac: 0, dc: 0 } }` only touches the
 * lid-close action, `{ standby: { ac: 0, dc: 0 } }` only the sleep timeout.
 * @param {{lid?: {ac: number, dc: number}, standby?: {ac: number, dc: number}, video?: {ac: number, dc: number}}} request
 * @returns {Promise<{ok: boolean, changed?: boolean, refused?: boolean, plan?: object, error?: string}>}
 */
export async function writePlan(request) {
  const calls = callsFor(request)
  if (calls.length === 0) return { ok: true, changed: false }
  try {
    const powercfg = powercfgPath()
    // `powercfg` prints nothing on success; when it is refused the readback
    // below is what notices, so the exit code does not have to be parsed.
    for (const args of calls) await run(powercfg, args)
    await run(powercfg, ['/setactive', 'SCHEME_CURRENT'])
    const plan = await readPlan()
    if (!plan.available) return { ok: false, refused: true, error: 'cannot read the power scheme back' }
    const check = verifyPlan(plan, request)
    if (!check.ok) return { ok: false, refused: true, plan, error: check.error }
    return { ok: true, changed: true, plan }
  } catch (error) {
    return { ok: false, error: describe(error) }
  }
}

/**
 * Same as {@link writePlan}, but blocking.
 *
 * `dispose()` needs it: the settings have to be back before the fiber — and
 * possibly the process — goes away, and an async chain would race that.
 * @param {object} request
 * @returns {{ok: boolean, changed?: boolean, refused?: boolean, plan?: object, error?: string}}
 */
export function writePlanSync(request) {
  const calls = callsFor(request)
  if (calls.length === 0) return { ok: true, changed: false }
  try {
    const powercfg = powercfgPath()
    for (const args of calls) execFileSync(powercfg, args, { windowsHide: true, timeout: 8000 })
    try {
      execFileSync(powercfg, ['/setactive', 'SCHEME_CURRENT'], { windowsHide: true, timeout: 8000 })
    } catch {
      /* activation is best effort; the values are already written */
    }
    const plan = readPlanSync()
    if (!plan.available) return { ok: false, refused: true, error: 'cannot read the power scheme back' }
    const check = verifyPlan(plan, request)
    if (!check.ok) return { ok: false, refused: true, plan, error: check.error }
    return { ok: true, changed: true, plan }
  } catch (error) {
    return { ok: false, error: describe(error) }
  }
}

/**
 * Blocking variant of {@link readPlan}.
 * @returns {object}
 */
export function readPlanSync() {
  let schemeText = ''
  try {
    schemeText = String(execFileSync(regPath(), ['query', POWER_SCHEMES, '/v', 'ActivePowerScheme'], { windowsHide: true, timeout: 8000, encoding: 'latin1' }) || '')
  } catch {
    return { available: false, error: 'cannot read the active power scheme' }
  }
  const scheme = /REG_SZ\s+([0-9a-fA-F-]{36})/.exec(schemeText)?.[1] ?? null
  if (!scheme) return { available: false, error: 'cannot read the active power scheme' }
  const readIndexesSync = (group, key) => {
    let text = ''
    try {
      text = String(
        execFileSync(regPath(), ['query', `${POWER_SCHEMES}\\${scheme}\\${group}\\${key}`], {
          windowsHide: true,
          timeout: 8000,
          encoding: 'latin1',
        }) || '',
      )
    } catch {
      text = ''
    }
    return { ac: parseDword(text, 'ACSettingIndex'), dc: parseDword(text, 'DCSettingIndex') }
  }
  const lid = readIndexesSync(SYSTEM_BUTTONS, LID_ACTION)
  const sleep = readIndexesSync(SUB_SLEEP, STANDBY_IDLE)
  const video = readIndexesSync(SUB_VIDEO, VIDEO_IDLE)
  return {
    available: true,
    scheme,
    lidAc: lid.ac,
    lidDc: lid.dc,
    standbyAc: sleep.ac,
    standbyDc: sleep.dc,
    videoAc: video.ac,
    videoDc: video.dc,
  }
}

/**
 * Render a "sleep after" value the way the window and log lines say it.
 * @param {number|null|undefined} seconds
 * @returns {string} `never`, `N s`, `N min` or `N h`.
 */
export function describeTimeout(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return 'never'
  if (seconds < 60) return `${seconds} s`
  if (seconds % 3600 === 0) return `${seconds / 3600} h`
  if (seconds % 60 === 0) return `${seconds / 60} min`
  return `${Math.round(seconds / 60)} min`
}
