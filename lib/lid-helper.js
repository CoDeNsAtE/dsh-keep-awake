/**
 * Silent lid-close switching.
 *
 * The lid-close action lives in HKLM, so changing it normally costs one UAC
 * prompt. A battery guard that stops keep-awake on its own cannot ask the user
 * for anything, so this module installs one elevated scheduled task (the only
 * prompt, once) and afterwards lets the plugin request a change by writing a
 * small JSON file and running the task: the request is served with the task's
 * administrator token, and the outcome comes back through a result file.
 */

import { execFile, execFileSync } from 'node:child_process'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe } from './win32-power.js'
import { runElevated } from './win-probe.js'

const execFileAsync = promisify(execFile)

/** Task name registered once, then reused for every silent switch. */
export const LID_TASK_NAME = 'DshKeepAwakeLid'

const SYSTEM_BUTTONS = '4f971e89-eebd-4455-a8de-9e59040e7347'
const LID_ACTION = '5ca83367-6e45-459f-a27b-476b1d01c936'
const INSTALL_CACHE_MS = 30000
const POLL_MS = 80
const APPLY_TIMEOUT_MS = 20000

/** @param {number} ms @returns {Promise<void>} */
function sleep(ms) {
  // Deliberately not unref'd: a pending poll has to keep the process alive, and a
  // 150 ms timer costs nothing while the switch is in flight.
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** @param {string} value @returns {string} a single-quoted PowerShell literal. */
function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

/**
 * Body of the script the scheduled task runs. It reads the request, rewrites
 * both lid-close indexes, verifies the registry, and writes the result.
 * @param {{request: string, result: string}} files
 * @returns {string}
 */
function scriptBody(files) {
  return [
    '$ErrorActionPreference = "Stop"',
    '[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)',
    `$request = Get-Content -Raw -LiteralPath ${psQuote(files.request)} | ConvertFrom-Json`,
    '$wantAc = [int]$request.ac',
    '$wantDc = [int]$request.dc',
    '$readAc = $null',
    '$readDc = $null',
    '$ok = $false',
    '$errorText = $null',
    'try {',
    `  powercfg /attributes SUB_BUTTONS ${SYSTEM_BUTTONS} -ATTRIB_HIDE | Out-Null`,
    `  powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS ${LID_ACTION} $wantAc | Out-Null`,
    `  powercfg /setdcvalueindex SCHEME_CURRENT SUB_BUTTONS ${LID_ACTION} $wantDc | Out-Null`,
    '  powercfg /setactive SCHEME_CURRENT | Out-Null',
    '  $scheme = (Get-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Power\\User\\PowerSchemes" -Name ActivePowerScheme).ActivePowerScheme',
    `  $key = "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Power\\User\\PowerSchemes\\$scheme\\${SYSTEM_BUTTONS}\\${LID_ACTION}"`,
    '  $stored = Get-ItemProperty -Path $key',
    '  $readAc = [int]$stored.ACSettingIndex',
    '  $readDc = [int]$stored.DCSettingIndex',
    '  $ok = ($readAc -eq $wantAc -and $readDc -eq $wantDc)',
    '  if (-not $ok) { $errorText = "readback " + $readAc + "/" + $readDc }',
    '} catch { $errorText = $_.Exception.Message }',
    '$payload = [ordered]@{',
    '  at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()',
    '  requestAt = [int64]$request.at',
    '  ok = $ok',
    '  lidAc = $readAc',
    '  lidDc = $readDc',
    '  error = $errorText',
    '}',
    '$json = $payload | ConvertTo-Json',
    `[IO.File]::WriteAllText(${psQuote(files.result)}, $json, (New-Object Text.UTF8Encoding($false)))`,
    '',
  ].join('\r\n')
}

/**
 * Build the silent lid helper bound to one Harness home directory.
 * @param {string} homeDir - usually `DSH_HOME`.
 * @param {{logger?: object}} [options]
 * @returns {{installed: (force?: boolean) => boolean, install: () => Promise<object>, uninstall: () => Promise<object>, apply: (ac: number, dc: number, timeoutMs?: number) => Promise<object>, files: object}}
 */
export function createLidHelper(homeDir, { logger } = {}) {
  const dir = path.join(homeDir, 'keep-awake')
  const files = {
    script: path.join(dir, 'lid-apply.ps1'),
    request: path.join(dir, 'lid-request.json'),
    result: path.join(dir, 'lid-result.json'),
  }
  let cache = { at: 0, value: false, known: false }
  let scriptReady = false
  let queue = Promise.resolve()
  let rechecking = null

  /** Ask Task Scheduler whether the helper task exists. */
  function queryTask() {
    try {
      execFileSync('schtasks.exe', ['/query', '/tn', LID_TASK_NAME], {
        windowsHide: true,
        timeout: 10000,
        stdio: 'ignore',
      })
      return true
    } catch {
      return false
    }
  }

  /** Same question, without blocking the event loop. */
  function queryTaskAsync() {
    if (rechecking) return rechecking
    rechecking = execFileAsync('schtasks.exe', ['/query', '/tn', LID_TASK_NAME], {
      windowsHide: true,
      timeout: 10000,
    })
      .then(
        () => true,
        () => false,
      )
      .then((value) => {
        cache = { at: Date.now(), value, known: true }
        return value
      })
      .finally(() => {
        rechecking = null
      })
    return rechecking
  }

  /**
   * Whether the helper task exists.
   *
   * The cached answer is returned immediately even when it is old — the UI asks
   * on every status poll, and a synchronous `schtasks` call there stalled the
   * whole Host. A stale entry schedules a background re-check instead.
   * @param {boolean} [force] - block until the answer is fresh.
   */
  function installed(force = false) {
    if (force) {
      const value = queryTask()
      cache = { at: Date.now(), value, known: true }
      return value
    }
    if (!cache.known) {
      const value = queryTask()
      cache = { at: Date.now(), value, known: true }
      return value
    }
    if (Date.now() - cache.at > INSTALL_CACHE_MS) void queryTaskAsync()
    return cache.value
  }

  /** Write (or refresh) the helper script. */
  async function ensureScript() {
    if (scriptReady) return
    const body = scriptBody(files)
    await fsp.mkdir(dir, { recursive: true })
    let current = ''
    try {
      current = await fsp.readFile(files.script, 'utf8')
    } catch {
      current = ''
    }
    if (current !== body) await fsp.writeFile(files.script, body, 'utf8')
    scriptReady = true
  }

  /**
   * Create the scheduled task. This is the one and only UAC prompt; once it is
   * accepted, every later lid change runs without asking anything.
   * @returns {Promise<{ok: boolean, denied?: boolean, error?: string}>}
   */
  async function install() {
    try {
      await ensureScript()
      const result = await runElevated([
        `$tr = 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${files.script}"'`,
        `schtasks.exe /create /tn '${LID_TASK_NAME}' /tr $tr /sc once /st 00:00 /rl HIGHEST /f | Out-Null`,
        'if ($LASTEXITCODE -ne 0) { throw "schtasks create failed with exit code $LASTEXITCODE" }',
      ])
      cache = { at: Date.now(), value: false }
      const ready = result.ok && installed(true)
      if (!ready && logger) logger.warn(`lid helper install failed: ${result.error || 'task not found'}`)
      return { ok: ready, denied: result.denied === true, error: result.error }
    } catch (error) {
      return { ok: false, error: describe(error) }
    }
  }

  /**
   * Remove the scheduled task (the helper script and JSON files stay behind).
   * @returns {Promise<{ok: boolean, denied?: boolean, error?: string}>}
   */
  async function uninstall() {
    try {
      const result = await runElevated([
        `schtasks.exe /delete /tn '${LID_TASK_NAME}' /f | Out-Null`,
        'if ($LASTEXITCODE -ne 0) { throw "schtasks delete failed with exit code $LASTEXITCODE" }',
      ])
      cache = { at: Date.now(), value: false }
      return { ok: result.ok === true, denied: result.denied === true, error: result.error }
    } catch (error) {
      return { ok: false, error: describe(error) }
    }
  }

  /** @returns {Promise<object|null>} the last result file, when readable. */
  async function readResult() {
    try {
      const text = await fsp.readFile(files.result, 'utf8')
      // PowerShell 5.1 may still add a BOM when other code writes this file.
      const parsed = JSON.parse(text.replace(/^\uFEFF/, ''))
      return parsed && typeof parsed === 'object' ? parsed : null
    } catch {
      return null
    }
  }

  /**
   * Run one switch: write the request, start the task, wait for its result.
   * @param {number} ac
   * @param {number} dc
   * @param {number} [timeoutMs]
   * @returns {Promise<{ok: boolean, lidAc: number|null, lidDc: number|null, error: string|null}>}
   */
  async function doApply(ac, dc, timeoutMs = APPLY_TIMEOUT_MS) {
    if (!installed()) return { ok: false, lidAc: null, lidDc: null, error: 'lid helper is not installed' }
    await ensureScript()
    const at = Date.now()
    await fsp.mkdir(dir, { recursive: true })
    await fsp.writeFile(files.request, JSON.stringify({ at, ac, dc }), 'utf8')
    try {
      await execFileAsync('schtasks.exe', ['/run', '/tn', LID_TASK_NAME], {
        windowsHide: true,
        timeout: 15000,
        encoding: 'utf8',
      })
    } catch (error) {
      return { ok: false, lidAc: null, lidDc: null, error: `cannot start lid task: ${describe(error)}` }
    }
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const result = await readResult()
      if (result && Number(result.requestAt) === at) {
        return {
          ok: result.ok === true,
          lidAc: typeof result.lidAc === 'number' ? result.lidAc : null,
          lidDc: typeof result.lidDc === 'number' ? result.lidDc : null,
          error: typeof result.error === 'string' && result.error !== '' ? result.error : null,
        }
      }
      await sleep(POLL_MS)
    }
    return { ok: false, lidAc: null, lidDc: null, error: 'lid task timed out' }
  }

  /**
   * Serialized so two callers (the switch and the battery guard) cannot race.
   * @param {number} ac
   * @param {number} dc
   * @param {number} [timeoutMs]
   * @returns {Promise<{ok: boolean, lidAc: number|null, lidDc: number|null, error: string|null}>}
   */
  function apply(ac, dc, timeoutMs) {
    const next = queue.then(() => doApply(ac, dc, timeoutMs))
    queue = next.catch(() => {})
    return next
  }

  return { installed, install, uninstall, apply, files }
}
