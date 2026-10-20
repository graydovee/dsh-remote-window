/**
 * The provisioning decision: reuse a dsh the host already has, or package one.
 *
 * `channel.ts` used to hold this inline and it grew an `if` forest; more
 * importantly the decision is the thing QA has to *explain* ("why did this
 * connect upload 40 MB?"), so it lives in one pure function with unit tests and
 * a message that names the failing fact.
 *
 * Two rules are load-bearing and are asserted by `tests/plan.test.ts`:
 *
 * 1. **A failed reuse never falls back to packaging.** The connect that follows
 *    would silently push a 25–50 MB archive over the user's link; the failure is
 *    reported instead, with the plain advice to pick 「上传 server 包」.
 * 2. **A launcher that needs Node does not fail the plan.** If neither the host
 *    nor a previous deployment offers an interpreter, the plan asks the pipeline
 *    to deploy our own Node (`deployRuntime`) and start the launcher through it —
 *    measured on Ubuntu 22.04, where the uploaded `.bin/dsh` is a `/bin/sh`
 *    wrapper whose `exec node` needs the deployed runtime on `PATH`.
 */
import { DSH_VERIFIED_SUMMARY, describeIncompatibility, isCompatibleDsh } from './version-range.ts'

/** Where the server package may come from; `reuse` never produces an artifact. */
export type PackageSourceKind = 'auto' | 'download' | 'upload' | 'reuse'

/**
 * What the pipeline measured about the launcher the user picked.
 *
 * Produced by `deploy.parseReuseLauncherOutput` over a read-only probe script:
 * `planProvision` itself performs no I/O, so it can be tested without a host.
 */
export interface ReuseLauncherFacts {
  /** Absolute path the user selected. */
  readonly path: string
  /** `readlink -f` of {@link path} (equal to it when it is not a symlink). */
  readonly realPath: string
  readonly exists: boolean
  readonly executable: boolean
  /** First line of `<launcher> --version`, trimmed; `''` when it printed nothing. */
  readonly version: string
  /** Exit code of that probe, or null when the launcher was never run. */
  readonly exitCode: number | null
  /** An interpreter the launcher can name, when the host has an executable one. */
  readonly nodePath?: string
  /** Whether the real file starts with `#!` (a script, not a native binary). */
  readonly hasShebang: boolean
  /** Absolute path of a Node this plugin already deployed, when it verifies. */
  readonly deployedNode?: string
}

/** The launcher a reuse plan will start. */
export interface ReuseLauncher {
  readonly path: string
  readonly realPath: string
  readonly version: string
  /** Interpreter to put first on `PATH`; absent for a self-contained binary. */
  readonly nodePath?: string
  /** True when no interpreter is needed at all (native ELF/Mach-O launcher). */
  readonly selfContained: boolean
}

/** What {@link planProvision} decided. */
export type ProvisionPlan =
  | { readonly mode: 'package' }
  | {
      readonly mode: 'reuse'
      readonly launcher: ReuseLauncher
      /** Deploy our own Node before starting the launcher (none was found). */
      readonly deployRuntime: boolean
    }

/** Error codes a refused reuse reports (wired into the SSE `error` frame). */
export type ReuseFailureCode = 'dsh-incompatible' | 'reuse-launcher-missing' | 'reuse-node-missing'

/** The plan, or the reason there is none. */
export type ProvisionDecision =
  | { readonly ok: true; readonly plan: ProvisionPlan }
  | { readonly ok: false; readonly code: ReuseFailureCode; readonly message: string }

/**
 * Decide how this connect will start the remote world.
 * @param input - the effective package source (already resolved against the
 *   target record and the global policy), the launcher path the user picked and
 *   the facts measured for it.
 * @returns the plan, or a coded refusal whose message is safe to show.
 */
export function planProvision(input: {
  readonly packageSource?: PackageSourceKind
  readonly reuseLauncherPath?: string
  readonly reuse?: ReuseLauncherFacts
}): ProvisionDecision {
  // Everything that is not `reuse` produces (or fetches) an artifact; the
  // download→build fallback chain inside `assets.resolveServerPackage` owns the
  // rest of that decision.
  if (input.packageSource !== 'reuse') return { ok: true, plan: { mode: 'package' } }

  const selected = (input.reuseLauncherPath ?? '').trim()
  if (selected === '') {
    return {
      ok: false,
      code: 'reuse-launcher-missing',
      message: 'no dsh launcher was selected for the reuse connection; scan the host and pick one',
    }
  }
  const facts = input.reuse
  if (facts === undefined || facts.path !== selected) {
    // Defensive: the pipeline always measures the selected path, so a mismatch
    // means the facts belong to something else and must not be trusted.
    return {
      ok: false,
      code: 'reuse-launcher-missing',
      message: `the selected launcher ${selected} could not be inspected on the remote host`,
    }
  }
  if (!facts.exists) {
    return {
      ok: false,
      code: 'reuse-launcher-missing',
      message: `the selected launcher ${selected} does not exist on the remote host; scan again`,
    }
  }
  if (!facts.executable) {
    return {
      ok: false,
      code: 'reuse-launcher-missing',
      message: `the selected launcher ${selected} is not executable on the remote host`,
    }
  }
  // A launcher that cannot even answer `--version` is not a launcher we can
  // rely on for the protocol handshake either.
  if (facts.exitCode !== 0 || facts.version.trim() === '') {
    const detail = facts.version.trim() === '' ? 'the launcher printed no version' : describeIncompatibility(facts.version)
    return {
      ok: false,
      code: 'dsh-incompatible',
      message: `the selected launcher ${selected} failed its version check (exit ${facts.exitCode === null ? 'unknown' : String(facts.exitCode)}): ${detail}`,
    }
  }
  if (!isCompatibleDsh(facts.version)) {
    return {
      ok: false,
      code: 'dsh-incompatible',
      message: `the selected launcher ${selected} cannot be used: ${describeIncompatibility(facts.version)}; the target must run ${DSH_VERIFIED_SUMMARY}, so choose 「上传 server 包」or「下载 server 包」 instead`,
    }
  }

  const version = facts.version.trim()
  if (!facts.hasShebang) {
    // A native launcher: nothing to put on PATH, and nothing to deploy.
    return {
      ok: true,
      plan: {
        mode: 'reuse',
        launcher: { path: facts.path, realPath: facts.realPath, version, selfContained: true },
        deployRuntime: false,
      },
    }
  }
  // A script launcher needs an interpreter. Prefer the one the host already
  // has; otherwise a Node we deployed earlier (it verifies, or the fact would
  // be absent) is exactly as good — this is the uploaded `/bin/sh` shim case.
  const nodePath = facts.nodePath ?? facts.deployedNode
  if (nodePath === undefined || nodePath === '') {
    return {
      ok: true,
      plan: {
        mode: 'reuse',
        launcher: { path: facts.path, realPath: facts.realPath, version, selfContained: false },
        deployRuntime: true,
      },
    }
  }
  return {
    ok: true,
    plan: {
      mode: 'reuse',
      launcher: { path: facts.path, realPath: facts.realPath, version, selfContained: false, nodePath },
      deployRuntime: false,
    },
  }
}
