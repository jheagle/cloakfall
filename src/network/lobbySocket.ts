import { io, Socket } from 'socket.io-client'
import type { ForwardedEvent } from 'treeloom/dist/events/types'
import type { HintSetting } from '../setup/gameOptions'
import type { RoomState } from '../../server/lobbyServer'

/** The lobby server's port (server/lobbyServer.ts). */
export const LOBBY_PORT = 3002

/** The meta tag a page can name its lobby with: <meta name="cloakfall-lobby" content="https://lobby.example.com">. */
export const LOBBY_META_NAME = 'cloakfall-lobby'

/**
 * The lobby URL a page names in its cloakfall-lobby meta tag, or null when it names none (no tag, no document).
 * @param doc The page's document: the global one by default, null when there is none.
 */
export const configuredLobbyUrl = (doc: Pick<Document, 'querySelector'> | null = globalThis.document ?? null): string | null =>
  doc?.querySelector(`meta[name="${LOBBY_META_NAME}"]`)?.getAttribute('content') ?? null

/**
 * The lobby server's URL. A page that names its lobby with a cloakfall-lobby meta tag (the website's copy of the game,
 * against the hosted lobby) uses that tag's origin, when it is an http: or https: URL; anything else in the tag is ignored. Without
 * one, it is port 3002 on the host the page was loaded from, so a phone that opened the game from the laptop's LAN
 * address (http://192.168.x.y:8080) reaches the laptop's lobby (npm run serve:lobby), not itself. Outside a page (Node,
 * tests), or for a page opened from a file, it is localhost.
 * @param location The page's location: the global one by default, null when there is none.
 * @param configured The lobby URL the page names: its meta tag's by default, null for none.
 */
export const lobbyUrl = (
  location: Pick<Location, 'protocol' | 'hostname'> | null = globalThis.location ?? null,
  configured: string | null = configuredLobbyUrl()
): string => {
  if (configured) {
    try {
      const url = new URL(configured)
      // Only the origin: socket.io would take any path as a namespace (and quietly connect to the wrong one).
      if (/^https?:$/.test(url.protocol)) {
        return url.origin
      }
    } catch {
      // Not a URL: fall back to the page's own host
    }
  }
  return location && /^https?:$/.test(location.protocol) && location.hostname
    ? `${location.protocol}//${location.hostname}:${LOBBY_PORT}`
    : `http://localhost:${LOBBY_PORT}`
}

let socket: Socket | null = null

/**
 * The lobby socket, connecting on first use. A test can connect it to its own ephemeral server before triggering any
 * UI action, by calling this directly with that server's URL - the UI's own calls below then reuse that connection.
 * @param url
 */
export const connectLobbySocket = (url: string = lobbyUrl()): Socket => {
  if (!socket) {
    socket = io(url)
  }
  return socket
}

/** What a lobby call resolves with when the server never answers (not running, unreachable, or too slow). Shown as
 * HTML: it links to the status page (status.html, next to the game), which checks the server itself, in a new tab so
 * the game's own screen is kept. */
export const UNREACHABLE_ERROR = 'Can\'t reach the game server. <a href="status.html" target="_blank" rel="noopener">Check the server status</a>, then try again.'

let requestTimeoutMs = 8000

/**
 * How long a lobby call waits for the server's answer before giving up with UNREACHABLE_ERROR (default 8 seconds).
 * Tests shorten it.
 * @param ms
 */
export const setLobbyTimeout = (ms: number): void => {
  requestTimeoutMs = ms
}

/**
 * Send a lobby call and resolve with the server's answer, or with `{ error: UNREACHABLE_ERROR }` if none arrives in
 * time. Without the timeout, socket.io buffers the call while it keeps trying to connect, so an unreachable lobby left
 * the screen on "Looking up room..." forever. A call that timed out is dropped from socket.io's buffer, so it is not
 * sent later if the connection comes back.
 * @param event
 * @param payload
 */
const request = <T>(event: string, payload: object): Promise<T | { error: string }> =>
  new Promise(resolve => {
    connectLobbySocket().timeout(requestTimeoutMs).emit(event, payload, (timedOut: Error | null, answer: T) =>
      resolve(timedOut ? { error: UNREACHABLE_ERROR } : answer))
  })

/** Close the lobby socket and forget it, so the next connectLobbySocket call starts fresh. */
export const disconnectLobbySocket = (): void => {
  socket?.close()
  socket = null
}

/** Create a room as its host, resolving with the room's state once the server acknowledges it, or an error. */
export const createRoom = (name: string, roomName: string): Promise<RoomState | { error: string }> =>
  request('createRoom', { name, roomName })

/** Look up a room's own lobby name and host's name by its code, without joining it - lets a joiner see whose
 * game it is before they commit their own name (see mainMenu.ts's remote-join-confirm). */
export const peekRoom = (roomCode: string): Promise<{ roomName: string, hostName: string } | { error: string }> =>
  request('peekRoom', { roomCode })

/** Join an existing room by its code, resolving with the room's state, or an error if it could not be joined. */
export const joinRoom = (roomCode: string, name: string): Promise<RoomState | { error: string }> =>
  request('joinRoom', { roomCode, name })

/** Be told whenever the room's state changes (a player joins or leaves). Replaces any previous listener rather
 * than adding another - Play Again (see remotePlayAgainListener.ts) re-enters the same waiting room, which
 * would otherwise register a fresh listener each time, piling up duplicate renders on every room update. */
export const onRoomUpdate = (callback: (state: RoomState) => void): void => {
  connectLobbySocket().off('roomUpdate').on('roomUpdate', callback)
}

/** Be told if the host leaves, closing the room for everyone still in it. Replaces any previous listener, for
 * the same reason as onRoomUpdate above. */
export const onRoomClosed = (callback: () => void): void => {
  connectLobbySocket().off('roomClosed').on('roomClosed', callback)
}

/** This connection's own socket id, once connected - used to tell whether this player is the room's host. */
export const getSocketId = (): string | undefined => connectLobbySocket().id

/** The host starts the game: every connected player becomes a human player, in the room's own join order, and
 * `robots` (if any) fill whatever seats are still empty - the server validates this against the room's actual
 * remaining capacity. */
export const startGame = (hints: HintSetting, robots: number = 0): Promise<{ started: true } | { error: string }> =>
  request('startGame', { hints, robots })

/** Be told whenever the game's state changes - the redacted view of the whole screen, for this connection alone.
 * Replaces any previous listener rather than adding another - a rematch (see remotePlayAgainListener.ts,
 * server/lobbyServer.ts's relaxed startGame guard) re-enters a second real game on the same connection, which
 * would otherwise leave the first game's own render loop listening alongside the new one, forever. */
export const onGameUpdate = (callback: (redactedBody: object) => void): void => {
  connectLobbySocket().off('gameUpdate').on('gameUpdate', callback)
}

/** Stop listening for game updates (leaving a game), without connecting a socket that isn't there. A stopped game's
 * late push must never be drawn over whatever comes next (the waiting room, the menu). */
export const offGameUpdate = (): void => {
  socket?.off('gameUpdate')
}

/** The host's game menu, mid-game: end the game for everyone and go back to the waiting room ('lobby'), or start
 * a new one with the same settings ('restart'). See server/lobbyServer.ts's hostGameAction. */
export const hostGameAction = (action: 'restart' | 'lobby'): Promise<{ ok: true } | { error: string }> =>
  request('hostGameAction', { action })

/** Be told when the host has ended the game and everyone goes back to the waiting room (with the room's state).
 * Replaces any previous listener. */
export const onBackToLobby = (callback: (state: RoomState) => void): void => {
  connectLobbySocket().off('backToLobby').on('backToLobby', callback)
}

/** Forward a user interaction to the server instead of running its listener locally - see setForwardEvents. */
export const sendGameAction = (envelope: ForwardedEvent): void => {
  connectLobbySocket().emit('gameAction', envelope)
}
