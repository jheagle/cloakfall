import { readFileSync } from 'fs'
import { releaseNotesUrl, version } from './version'

describe('version', () => {
  test("matches package.json's (run `node scripts/write-version.mjs` after changing the version)", () => {
    expect(version).toBe(JSON.parse(readFileSync('package.json', 'utf8')).version)
  })

  test("links to the version's release notes on GitHub", () => {
    expect(releaseNotesUrl()).toBe(`https://github.com/jheagle/cloakfall/releases/tag/v${version}`)
    expect(releaseNotesUrl('2.3.4')).toBe('https://github.com/jheagle/cloakfall/releases/tag/v2.3.4')
  })
})
