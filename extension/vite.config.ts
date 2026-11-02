import { defineConfig, loadEnv, type Plugin, type UserConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'

/**
 * Chrome MV3 build
 * ----------------
 * MV3 content scripts CANNOT use ES module imports. Service workers can, but
 * relative chunk paths are flaky in practice. To avoid both classes of bug we
 * build three separate bundles, each fully self-contained (IIFE, no imports):
 *
 *   EXT_ENTRY=ui          → dist/sidepanel.html + dist/popup.html + dist/assets/*  (+ manifest, icons)
 *   EXT_ENTRY=background  → dist/background/index.js             (IIFE, inlined)
 *   EXT_ENTRY=content     → dist/content/index.js                (IIFE, inlined)
 *
 * `npm run build` runs all three in sequence. The first clears dist; the
 * subsequent two append to it (emptyOutDir: false).
 */

// Keep in sync with the fallback in src/lib/config.ts.
const DEFAULT_API_BASE_URL = 'https://aethlara-api.collinsadi.xyz/api/v1'

/**
 * The extension only needs host access to its own API. The API origin is
 * derived from VITE_API_BASE_URL at build time and merged into
 * host_permissions (empty in manifest.json), so every build, hosted,
 * self-hosted or local (e.g. http://localhost:18080/api/v1), gets exactly
 * its own API and nothing else, without editing manifest.json.
 */
function apiHostPermission(apiBaseUrl: string): string | null {
  try {
    const url = new URL(apiBaseUrl)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return `${url.protocol}//${url.host}/*`
  } catch {
    return null
  }
}

function extensionAssets(env: Record<string, string>): Plugin {
  return {
    name: 'aethlara-extension-assets',
    closeBundle() {
      const manifest = JSON.parse(readFileSync('manifest.json', 'utf8')) as {
        host_permissions?: string[]
      }
      const apiBase = env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL
      const pattern = apiHostPermission(apiBase)
      if (!pattern) {
        throw new Error(`VITE_API_BASE_URL is not a valid http(s) URL: ${apiBase}`)
      }
      const hosts = new Set(manifest.host_permissions ?? [])
      hosts.add(pattern)
      manifest.host_permissions = [...hosts]

      mkdirSync('dist', { recursive: true })
      writeFileSync('dist/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)
      if (existsSync('icons')) {
        mkdirSync('dist/icons', { recursive: true })
        cpSync('icons', 'dist/icons', { recursive: true })
      }
    },
  }
}

const entry = process.env.EXT_ENTRY ?? 'ui'
const aliases = { '@': resolve(__dirname, 'src') }

function scriptBundle(input: string, fileName: string): UserConfig {
  return {
    resolve: { alias: aliases },
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      rollupOptions: {
        input: resolve(__dirname, input),
        output: {
          format: 'iife' as const,
          entryFileNames: fileName,
          inlineDynamicImports: true,
        },
      },
    },
  }
}

export default defineConfig(({ mode }) => {
  if (entry === 'background') return scriptBundle('src/background/index.ts', 'background/index.js')
  if (entry === 'content') return scriptBundle('src/content/index.ts', 'content/index.js')

  // ui (side panel) — default; emits manifest + icons. Never clears dist,
  // because in watch mode that would delete dist/content and dist/background
  // between rebuilds. The `build` npm script does an explicit `rm -rf dist`.
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [react(), extensionAssets(env)],
    resolve: { alias: aliases },
    base: './',
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      rollupOptions: {
        // The same app as a side panel (sidepanel.html) and as the toolbar
        // popup (popup.html), for browsers without side panels such as Arc.
        input: {
          sidepanel: resolve(__dirname, 'sidepanel.html'),
          popup: resolve(__dirname, 'popup.html'),
        },
        output: {
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash].[ext]',
        },
      },
    },
  }
})
