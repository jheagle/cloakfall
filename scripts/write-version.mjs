/**
 * Write src/version.ts from package.json's version, so the game can show which version is running. release-it runs
 * this after it bumps the version (.release-it.json's after:bump hook), and a release PR runs it by hand after
 * `npm version`; src/version.test.js fails if the two ever disagree.
 *
 *   node scripts/write-version.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const { version } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
const file = new URL('src/version.ts', root)
const source = readFileSync(file, 'utf8')
const updated = source.replace(/export const version = '[^']*'/, `export const version = '${version}'`)
if (updated === source && !source.includes(`export const version = '${version}'`)) {
  throw new Error('src/version.ts has no `export const version = \'...\'` line to update')
}
writeFileSync(file, updated)
console.log(`src/version.ts: ${version}`)
