// Keeps the dependencies one way (docs: plan-contracts): an app never imports another app, only `contracts/`;
// `contracts/` imports nothing. The one exception is the platform's API type (`import type … from
// 'platform/rpc'`), which brings in no code. Also checks that the backoffice's copies of platform code still match.
// Run by `bun run check`; exits 1 on any problem.

import { dirname, relative, resolve } from 'node:path'
import { Glob } from 'bun'

const ROOT = resolve(import.meta.dir, '..')
const APPS = ['backoffice', 'platform', 'server', 'web']
const SOURCES = ['apps/*/src', 'apps/*/scripts', 'contracts'].map(
  (dir) => new Glob(`${dir}/**/*.{ts,js,svelte}`),
)
const IGNORED = /(^|\/)(node_modules|\.svelte-kit|build)\//
const IMPORT =
  /(?:^|[\s;])(import|export)(\s+type)?\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g
const TYPE_ONLY_ALLOWED = new Set(['platform/rpc'])

/** Backoffice copies of platform functions (Erdin chose copies over an internal API): they must stay the same. */
const COPIES = [
  {
    copy: 'apps/backoffice/src/lib/server/coins.ts',
    source: 'apps/platform/src/services/coins.ts',
    names: ['moveCoins', 'balanceOf', 'coinHistory', 'refundSignUp', 'refundEveryone'],
  },
  {
    copy: 'apps/backoffice/src/lib/server/distribute.ts',
    source: 'apps/platform/src/services/tournaments.ts',
    names: ['planRooms', 'shuffle', 'distributeIn'],
  },
  {
    copy: 'apps/backoffice/src/lib/server/distribute.ts',
    source: 'apps/platform/src/services/tournament-bots.ts',
    names: ['spreadBots'],
  },
]

const problems: string[] = []

/** Which app or package a file belongs to: an app name, or 'contracts'. */
function ownerOf(path: string): string {
  const [top, name] = relative(ROOT, path).split('/')
  return top === 'apps' ? (name ?? '') : (top ?? '')
}

function checkImport(file: string, specifier: string, typeOnly: boolean): void {
  const owner = ownerOf(file)
  const where = relative(ROOT, file)

  if (specifier.startsWith('.')) {
    const target = resolve(dirname(file), specifier)
    if (ownerOf(target) !== owner) {
      problems.push(`${where}: imports ${specifier}, which is outside ${owner}`)
    }

    return
  }

  const pkg = specifier.split('/')[0] ?? ''
  if (owner === 'contracts') {
    const testOnly = specifier.startsWith('bun:') && file.endsWith('.test.ts')
    if (!testOnly) {
      problems.push(`${where}: contracts may not import ${specifier}`)
    }

    return
  }

  if (APPS.includes(pkg) && pkg !== owner) {
    const allowed = typeOnly && TYPE_ONLY_ALLOWED.has(specifier)
    if (!allowed) {
      problems.push(`${where}: imports ${specifier}; apps share code only through contracts/`)
    }
  }
}

let scanned = 0
for (const glob of SOURCES) {
  for await (const path of glob.scan({ cwd: ROOT, absolute: true })) {
    if (IGNORED.test(path)) {
      continue
    }

    scanned += 1
    const text = await Bun.file(path).text()
    for (const match of text.matchAll(IMPORT)) {
      const specifier = match[3] ?? match[4]
      if (specifier) {
        checkImport(path, specifier, Boolean(match[2]))
      }
    }
  }
}

/** A top-level function's source, from its `function` line to the closing brace at column 0. */
function functionSource(text: string, name: string): string | null {
  const start = text.search(new RegExp(`^(export )?(async )?function ${name}\\b`, 'm'))
  if (start < 0) {
    return null
  }

  const end = text.indexOf('\n}\n', start)
  return text.slice(start, end).replace(/^export /, '')
}

for (const { copy, source, names } of COPIES) {
  const copied = await Bun.file(resolve(ROOT, copy)).text()
  const original = await Bun.file(resolve(ROOT, source)).text()

  for (const name of names) {
    const ours = functionSource(copied, name)
    const theirs = functionSource(original, name)
    if (!ours || !theirs) {
      problems.push(`${copy}: ${name} is missing here or in ${source}`)
    } else if (ours !== theirs) {
      problems.push(`${copy}: ${name} no longer matches ${source}; change both together`)
    }
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}

console.log(
  `Boundaries ok in ${scanned} files: apps share code only through contracts/; copies match.`,
)
