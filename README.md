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
- In `busy` and `apps` modes the lid-close action follows **the hold**, not only the switch: while a
  policy is actually holding (a turn runs, a watched app runs) it is “do nothing”; once the policy
  goes idle — the turn ended and the grace window expired, VMware exited — it is put back to the
  original action, silently, so a closed lid sleeps again even though the switch is still on.
- The lid-close action follows the switch: switching **on** sets it to “do nothing” for AC and
  battery (the original values are saved), switching **off** puts those original values back, so a
  closed lid sleeps and locks the machine again. Both directions are **silent** and ask for no
  permission: the plugin writes the power-scheme indexes with `powercfg` from the Host process and
  verifies them by reading the registry back. A machine that refuses the write falls back to the
  elevated task below, and only that fallback can ever show a UAC prompt.
- **The sleep timeout follows the hold too**: while keeping awake, `Sleep after` becomes *never* for
  AC and battery, and the recorded values come back when it stops. This is not cosmetic — see
  [Why a finite sleep timeout still slept the machine](#why-a-finite-sleep-timeout-still-slept-the-machine).
- **Battery guard**: on battery power, once the charge drops to `batteryFloor` (default 30 %) the
  plugin stops keep-awake by itself and puts the lid action and the sleep timeout back. That
  automatic stop never prompts — every write it needs is prompt-free. `0` in the battery field turns
  the guard off.
- **Advanced → Silent lid switch** installs one elevated scheduled task (`DshKeepAwakeLid`). On most
  builds it is not needed at all, because `powercfg` writes the scheme directly; it is the fallback
  for a machine where that write needs administrator rights. Creating it is the only time this
  plugin asks for permission; afterwards every change is requested through a small JSON file plus
  `schtasks /run`, and the task answers with a result file that names both the lid action and the
  sleep timeout. The advanced row shows whether it is ready and can install or remove it.
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

## Why a finite sleep timeout still slept the machine

Reported behaviour: with `Sleep after` set to *never* keep-awake worked, with any duration the
machine slept right after that duration. That is documented Windows behaviour, not a flaw in the
power request:

> On Modern Standby systems on DC power, system and execution required power requests are terminated
> 5 minutes after the system sleep timeout has expired.
> — [PowerSetRequest, Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-powersetrequest)

On battery, a finite “sleep after” value of 10 minutes therefore buys a keep-awake app about 15
minutes; then Windows ends the request and the machine sleeps. Holding longer does not help — the
condition has to disappear. While the machine is held, the plugin writes `0` (*never*) to
`STANDBYIDLE` for AC and battery, which is exactly the configuration people reach for by hand, and
restores the recorded values the moment the hold ends. Only values the plugin wrote are reverted, so
a value you change by hand in the meantime survives.

There is a second trigger on battery: modern standby *starts* when the display turns off, and its
first phase only lets power requests block the transition “for up to 5 minutes on DC power”
([Prepare software for modern standby](https://learn.microsoft.com/en-us/windows-hardware/design/device-experiences/prepare-software-for-modern-standby)).
A dark screen therefore beats the request on battery. So while it holds **on battery**, the plugin
also borrows the battery display timeout (`VIDEOIDLE` → *never*), and gives it back when the hold
ends or the charger is plugged in. On AC nothing is touched and the screen may turn off normally —
there the request blocks that phase indefinitely.

## Self-check and the last-resort ladder

Every time it holds, the plugin reads the System log for `Kernel-Power` 506 (“entering Modern
Standby”) events once a minute. An event timestamped inside the current hold means the request was
not enough, so the hold itself is upgraded:

1. **System request only** (`ES_CONTINUOUS | ES_SYSTEM_REQUIRED`, `0x80000001`) — the normal state.
2. **System + display** (`0x80000003`) — the silent, instant upgrade: the screen stays on, so Modern
   Standby cannot begin at all. The window explains what happened, when, and the power-manager reason
   code (12 = idle timeout, 15 = lid).
3. **Recommendation** — a second event after that upgrade, or one caused by the lid (a display
   request cannot fix a lid trigger), means this machine needs Modern Standby gone: the window then
   offers **Switch Modern Standby off** (one administrator prompt, reboot; reversible).

`Advanced → Also keep the display awake` is the same lever by hand, and switching it off there drops
an automatic escalation again. The self-check never acts while the policy is idle, never looks at
events from before the current hold, and remembers the last event it saw so a repeated read cannot
escalate twice.

## Leaving the machine exactly as it was found

Everything the plugin borrows is put back, and the moments it happens are:

- **Switch off** — the power request is released and the lid action, the sleep timeout and the battery
  display timeout go back to their recorded values (values you changed by hand in the meantime win).
- **Plugin disabled or uninstalled** — `dispose()` runs before the fiber (or the process) goes away and
  restores the same settings **synchronously** with `powercfg` + `reg.exe`, so closing or removing the
  plugin cannot leave a machine that never sleeps. If a setting could not be written it is remembered,
  and the next start with the switch off heals it.
- **Advanced → Leave no trace** — the same restore, plus: the silent helper task (`DshKeepAwakeLid`)
  and its script/request/result files are removed, and Modern Standby is put back if this plugin
  switched it off. Run it before uninstalling the bundle if you also want the scheduled task gone.
- If the Host is killed (no disposer runs), the settings stay borrowed until the next start: the window
  then warns and offers one-click restores, or switching the plugin back on re-asserts them.

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
- If the Harness is killed (rather than switched off) the lid action and the sleep timeout can stay
  at their keep-awake values. The window then opens with a warning and one-click restores for both;
  starting the Harness again while the switch is off heals them automatically. Windows cannot raise
  an administrator prompt during shutdown, which is why the heal happens on the next start.
- The Harness host must be running. Closing the Harness releases the request.

## State

The persisted wish (switch, policy, watched names, saved lid actions, saved sleep timeouts, saved
Modern Standby values, battery floor, grace window, last automatic stop) lives in
`<DSH_HOME>/keep-awake/state.json`; the silent helper keeps `lid-apply.ps1`, `lid-request.json` and
`lid-result.json` next to it; a heartbeat trace used for verification lives in
`<DSH_HOME>/keep-awake/heartbeat.log`.
