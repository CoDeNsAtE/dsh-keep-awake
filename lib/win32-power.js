/**
 * Windows power requests without a helper build step.
 *
 * `SetThreadExecutionState` is a kernel32 call, so the only way to reach it from
 * the Host process without shipping a native addon is the FFI binding (`koffi`)
 * that the installed Harness already carries for its Windows subprocess layer.
 * Resolution therefore walks the installation anchor first and the local
 * package second; when neither resolves, the plugin reports that it cannot hold
 * a request instead of pretending to be active.
 */

import { createRequire } from 'node:module'
import path from 'node:path'

export const ES_CONTINUOUS = 0x80000000
export const ES_SYSTEM_REQUIRED = 0x00000001
export const ES_DISPLAY_REQUIRED = 0x00000002

let loaded = null
let loadFailure = null
let setThreadExecutionState = null
let getSystemPowerStatus = null
let powerStatusType = null

/**
 * Every anchor that may expose `koffi` to a profile-installed bundle.
 * @returns {Array<string|null>} createRequire anchors, `null` meaning this module.
 */
function anchors() {
  const list = [null]
  const push = (value) => {
    if (typeof value !== 'string' || value === '' || list.includes(value)) return
    list.push(value)
  }
  if (process.env.DSH_INSTALL_DIR) push(path.join(process.env.DSH_INSTALL_DIR, 'package.json'))
  if (typeof process.resourcesPath === 'string') {
    push(path.join(process.resourcesPath, 'app.asar', 'dsh', 'package.json'))
    push(path.join(process.resourcesPath, 'app', 'dsh', 'package.json'))
  }
  push(path.join(process.cwd(), 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
  return list
}

/**
 * Load `kernel32.dll` through the first anchor that resolves `koffi`.
 * @returns {{koffi: any, kernel32: any}} the binding table.
 * @throws {Error} when no anchor can resolve the FFI module or the DLL.
 */
export function loadKernel32() {
  if (loaded) return loaded
  if (loadFailure) throw loadFailure
  const reasons = []
  for (const anchor of anchors()) {
    try {
      const require = anchor === null ? createRequire(import.meta.url) : createRequire(anchor)
      const koffi = require('koffi')
      const kernel32 = koffi.load('kernel32.dll')
      loaded = { koffi, kernel32 }
      return loaded
    } catch (error) {
      reasons.push(`koffi unavailable (${anchor === null ? 'this package' : anchor}): ${describe(error)}`)
    }
  }
  loadFailure = new Error(reasons.join('; ') || 'koffi unavailable')
  throw loadFailure
}

/**
 * Hold or release the process-wide power request.
 *
 * `ES_CONTINUOUS` makes the state sticky for this thread; passing it alone
 * clears a previous request, which is also what Windows does when the Host
 * process exits.
 * @param {{system: boolean, display: boolean}} want - request kinds to hold.
 * @returns {{ok: boolean, error?: string}} whether the OS accepted the flags.
 */
export function setExecutionState(want) {
  try {
    const { kernel32 } = loadKernel32()
    if (!setThreadExecutionState) {
      setThreadExecutionState = kernel32.func('uint32 SetThreadExecutionState(uint32 esFlags)')
    }
    let flags = ES_CONTINUOUS
    if (want.system) flags |= ES_SYSTEM_REQUIRED
    if (want.display) flags |= ES_DISPLAY_REQUIRED
    const previous = Number(setThreadExecutionState(flags))
    if (previous === 0) return { ok: false, error: 'SetThreadExecutionState returned 0' }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: describe(error) }
  }
}

/**
 * Read AC line state and battery percentage through `GetSystemPowerStatus`.
 * @returns {{ac: boolean|null, batteryPercent: number|null, error?: string}}
 */
export function readPowerStatus() {
  try {
    const { koffi, kernel32 } = loadKernel32()
    if (!getSystemPowerStatus) {
      powerStatusType = koffi.struct('SYSTEM_POWER_STATUS', {
        ACLineStatus: 'uint8',
        BatteryFlag: 'uint8',
        BatteryLifePercent: 'uint8',
        SystemStatusFlag: 'uint8',
        BatteryLifeTime: 'uint32',
        BatteryFullLifeTime: 'uint32',
      })
      getSystemPowerStatus = kernel32.func('int GetSystemPowerStatus(void *lpSystemPowerStatus)')
    }
    const buffer = koffi.alloc(powerStatusType, 1)
    try {
      const ok = Number(getSystemPowerStatus(buffer))
      if (!ok) return { ac: null, batteryPercent: null, error: 'GetSystemPowerStatus failed' }
      const value = koffi.decode(buffer, powerStatusType)
      const percent = Number(value.BatteryLifePercent)
      return {
        ac: Number(value.ACLineStatus) === 1,
        batteryPercent: Number.isFinite(percent) && percent <= 100 ? percent : null,
      }
    } finally {
      try {
        koffi.free(buffer)
      } catch {
        /* koffi may own the block; leaking one 12-byte read is harmless. */
      }
    }
  } catch (error) {
    return { ac: null, batteryPercent: null, error: describe(error) }
  }
}

const SEE_MASK_NOCLOSEPROCESS = 0x00000040
const SEE_MASK_NOASYNC = 0x00000100
const SEE_MASK_FLAG_NO_UI = 0x00000400
const WAIT_TIMEOUT = 258
const ERROR_CANCELLED = 1223
const ERROR_ELEVATION_REQUIRED = 740

let shellLoaded = null
let shellFailure = null

/**
 * Load `shell32.dll` and declare the one call used here.
 *
 * `ShellExecuteExW` is what makes the UAC prompt appear immediately: the old
 * route spawned an unelevated PowerShell first and only then asked for
 * elevation, which added roughly half a second before the prompt was even
 * visible.
 * @returns {{koffi: any, info: any, exec: Function, wait: Function, exitCode: Function, close: Function, lastError: Function}}
 */
function loadShell() {
  if (shellLoaded) return shellLoaded
  if (shellFailure) throw shellFailure
  try {
    const { koffi, kernel32 } = loadKernel32()
    const shell32 = koffi.load('shell32.dll')
    const info = koffi.struct('SHELLEXECUTEINFOW', {
      cbSize: 'uint32',
      fMask: 'uint32',
      hwnd: 'void *',
      lpVerb: 'str16',
      lpFile: 'str16',
      lpParameters: 'str16',
      lpDirectory: 'str16',
      nShow: 'int32',
      hInstApp: 'void *',
      lpIDList: 'void *',
      lpClass: 'str16',
      hkeyClass: 'void *',
      dwHotKey: 'uint32',
      hIcon: 'void *',
      hProcess: 'void *',
    })
    shellLoaded = {
      koffi,
      info,
      exec: shell32.func('bool ShellExecuteExW(_Inout_ SHELLEXECUTEINFOW *pExecInfo)'),
      wait: kernel32.func('uint32 WaitForSingleObject(void *hObject, uint32 dwMilliseconds)'),
      exitCode: kernel32.func('bool GetExitCodeProcess(void *hProcess, _Out_ uint32 *lpExitCode)'),
      close: kernel32.func('bool CloseHandle(void *hObject)'),
      lastError: kernel32.func('uint32 GetLastError()'),
    }
    return shellLoaded
  } catch (error) {
    shellFailure = error
    throw error
  }
}

/**
 * Run an executable as administrator and wait for it, without a proxy process.
 *
 * Returns as soon as the child exits, so the caller learns the real exit code
 * instead of parsing a launcher's stdout.
 * @param {string} file - executable to start.
 * @param {string} parameters - command line tail, already quoted by the caller.
 * @param {{directory?: string|null, show?: number, timeoutMs?: number}} [options]
 * @returns {{ok: boolean, code?: number|null, denied?: boolean, unavailable?: boolean, error?: string}}
 */
export function runAsWait(file, parameters, options = {}) {
  const { directory = null, show = 0, timeoutMs = 120000 } = options
  let parts
  try {
    parts = loadShell()
  } catch (error) {
    return { ok: false, unavailable: true, error: describe(error) }
  }
  const { koffi, info, exec, wait, exitCode, close, lastError } = parts
  let block = null
  let handle = null
  try {
    block = koffi.alloc(info, 1)
    koffi.encode(block, info, {
      cbSize: koffi.sizeof(info),
      fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI,
      hwnd: null,
      lpVerb: 'runas',
      lpFile: file,
      lpParameters: parameters,
      lpDirectory: directory,
      nShow: show,
      hInstApp: null,
      lpIDList: null,
      lpClass: null,
      hkeyClass: null,
      dwHotKey: 0,
      hIcon: null,
      hProcess: null,
    })
    const started = exec(block)
    if (!started) {
      const code = Number(lastError())
      if (code === ERROR_CANCELLED) return { ok: false, denied: true, error: 'elevation was canceled' }
      if (code === ERROR_ELEVATION_REQUIRED) return { ok: false, error: `elevation not permitted (${code})` }
      return { ok: false, error: `ShellExecuteExW failed (${code})` }
    }
    const decoded = koffi.decode(block, info)
    handle = decoded.hProcess
    if (!handle) return { ok: false, error: 'ShellExecuteExW returned no process handle' }
    const waited = Number(wait(handle, timeoutMs))
    if (waited === WAIT_TIMEOUT) return { ok: false, error: 'elevated command timed out' }
    const buffer = koffi.alloc('uint32', 1)
    try {
      if (!exitCode(handle, buffer)) return { ok: false, error: 'GetExitCodeProcess failed' }
      return { ok: true, code: Number(koffi.decode(buffer, 'uint32')) }
    } finally {
      try {
        koffi.free(buffer)
      } catch {
        /* best effort */
      }
    }
  } catch (error) {
    return { ok: false, unavailable: true, error: describe(error) }
  } finally {
    if (handle) {
      try {
        close(handle)
      } catch {
        /* handle is reaped when the process object goes away */
      }
    }
    if (block) {
      try {
        koffi.free(block)
      } catch {
        /* best effort */
      }
    }
  }
}

/**
 * Whether the FFI path loaded at all, for the UI's capability line.
 * @returns {{available: boolean, error?: string}}
 */
export function keeperCapability() {
  try {
    loadKernel32()
    return { available: true }
  } catch (error) {
    return { available: false, error: describe(error) }
  }
}

/**
 * Normalize an unknown thrown value for logs and UI text.
 * @param {unknown} error
 * @returns {string}
 */
export function describe(error) {
  if (error === null || error === undefined) return 'unknown error'
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message || error.name
  const record = error
  if (typeof record.message === 'string' && record.message) return record.message
  return String(error)
}
