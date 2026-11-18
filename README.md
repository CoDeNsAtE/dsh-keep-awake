# Keep awake with the lid closed

`dsh-keep-awake` keeps a Windows laptop working after you close the lid, and lets you tick the
background apps — VMware, a build, a download — that must keep running on the same machine.

A [DeepSeek Harness](https://github.com/deepseek-ai) plugin: one small floating window, one sidebar
button, and a `keep_awake` tool for the agent.

## Install

Clone the repository somewhere permanent, then add the folder to the Harness profile as a linked
bundle (this is the same path the plugin was developed with):

```powershell
git clone https://github.com/CoDeNsAtE/dsh-keep-awake.git "$HOME\dsh-keep-awake"
```

Ask the agent to install it — `plugin_manager` with `install_bundle` and the local spec
`link:$HOME\dsh-keep-awake` — or add the same entry to your profile's plugin list. Afterwards reload
the plugin (disable and enable it) and refresh the web UI once so the client bundle is fetched.

Requirements: Windows 10/11 with PowerShell 5.1, and a Harness build that exposes `webServer`,
`tools` and the `shell.overlay` / `sidebar.footer.action` client slots. No npm install step: the
plugin has no dependencies and reaches `koffi` from the Harness installation for the kernel32 calls.

## What it does

- Holds one Windows **system power request** (`SetThreadExecutionState` with
  `ES_CONTINUOUS | ES_SYSTEM_REQUIRED`) for as long as the switch is on, so nothing inside Windows
  goes idle-sleep while you work.
- Releases it the moment you switch off, the plugin unloads, or the Harness host exits. Windows
  also drops the request if the process dies, so the machine can never be left permanently awake
  by a crashed host.
- Offers three hold policies: `always`, `apps` (hold only while a watched process runs) and `busy`
  (hold while a DSH session runs a turn **or** a background job is still running — a
  `run_in_background` command, a background subagent, a workflow). Job state comes from the jobs
  registry, asked once per session, so a build that outlives its turn still counts as work.
- **Grace after work ends**: when the last turn and the last background job are done, `busy` keeps
  holding for `graceSeconds` (default 60, range 0–300, `Advanced → Grace after work ends`) so a
  trailing file write or a job that settles a moment later is not cut off. The window shows
  `grace Ns` while it runs; `0` releases at once.
- The lid-close action follows the switch: switching **on** sets it to “do nothing” for AC and
  battery (the original values are saved), switching **off** puts those original values back, so a
  closed lid sleeps and locks the machine again. Both directions are **silent**: they run through the
  elevated task below, so flipping the switch never opens a UAC prompt. One switch takes about a
  second end to end, and the window flips its switch instantly instead of waiting.
- **Battery guard**: on battery power, once the charge drops to `batteryFloor` (default 30 %) the
  plugin stops keep-awake by itself and puts the lid action back to sleep. That automatic stop never
  prompts — see *Silent lid switch* below. `0` in the battery field turns the guard off.
- **Advanced → Silent lid switch** installs one elevated scheduled task (`DshKeepAwakeLid`). Creating
  it is the only administrator prompt this plugin ever needs them for; afterwards every lid-action
  change is requested through a small JSON file plus `schtasks /run`, and the task answers with a
  result file. The advanced row shows whether it is ready and can install or remove it. Without it,
  the switch still works but the lid part reports `lid:helper-missing` and the window offers the
  one-time setup.
- **Advanced → Lid-close action** keeps a manual override of the same two operations, and
  **Advanced → Modern Standby** switches Modern Standby off in the registry
  (`PlatformAoAcOverride`, `CsEnabled`, `ModernSleep\EnabledActions`, `AwayModeEnabled`). That is
  the only lever a Modern-Standby-only machine honours; it needs one administrator prompt and a
  reboot, and it is reverted from the same button.

## Why both the request and the system setting

Measured on this machine (Windows 11 26H2, build 26300, Modern Standby only, no S3): with a system
power request held, closing the lid still produced `Kernel-Power` event 506 with `Reason = Lid` and
suspended the whole machine for the time the lid stayed shut. `SetThreadExecutionState` cannot veto
a lid-triggered transition — so the lid-close action is what keeps *the lid* from sleeping the
machine, and the request is what keeps *Windows* from idling out on top of that.

## Where to open it

The round button directly above **Settings** at the bottom of the left sidebar opens a small
floating window; the same window closes with `Esc` or the `–` button and reopens from that button.
Everything the window can do is also available to the agent as the `keep_awake` tool.

## Important limits

- The power request is **machine-wide**, not per app. Ticking an app only decides *when* the
  machine stays awake; during a hold, every background process keeps running.
- Holding a request while the lid is closed drains the battery quickly — that is exactly what
  Microsoft documents for `ES_SYSTEM_REQUIRED` on Modern Standby hardware. The battery guard exists
  to bound that drain.
- The guard only reacts while keep-awake holds on battery. On AC it never fires, and a critical
  battery action or shutdown is not blocked.
- With Modern Standby switched off on hardware that has no S3 (this machine), the laptop has **no
  sleep state at all**: Start → Sleep does nothing, and the only power saving left is
  screen-off/shutdown. That is the price of a working closed lid here; the restore button puts the
  original registry values back.
- If the Harness exits while the switch was on, the lid action can stay at “do nothing” and the
  guard can no longer run. Windows cannot raise an administrator prompt during shutdown. The window
  then opens with a warning and a **Restore lid sleep** button.
- The Harness host must be running. Closing the Harness releases the request.

## State

The persisted wish (switch, policy, watched names, saved lid actions, saved Modern Standby values,
battery floor, grace window, last automatic stop) lives in `<DSH_HOME>/keep-awake/state.json`; the silent helper
keeps `lid-apply.ps1`, `lid-request.json` and `lid-result.json` next to it; a heartbeat trace used
for verification lives in `<DSH_HOME>/keep-awake/heartbeat.log`.
