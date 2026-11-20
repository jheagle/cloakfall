/** This build's version, kept equal to package.json's by scripts/write-version.mjs (run on every release). */
export const version = '2.4.0'

/** Where the game's releases are published, each with its notes. */
export const RELEASES_URL = 'https://github.com/jheagle/cloakfall/releases'

/**
 * The release notes ("what's new") for a version.
 * @param forVersion Defaults to this build's own.
 */
export const releaseNotesUrl = (forVersion: string = version): string => `${RELEASES_URL}/tag/v${forVersion}`
