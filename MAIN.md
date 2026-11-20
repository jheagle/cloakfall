# Cloakfall

[![tests](https://github.com/jheagle/cloakfall/actions/workflows/tests.yml/badge.svg?branch=main)](https://github.com/jheagle/cloakfall/actions/workflows/tests.yml)

Every fleet is cloaked. Fire blind into the dark. The last fleet still hidden wins.

Cloakfall is a hidden-fleet grid game in a dark sector of space: 2 to 4 fleets, any mix of players and robots, in a
free-for-all where the robots hunt each other too. Play it solo against robots, hot-seat on one screen, online with
friends, or just watch the robots play. It is fully keyboard playable (Tab onto a board, arrow keys, Enter to fire) and
screen-reader friendly: every cell is named by its coordinate and what it shows ("B4, miss").

Play it at https://joshuaheagle.com/projects/cloakfall/play.html (docs: https://joshuaheagle.com/projects/cloakfall/docs/).

Built with TypeScript on [treeloom](https://github.com/jheagle/treeloom) (the page as data) and
[treeloom-matrix](https://github.com/jheagle/treeloom-matrix) (the grids), with a socket.io lobby server for online play.

*Formerly "Battleship": renamed in November 2026, since that name is Hasbro's trademark. The rules of the classic
pencil-and-paper game are free to use; the name, and Hasbro's own rules text, are not.*

## Icons

`icons/icon.svg` is the source: a cloaked ship fading into the dark, its nose caught by a flare. The PNGs and
`favicon.ico` (16, 32 and 48 px) in `icons/` are rendered from it with sharp, the same way the website builds its own
icons (`scripts/build-icons.mjs` there). Re-render them after changing the SVG.

## Running locally

Solo, hot-seat and robots-only play are just the static page - nothing to run, open the built page
(e.g. http://cloakfall.local) in a browser.

Online Multiplayer additionally needs the lobby server running:

```
npm run serve:lobby
```

This compiles (`npm run build:lobby`) and starts `server/lobbyServer.ts` on port 3002. The page itself still needs to
be served separately (same as local play) - this is just the socket.io server it talks to for room hosting/joining and
the remote game itself. By default the page looks for it on port 3002 of the host it was loaded from (`lobbyUrl` in
`src/network/lobbySocket.ts`), so another device on the same network can join: open the page from this machine's
LAN address (e.g. `http://192.168.1.20:8080/`) on both, with ports 8080 and 3002 reachable from the network.

A page served somewhere else can name a hosted lobby instead, with a meta tag in its `<head>`:

```html
<meta name="cloakfall-lobby" content="https://cloakfall.joshuaheagle.com">
```

The tag's origin is used when it is an `http:` or `https:` URL (any path or query is dropped); anything else is ignored
and the page falls back to its own host on port 3002. `status.html` follows the same rule, so it checks the same
server. This repo's own `index.html` and `status.html` have no tag, for LAN and local play; the website's copy of the
game adds it.

## Running the lobby in Docker

The `Dockerfile` builds an image with just the compiled lobby server and its production dependencies, running as the
image's non-root `node` user on port 3002 (it writes nothing to disk, so it can run with a read-only filesystem):

```
docker build -t cloakfall-lobby .
docker run --rm -p 3002:3002 cloakfall-lobby
curl http://localhost:3002/status
```

## Play events (GoatCounter)

The website's copy of the game counts anonymous play events with [GoatCounter](https://www.goatcounter.com/help/events)
(`src/track.ts`), to see how people play and what to fix. It only happens on a page that loads GoatCounter's script
(`<script data-goatcounter=...>`); this repo's own `index.html`, the tests and the server send nothing. Events never
contain a player's name or anything typed, and each one counts every time it happens (not once per visitor).

| Event | When |
|---|---|
| `cloakfall-menu-<mode>` | a game type chosen on the main menu (`solo`, `multi`, `robots`, `online`) |
| `cloakfall-start-<mode>` | a game starts (Restart and Play Again included); the intro's demo game is never counted |
| `cloakfall-players-<mode>-<h>h-<r>r`, `cloakfall-hints-<mode>-<setting>` | the settings it started with |
| `cloakfall-finish-<mode>`, `cloakfall-turns-<mode>-<range>` | it reached the final score, and roughly how many turns it took (local games) |
| `cloakfall-finish-solo-won` / `-lost` | single player: whether the human won |
| `cloakfall-abandon-<mode>-<how>` | left before the end: `restart`, `quit`, `leave` (online) or `close` (tab closed, best effort) |
| `cloakfall-online-host`, `cloakfall-online-join` | an online room created or joined |
| `cloakfall-hint-checkbox-on` / `-off` | the hint checkbox switched (local games) |
| `cloakfall-link-whats-new`, `cloakfall-link-server-status` | a menu link opened (any link with `data-track`) |
| `cloakfall-error`, `cloakfall-error-promise` | an uncaught error (titled with file and line, at most 5 per page) |

## Checking full games in a browser

Three scripts play a whole game in a real headless Chromium (Playwright) against the built page, and fail when the game
doesn't reach its final score or a page has an error (uncaught errors, console errors, failed requests). Build first:

```
npm run build
npm run e2e:robots    # Robots only (~2 min)
npm run e2e:hotseat   # local multiplayer, two players on one screen (~2 min)
npm run e2e:online    # online: starts the lobby server, a host and a guest page (~1.5 min)
npm run e2e           # all three
```

Players shoot at random cells. Each turn waits for the game itself (a shot showing, whose turn the badge says) rather
than fixed pauses, so the online game's two-part updates (the shot, then the turn change) don't trip it.
`npm run e2e:online` also reports how much of the guest's page each shot changes (elements added, attribute writes),
to compare rendering changes. `E2E_LIMIT_MS` changes how long a game may take; `E2E_DEBUG=1` logs each online turn. The
online check needs port 3002 free (no lobby server already running). They use js-build-tools' page tools
(`watchPage`, `clickLabel`, `trackMutations`, `serveStatic`); a browser binary is needed once per machine:
`npx playwright install chromium`.
