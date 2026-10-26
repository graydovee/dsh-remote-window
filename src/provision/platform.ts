/** Platform facts from one probe (v1 scan/connect). */

export function probeFactsFrom(options: { uname: string; machine: string; ostype: string; ldd: string }): {
  platform: 'linux' | 'darwin'
  arch: 'x64' | 'arm64'
  libc: '' | 'gnu' | 'musl'
} {
  const ostype = options.ostype.trim().toLowerCase()
  const unameSystem = options.uname.trim()
  // A Linux container may fake `uname -s`; `/proc/sys/kernel/ostype` tells the
  // truth (ZCode's detectEnv does the same).
  const platform = ostype.includes('linux') || (unameSystem === 'Darwin' && ostype === 'linux') ? 'linux' : unameSystem === 'Darwin' ? 'darwin' : 'linux'
  const rawArch = options.machine.trim()
  const arch = rawArch === 'arm64' || rawArch === 'aarch64' ? 'arm64' : 'x64'
  const ldd = options.ldd.trim().toLowerCase()
  const libc = platform !== 'linux' ? '' : ldd.includes('musl') ? 'musl' : 'gnu'
  return { platform, arch, libc }
}
