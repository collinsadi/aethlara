import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { copyFileSync, existsSync, mkdirSync, cpSync } from 'fs'

/**
 * Chrome MV3 build
 * ----------------
 * MV3 content scripts CANNOT use ES module imports. Service workers can, but
 * relative chunk paths are flaky in practice. To avoid both classes of bug we
 * build three separate bundles, each fully self-contained (IIFE, no imports):
 *
 *   EXT_ENTRY=popup       → dist/index.html + dist/assets/*   (+ manifest, icons)
 *   EXT_ENTRY=background  → dist/background/index.js          (IIFE, inlined)
 *   EXT_ENTRY=content     → dist/content/index.js             (IIFE, inlined)
 *
 * `npm run build` runs all three in sequence. The first clears dist; the
 * subsequent two append to it (emptyOutDir: false).
 */

function copyExtensionAssets() {
  return {
    name: 'copy-extension-assets',
    closeBundle() {
      copyFileSync('manifest.json', 'dist/manifest.json')
      if (existsSync('icons')) {
        mkdirSync('dist/icons', { recursive: true })
        cpSync('icons', 'dist/icons', { recursive: true })
      }
    },
  }
}

const entry = process.env.EXT_ENTRY ?? 'popup'
const aliases = { '@': resolve(__dirname, 'src') }

export default defineConfig(() => {
  if (entry === 'background') {
    return {
      resolve: { alias: aliases },
      build: {
        outDir: 'dist',
        emptyOutDir: false,
        rollupOptions: {
          input: resolve(__dirname, 'src/background/index.ts'),
          output: {
            format: 'iife' as const,
            entryFileNames: 'background/index.js',
            inlineDynamicImports: true,
          },
        },
      },
    }
  }

  if (entry === 'content') {
    return {
      resolve: { alias: aliases },
      build: {
        outDir: 'dist',
        emptyOutDir: false,
        rollupOptions: {
          input: resolve(__dirname, 'src/content/index.ts'),
          output: {
            format: 'iife' as const,
            entryFileNames: 'content/index.js',
            inlineDynamicImports: true,
          },
        },
      },
    }
  }

  // popup — default; emits manifest + icons. Never clears dist, because in
  // watch mode that would delete dist/content and dist/background between
  // rebuilds. The `build` npm script does an explicit `rm -rf dist` up front.
  return {
    plugins: [react(), copyExtensionAssets()],
    resolve: { alias: aliases },
    base: './',
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      rollupOptions: {
        input: resolve(__dirname, 'index.html'),
        output: {
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash].[ext]',
        },
      },
    },
  }
})
