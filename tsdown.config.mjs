/**
 * tsdown build for dsh-remote-window.
 *
 * Host half (ESM, node): the plugin entry plus the two entries the loader
 * mounts as their own rows — `./connection` (the per-target `ctx.ssh` inside
 * an agent-preset realm), `./rsession` and `./session-persistence`.
 *
 * Client half (browser, CJS closure factory): one bundle registering through
 * `window.__ModuleLoader__.load({ id: 'dsh-remote-window', factory })`.
 * Only the platform module table is external; everything else is inlined and
 * cross-plugin value imports are rejected by the purity gate below.
 */
import { builtinModules } from 'node:module'

/** Node builtins must never survive into the browser module-loader factory. */
const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map(id => `node:${id}`),
])

/** Platform module table shared by the web shell (react, cordis, ui packages). */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  'cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

/** Wire/type layers a client bundle may inline (no runtime identity to share). */
const INLINE_SAFE = /^@deepseek-ai\/dsh-(host-apiproxy|session|llm|tools|brand)(\/|$)/

const PLUGIN_ID = 'dsh-remote-window'

const hostConfig = {
  entry: {
    index: 'src/index.ts',
    connection: 'src/connection/index.ts',
    rsession: 'src/rsession/remote-persistence.ts',
    'session-persistence': 'src/session-persistence/routing.ts',
    protocol: 'src/protocol.ts',
  },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  fixedExtension: false,
  dts: false,
  clean: false,
  sourcemap: false,
}

const clientConfig = {
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  external: [...CLIENT_EXTERNALS],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    'import.meta.resolve': 'undefined',
  },
  inputOptions: {
    resolve: { conditionNames: ['browser', 'import', 'require', 'default'] },
  },
  noExternal: (id) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
  plugins: [
    {
      name: 'dsh-client-bundle-purity',
      resolveId(source) {
        if (NODE_BUILTINS.has(source)) {
          throw new Error(`client bundle purity: Node builtin "${source}" cannot run in the browser module table`)
        }
        if (!source.startsWith('@deepseek-ai/')) return null
        if (CLIENT_EXTERNALS.includes(source)) return null
        if (INLINE_SAFE.test(source)) return null
        throw new Error(
          `client bundle purity: "${source}" is neither a platform module nor an inline-safe wire layer — `
          + 'collaborate through cordis services instead of value imports',
        )
      },
    },
  ],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    codeSplitting: false,
  },
}

export default [hostConfig, clientConfig]
