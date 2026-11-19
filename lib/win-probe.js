/**
 * Windows probes and the one elevated repair this plugin offers.
 *
 * Everything here reads machine state with built-in tools (`powercfg`,
 * registry, `Get-Process`) so the bundle needs no native addon and no build
 * step. The only mutating call is `applyLid`, which raises one UAC prompt and
 * rewrites the two lid-close power-setting indexes.
 */

import { execFile } from 'node:child_process'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, runAsWait } from './win32-power.js'
import { readPlan, readPlanSync, writePlan, writePlanSync, SUB_SLEEP, STANDBY_IDLE, SUB_VIDEO, VIDEO_IDLE } from './power-plan.js'

const execFileAsync = promisify(execFile)

const SYSTEM_BUTTONS = '4f971e89-eebd-4455-a8de-9e59040e7347'
const LID_ACTION = '5ca83367-6e45-459f-a27b-476b1d01c936'

/** Lid-close action indexes as Windows stores them. */
export const LID_ACTIONS = {
  0: 'do-nothing',
  1: 'sleep',
  2: 'hibernate',
  3: 'shutdown',
}

/**
 * Absolute path of the Windows PowerShell that every probe uses.
 * @returns {string}
 */
function powershellPath() {
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows'
  return path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

/**
 * Run one PowerShell script with UTF-8 output and no profile.
 * @param {string} script - script body; no quoting needed because it is encoded.
 * @param {number} [timeoutMs]
 * @returns {Promise<{stdout: string, stderr: string, code: number}>}
 */
async function runPowerShell(script, timeoutMs = 20000) {
  const preamble = [
    '$ProgressPreference = "SilentlyContinue"',
    '[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)',
    '[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)',
    '$ErrorActionPreference = "SilentlyContinue"',
  ].join('\n')
  const encoded = Buffer.from(`${preamble}\n${script}`, 'utf16le').toString('base64')
  const file = powershellPath()
  try {
    const { stdout, stderr } = await execFileAsync(
      file,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
    )
    return { stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code: 0 }
  } catch (error) {
    return {
      stdout: String(error?.stdout ?? ''),
      stderr: String(error?.stderr ?? '') || describe(error),
      code: typeof error?.code === 'number' ? error.code : 1,
    }
  }
}

/**
 * Parse the single JSON value a probe script prints, tolerating warnings.
 * @param {string} text
 * @returns {any} parsed value, or `undefined`.
 */
function parseJson(text) {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return undefined
  const first = trimmed.indexOf('{')
  const firstArray = trimmed.indexOf('[')
  const start = first === -1 ? firstArray : firstArray === -1 ? first : Math.min(first, firstArray)
  if (start === -1) return undefined
  const candidate = trimmed.slice(start)
  try {
    return JSON.parse(candidate)
  } catch {
    const last = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'))
    if (last <= 0) return undefined
    try {
      return JSON.parse(candidate.slice(0, last + 1))
    } catch {
      return undefined
    }
  }
}

/**
 * Run one script body elevated: exactly one UAC prompt, no console window.
 * Shared with the silent lid helper, which uses it to register its task.
 * @param {string[]} lines - script lines, run with `$ErrorActionPreference = 'Stop'`.
 * @param {number} [timeoutMs]
 * @returns {Promise<{ok: boolean, denied?: boolean, error?: string}>}
 */
export async function runElevated(lines, timeoutMs = 120000) {
  const scriptPath = path.join(os.tmpdir(), `dsh-keep-awake-${process.pid}-${Date.now()}.ps1`)
  const body = [
    '$ProgressPreference = "SilentlyContinue"',
    '[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)',
    '$ErrorActionPreference = "Stop"',
    ...lines,
    'exit 0',
  ].join('\r\n')
  try {
    await fsp.writeFile(scriptPath, body, 'utf8')
  } catch (error) {
    return { ok: false, error: `cannot write elevation script: ${describe(error)}` }
  }
  // Fast path: ask the shell for elevation directly. The UAC dialog shows up
  // as soon as the shell raises it, instead of after a throwaway PowerShell
  // process has finished booting.
  const quoted = `-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${scriptPath}"`
  const direct = runAsWait(powershellPath(), quoted, { timeoutMs })
  if (direct.ok || direct.denied === true) {
    try {
      await fsp.unlink(scriptPath)
    } catch {
      /* the elevated child already ran; a stale temp script is harmless. */
    }
    if (direct.ok) {
      if (direct.code === 0) return { ok: true }
      return { ok: false, error: `elevated script exited with ${direct.code}` }
    }
    return { ok: false, denied: true, error: direct.error }
  }
  // Anything else (no FFI, a shell quirk, a timeout) falls through to the old
  // two-step launcher, which is slower but works on every build.
  const launcher = `
$ErrorActionPreference = 'Stop'
$exe = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'
$arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', '${scriptPath.replace(/\\/g, '\\\\').replace(/'/g, "''")}')
$p = Start-Process -FilePath $exe -ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -Wait -PassThru
"exit=$($p.ExitCode)"
`
  const result = await runPowerShell(launcher, timeoutMs)
  try {
    await fsp.unlink(scriptPath)
  } catch {
    /* the elevated child already ran; a stale temp script is harmless. */
  }
  const combined = `${result.stdout}\n${result.stderr}`.trim()
  if (/canceled by the user|取消/i.test(combined)) {
    return { ok: false, denied: true, error: combined }
  }
  if (/exit=0/.test(result.stdout) && result.code === 0) return { ok: true }
  return { ok: false, error: combined || 'elevation failed' }
}

const POWER_SCHEMES = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Power\\User\\PowerSchemes'

/** `powercfg /a` is slow, and the sleep model never changes at runtime. */
let sleepModelCache = null
let sleepModelAt = 0
let sleepModelPending = null

/**
 * Read the available sleep states once and keep them for ten minutes.
 * @param {boolean} [force] - ignore the cache.
 * @returns {Promise<{text: string, modernStandby: boolean}>} never rejects.
 */
function sleepModel(force = false) {
  const now = Date.now()
  if (!force && sleepModelCache && now - sleepModelAt < 600000) return sleepModelCache
  if (sleepModelPending) return sleepModelPending
  sleepModelPending = execFileAsync('powercfg.exe', ['/a'], { windowsHide: true, timeout: 8000, encoding: 'latin1' })
    .then(({ stdout }) => {
      const text = String(stdout || '').replace(/\r/g, '').trim()
      const value = { text, modernStandby: /S0/i.test(text) }
      sleepModelCache = value
      sleepModelAt = Date.now()
      return value
    })
    .catch(() => sleepModelCache || { text: '', modernStandby: false })
    .finally(() => {
      sleepModelPending = null
    })
  return sleepModelPending
}

/**
 * Read the two lid-close actions straight from the registry.
 *
 * Two `reg.exe` calls cost roughly 60 ms together, against the ~1.5 s of a
 * full environment probe; the switch path needs this value before it can
 * decide whether anything has to change at all.
 * @returns {Promise<{available: boolean, scheme?: string|null, lidAc?: number|null, lidDc?: number|null, error?: string}>}
 */
export async function lidActions() {
  const reg = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe')
  const query = async (args) => {
    try {
      const { stdout } = await execFileAsync(reg, args, { windowsHide: true, timeout: 5000, encoding: 'latin1' })
      return String(stdout || '')
    } catch {
      return ''
    }
  }
  const schemeOut = await query(['query', POWER_SCHEMES, '/v', 'ActivePowerScheme'])
  const scheme = /REG_SZ\s+([0-9a-fA-F-]{36})/.exec(schemeOut)?.[1] ?? null
  if (!scheme) return { available: false, error: 'cannot read the active power scheme' }
  const key = `${POWER_SCHEMES}\\${scheme}\\${SYSTEM_BUTTONS}\\${LID_ACTION}`
  const lidOut = await query(['query', key])
  const ac = /ACSettingIndex\s+REG_DWORD\s+0x([0-9a-fA-F]+)/.exec(lidOut)
  const dc = /DCSettingIndex\s+REG_DWORD\s+0x([0-9a-fA-F]+)/.exec(lidOut)
  if (!ac && !dc) return { available: false, error: 'cannot read the lid-close action' }
  return {
    available: true,
    scheme,
    lidAc: ac ? Number.parseInt(ac[1], 16) : null,
    lidDc: dc ? Number.parseInt(dc[1], 16) : null,
  }
}

/**
 * Build the process/environment probes with short-lived caches.
 * @returns {object} probe API consumed by the engine.
 */
export function createProbe() {
  let envCache = null
  let envAt = 0
  let procCache = null
  let procAt = 0
  let envPending = null
  let procPending = null

  const environmentScript = `
$root = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Power\\User\\PowerSchemes'
$active = (Get-ItemProperty -Path $root -Name ActivePowerScheme).ActivePowerScheme
$lidKey = Join-Path $root (Join-Path $active '${SYSTEM_BUTTONS}\\${LID_ACTION}')
$lid = Get-ItemProperty -Path $lidKey
$sleepKey = Join-Path $root (Join-Path $active '${SUB_SLEEP}\\${STANDBY_IDLE}')
$sleep = Get-ItemProperty -Path $sleepKey
$videoKey = Join-Path $root (Join-Path $active '${SUB_VIDEO}\\${VIDEO_IDLE}')
$video = Get-ItemProperty -Path $videoKey
$elevated = $false
try { $elevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) } catch {}
$pw = Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Power'
$ms = Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Power\\ModernSleep'
$sm = Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power'
[pscustomobject]@{
  scheme = $active
  lidAc = if ($null -ne $lid.ACSettingIndex) { [int]$lid.ACSettingIndex } else { $null }
  lidDc = if ($null -ne $lid.DCSettingIndex) { [int]$lid.DCSettingIndex } else { $null }
  standbyAc = if ($null -ne $sleep.ACSettingIndex) { [int]$sleep.ACSettingIndex } else { $null }
  standbyDc = if ($null -ne $sleep.DCSettingIndex) { [int]$sleep.DCSettingIndex } else { $null }
  videoAc = if ($null -ne $video.ACSettingIndex) { [int]$video.ACSettingIndex } else { $null }
  videoDc = if ($null -ne $video.DCSettingIndex) { [int]$video.DCSettingIndex } else { $null }
  elevated = $elevated
  os = [string][Environment]::OSVersion.Version
  platformAoAcOverride = if ($null -ne $pw.PlatformAoAcOverride) { [int]$pw.PlatformAoAcOverride } else { $null }
  csEnabled = if ($null -ne $pw.CsEnabled) { [int]$pw.CsEnabled } else { $null }
  modernSleepActions = if ($null -ne $ms.EnabledActions) { [int]$ms.EnabledActions } else { $null }
  awayModeEnabled = if ($null -ne $sm.AwayModeEnabled) { [int]$sm.AwayModeEnabled } else { $null }
} | ConvertTo-Json -Compress
`

  const processScript = `
$rows = Get-Process | Group-Object ProcessName | ForEach-Object {
  $titles = @($_.Group | ForEach-Object { $_.MainWindowTitle } | Where-Object { $_ -and $_.Trim() -ne '' } | Select-Object -Unique -First 2)
  [pscustomobject]@{ n = $_.Name; c = $_.Count; t = ($titles -join ' · ') }
}
$rows | ConvertTo-Json -Compress
`

  // Kernel-Power 506 is written every time the machine starts entering Modern
  // Standby, with the power-manager reason code as its first property (12 = idle
  // timeout, 15 = lid, ...). Reading the last few is enough: the plugin only
  // asks about the current hold window.
  const sleepEventScript = `
$ErrorActionPreference = 'SilentlyContinue'
$rows = @(Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Microsoft-Windows-Kernel-Power'; ID=506} -MaxEvents 20 -ErrorAction SilentlyContinue | ForEach-Object {
  [pscustomobject]@{
    at = ([datetimeoffset]$_.TimeCreated).ToUnixTimeMilliseconds()
    reason = [int]($_.Properties[0].Value)
  }
})
$rows | ConvertTo-Json -Compress
`

  /**
   * Read the recent "entering Modern Standby" events (Kernel-Power 506).
   * @returns {Promise<Array<{at: number, reason: number}>>} newest last; never rejects.
   */
  async function sleepEvents() {
    const { stdout } = await runPowerShell(sleepEventScript, 15000)
    const parsed = parseJson(stdout)
    const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : []
    return rows
      .map((row) => ({ at: Number(row?.at), reason: Number(row?.reason) }))
      .filter((row) => Number.isFinite(row.at))
      .sort((a, b) => a.at - b.at)
  }

  /**
   * Read power-scheme facts (lid actions, sleep model, elevation).
   * @param {boolean} [force] - ignore the 60 s cache.
   * @returns {Promise<object>} environment facts; never rejects.
   */
  async function environment(force = false) {
    const now = Date.now()
    if (!force && envCache && now - envAt < 60000) return envCache
    if (envPending) return envPending
    envPending = (async () => {
      const { stdout } = await runPowerShell(environmentScript)
      const parsed = parseJson(stdout)
      if (!parsed) {
        return { available: false, error: 'power scheme query returned no data' }
      }
      const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
      const platformAoAcOverride = num(parsed.platformAoAcOverride)
      const csEnabled = num(parsed.csEnabled)
      const modernSleepActions = num(parsed.modernSleepActions)
      const sleep = await sleepModel()
      return {
        available: true,
        scheme: typeof parsed.scheme === 'string' ? parsed.scheme : null,
        lidAc: num(parsed.lidAc),
        lidDc: num(parsed.lidDc),
        standbyAc: num(parsed.standbyAc),
        standbyDc: num(parsed.standbyDc),
        videoAc: num(parsed.videoAc),
        videoDc: num(parsed.videoDc),
        modernStandby: sleep.modernStandby,
        sleepStates: sleep.text,
        elevated: parsed.elevated === true,
        os: typeof parsed.os === 'string' ? parsed.os : null,
        platformAoAcOverride,
        csEnabled,
        modernSleepActions,
        awayModeEnabled: num(parsed.awayModeEnabled),
        // Windows decides Modern Standby from these three values; 0 on any of
        // them means "use classic sleep / no connected standby".
        modernStandbyDisabled: platformAoAcOverride === 0 || csEnabled === 0 || modernSleepActions === 0,
      }
    })()
    try {
      const value = await envPending
      envCache = value
      envAt = Date.now()
      return value
    } catch (error) {
      return { available: false, error: describe(error) }
    } finally {
      envPending = null
    }
  }

  /**
   * Enumerate running processes grouped by name.
   * @param {boolean} [force] - ignore the 6 s cache.
   * @returns {Promise<Array<{name: string, count: number, title: string}>>}
   */
  async function processes(force = false) {
    const now = Date.now()
    if (!force && procCache && now - procAt < 6000) return procCache
    if (procPending) return procPending
    procPending = (async () => {
      const { stdout } = await runPowerShell(processScript, 15000)
      const parsed = parseJson(stdout)
      const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : []
      return rows
        .map((row) => ({
          name: String(row?.n ?? ''),
          count: Number(row?.c ?? 1) || 1,
          title: typeof row?.t === 'string' ? row.t : '',
        }))
        .filter((row) => row.name !== '')
        .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
    })()
    try {
      const value = await procPending
      procCache = value
      procAt = Date.now()
      return value
    } catch {
      return procCache || []
    } finally {
      procPending = null
    }
  }

  /**
   * Rewrite the AC and DC lid-close actions after one UAC prompt.
   * @param {number} ac - action index (0 = do nothing, 1 = sleep, …).
   * @param {number} dc - action index for battery.
   * @returns {Promise<{ok: boolean, denied?: boolean, error?: string, environment?: object}>}
   */
  async function applyLid(ac, dc) {
    const started = await runElevated([
      `powercfg /attributes ${SYSTEM_BUTTONS} ${LID_ACTION} -ATTRIB_HIDE | Out-Null`,
      `powercfg /setacvalueindex SCHEME_CURRENT ${SYSTEM_BUTTONS} LIDACTION ${ac} | Out-Null`,
      `powercfg /setdcvalueindex SCHEME_CURRENT ${SYSTEM_BUTTONS} LIDACTION ${dc} | Out-Null`,
      'powercfg /setactive SCHEME_CURRENT | Out-Null',
    ])
    if (!started.ok) return started
    return { ok: true, environment: await environment(true) }
  }

  /**
   * Rewrite the AC and DC "sleep after" timeouts after one UAC prompt.
   *
   * The prompt-free path is `power-plan.writePlan`, which most builds allow;
   * this is the fallback for a machine whose power scheme is locked down.
   * @param {number} ac - seconds, 0 = never.
   * @param {number} dc - seconds, 0 = never.
   * @returns {Promise<{ok: boolean, denied?: boolean, error?: string, environment?: object}>}
   */
  async function applyStandbyIdle(ac, dc) {
    const started = await runElevated([
      `powercfg /attributes SUB_SLEEP ${STANDBY_IDLE} -ATTRIB_HIDE | Out-Null`,
      `powercfg /setacvalueindex SCHEME_CURRENT SUB_SLEEP STANDBYIDLE ${ac} | Out-Null`,
      `powercfg /setdcvalueindex SCHEME_CURRENT SUB_SLEEP STANDBYIDLE ${dc} | Out-Null`,
      'powercfg /setactive SCHEME_CURRENT | Out-Null',
    ])
    if (!started.ok) return started
    return { ok: true, environment: await environment(true) }
  }

  /**
   * Switch Modern Standby off (or put the recorded values back). This is the
   * only lever Windows offers when a build ignores the lid-close action: with
   * Modern Standby gone, closing the lid can no longer suspend the machine.
   * The change is written to HKLM and takes effect after a reboot.
   * @param {boolean} disable
   * @param {{platformAoAcOverride?: number|null, csEnabled?: number|null, modernSleepActions?: number|null, awayModeEnabled?: number|null}} [originals]
   * @returns {Promise<{ok: boolean, denied?: boolean, error?: string, environment?: object}>}
   */
  async function applyModernStandby(disable, originals = {}) {
    const powerRoot = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Power'
    const modernSleep = `${powerRoot}\\ModernSleep`
    const sessionPower = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power'
    const setValue = (key, name, value) =>
      typeof value === 'number'
        ? `New-ItemProperty -Path '${key}' -Name '${name}' -Value ${value} -PropertyType DWord -Force | Out-Null`
        : `Remove-ItemProperty -Path '${key}' -Name '${name}' -ErrorAction SilentlyContinue`
    const lines = disable
      ? [
          `New-ItemProperty -Path '${powerRoot}' -Name 'PlatformAoAcOverride' -Value 0 -PropertyType DWord -Force | Out-Null`,
          `New-ItemProperty -Path '${powerRoot}' -Name 'CsEnabled' -Value 0 -PropertyType DWord -Force | Out-Null`,
          `New-ItemProperty -Path '${modernSleep}' -Name 'EnabledActions' -Value 0 -PropertyType DWord -Force | Out-Null`,
          `New-ItemProperty -Path '${sessionPower}' -Name 'AwayModeEnabled' -Value 0 -PropertyType DWord -Force | Out-Null`,
        ]
      : [
          setValue(powerRoot, 'PlatformAoAcOverride', originals.platformAoAcOverride),
          setValue(powerRoot, 'CsEnabled', originals.csEnabled),
          setValue(modernSleep, 'EnabledActions', originals.modernSleepActions ?? 7),
          setValue(sessionPower, 'AwayModeEnabled', originals.awayModeEnabled),
        ]
    const started = await runElevated(lines)
    if (!started.ok) return started
    return { ok: true, environment: await environment(true) }
  }

  /**
   * Raw power diagnostics for the window's troubleshooting block.
   * @returns {Promise<object>}
   */
  async function diagnostics() {
    const env = await environment(true)
    const requests = await runPowerShell('powercfg /requests', 15000)
    const available = await runPowerShell('powercfg /a', 15000)
    return {
      environment: env,
      requests: `${requests.stdout}${requests.stderr}`.trim() || (requests.code ? 'requires administrator' : ''),
      available: `${available.stdout}${available.stderr}`.trim(),
    }
  }

  return {
    environment,
    processes,
    lidActions,
    applyLid,
    applyStandbyIdle,
    applyModernStandby,
    plan: readPlan,
    writePlan,
    // Blocking variants: `dispose()` restores the settings before the fiber (or
    // the process) can go away.
    readPlanSync,
    writePlanSync,
    sleepEvents,
    diagnostics,
  }
}
