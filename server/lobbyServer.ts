import './installPseudoDom'
import { createServer } from 'http'
import treeloom from 'treeloom'
import { Server, Socket } from 'socket.io'
import { startRoomGame, watchRoomGame } from './gameplay'
import { forTransport } from './transport'
import { cleanGameAction, cleanName, isHintSetting, isRecord, MAX_LOBBY_NAME, MAX_PLAYER_NAME } from './validate'
import { clientAddress, createFailureCounter, createRateLimiter, DEFAULT_LIMITS, settingsFromEnv } from './limits'
import { version } from '../src/version'
import { isHostOnlyStage, isRemoteSessionActive, remotePlacementStage } from '../src/setup/remotePlacement'
import { PLAYER_CONTROLS_CLASS } from '../src/components/pieces/playerStats'
import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'http'
import type { DomItem } from 'treeloom/dist/domItem/types'
import type { ForwardedEvent } from 'treeloom/dist/events/types'
import type { HintSetting } from '../src/setup/gameOptions'
import type { RoomGame } from './gameplay'
import type { LobbyLimits } from './limits'
import { createUsageLog, minutesSince } from './usage'
import type { UsageTotals } from './usage'

/** The fewest players a game can start with - nobody to attack otherwise. */
const MIN_PLAYERS_TO_START = 2

/** Whether a room's game has actually ended - the same condition updateScore.ts already uses to decide that
 * itself, re-checked here so a finished room's own startGame event can double as "play again" (see the
 * startGame handler below) without needing a separate, dedicated rematch event. */
export const isRoomGameOver = (game: RoomGame): boolean => game.players.filter(player => player.status > 0).length < 2

/** Up to four players in a room, the same limit as a local multiplayer game - robots fill whatever seats are
 * left under this same cap (see the startGame handler below and roomState's own maxRobots field), they never
 * grow it. */
const MAX_PLAYERS = 4

/** Room codes avoid 0/O and 1/I, which are easy to misread when read aloud or typed from a screen. */
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** One player in a room, as sent to clients. */
export interface RoomPlayer {
  id: string
  name: string
}

/** A room's state, as sent to clients: its code, its own host-chosen name, who is hosting, who has joined, and
 * the most robot seats that could be filled right now (MAX_PLAYERS minus how many have actually joined) - sent
 * over the wire rather than the client importing MAX_PLAYERS directly, since this is a server-only module
 * (Node http/socket.io, pseudo-dom's own install) that cannot be bundled for the browser. */
export interface RoomState {
  roomCode: string
  roomName: string
  hostId: string
  players: RoomPlayer[]
  maxRobots: number
}

interface Room {
  roomName: string
  hostId: string
  players: Map<string, string>
  game?: RoomGame
  broadcastGame?: () => void
  /** What the host last started a game with, so a restart (hostGameAction) can start the same again. */
  lastStart?: { hints: HintSetting, robots: number }
  /** When anyone in the room last sent anything, or its game last pushed an update (Date.now()). */
  lastActivity: number
  /** For the usage log (usage.ts): when the room opened, how many games it started, and the current game's start,
   * robots and whether its end was already logged. */
  createdAt: number
  gamesPlayed: number
  gameStartedAt?: number
  gameRobots?: number
  gameLogged?: boolean
}

/**
 * A room code not already in use. Collisions are vanishingly unlikely (36^4 codes, a handful of rooms at a time),
 * but checked for anyway rather than assumed away.
 * @param rooms
 */
const generateRoomCode = (rooms: Map<string, Room>): string => {
  let code: string
  do {
    code = Array.from({ length: 4 }, () => ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)]).join('')
  } while (rooms.has(code))
  return code
}

/**
 * The state of a room, in the shape sent to clients.
 * @param rooms
 * @param roomCode
 */
const roomState = (rooms: Map<string, Room>, roomCode: string): RoomState => {
  const room = rooms.get(roomCode) as Room
  return {
    roomCode,
    roomName: room.roomName,
    hostId: room.hostId,
    players: [...room.players].map(([id, name]) => ({ id, name })),
    maxRobots: Math.max(0, MAX_PLAYERS - room.players.size)
  }
}

/** What GET /status answers: whether the lobby is up, since when, and how busy it is (counts only: no names or room
 * codes, since anyone can read it). The status page (status.html) shows it to players. */
export interface LobbyStatus {
  service: 'cloakfall-lobby'
  status: 'up'
  version: string
  startedAt: string
  uptimeSeconds: number
  rooms: number
  games: number
  players: number
  /** Counts since the server started (usage.ts). */
  totals: UsageTotals
}

/**
 * The plain HTTP side of the lobby (socket.io handles its own /socket.io/ path before this runs): GET /status answers
 * with LobbyStatus, readable from any page (it holds nothing private); anything else is a 404.
 * @param status
 */
const httpHandler = (status: () => LobbyStatus) => (request: IncomingMessage, response: ServerResponse): void => {
  const path = (request.url ?? '').split('?')[0]
  if (path === '/status' && (request.method === 'GET' || request.method === 'HEAD')) {
    response.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*'
    })
    response.end(request.method === 'HEAD' ? undefined : JSON.stringify(status()))
    return
  }
  response.writeHead(404, { 'Content-Type': 'text/plain' })
  response.end('Not found')
}

/** How a lobby event answers its sender (socket.io's acknowledgement callback). */
type Ack = (answer: object) => void

/**
 * Listen for a client event without trusting what arrives: a payload that isn't an object is treated as an empty
 * one, a missing acknowledgement callback becomes a no-op, and anything the handler throws is logged and answered
 * with an error. Without this, one hand-built message (no callback, a null payload, a number where a name goes)
 * threw out of the handler and ended the whole Node process, for every room.
 * @param socket
 * @param event
 * @param handler
 */
const on = (socket: Socket, event: string, handler: (payload: Record<string, unknown>, ack: Ack) => void): void => {
  socket.on(event, (payload: unknown, ack: unknown) => {
    const reply: Ack = typeof ack === 'function' ? ack as Ack : () => {}
    try {
      handler(isRecord(payload) ? payload : {}, reply)
    } catch (error) {
      console.error(`cloakfall lobby: ${event} failed: ${(error as Error)?.message ?? error}`)
      reply({ error: 'Something went wrong, please try again' })
    }
  })
}

/** The answer for a name that is missing or too long. */
const NAME_ERRORS = ['A name is required', `Names can be up to ${MAX_PLAYER_NAME} characters`] as const

/** How often idle rooms and old failed lookups are cleared out (ms), or every roomIdleMs if that is shorter. */
const SWEEP_INTERVAL_MS = 60 * 1000

/** What a lobby server can be started with; everything has a default. */
export interface LobbyOptions {
  /** Changes to DEFAULT_LIMITS (see limits.ts). */
  limits?: Partial<LobbyLimits>
  /** Page origins allowed to connect (e.g. https://joshuaheagle.com); empty or missing allows any. A connection
   * that says no origin at all (not a browser) is allowed either way: this stops other sites from using the lobby
   * from their pages, it isn't authentication. */
  origins?: string[]
  /** Where the usage log's lines go (usage.ts); the server's own runner passes console.log. None: nothing written. */
  usageLog?: (line: string) => void
}

/**
 * The remote lobby: players create or join a room by a short code, and see who else is in it as they join or
 * leave. This is hosting, joining and presence only - nothing about actual gameplay is wired up here.
 *
 * If the host disconnects, the room closes for everyone rather than picking a new host - simplest for a first
 * version; worth revisiting if a host leaving mid-session turns out to be disruptive in practice.
 *
 * Limits (limits.ts, hardening H3/H4/H5): connections per network address, messages per connection (a token
 * bucket; a connection that keeps going after being refused is closed), the largest message, rooms open at once,
 * one room per connection, failed room-code lookups per address (so codes can't be scanned), and idle rooms closed.
 * @param options
 */
export const createLobbyServer = (options: LobbyOptions = {}): HttpServer => {
  const limits: LobbyLimits = { ...DEFAULT_LIMITS, ...options.limits }
  const origins = options.origins ?? []
  const startedAt = new Date()
  const rooms = new Map<string, Room>()
  const connectionsByAddress = new Map<string, number>()
  const failedLookups = createFailureCounter(limits.maxFailedLookups, limits.failedLookupWindowMs)
  const usage = createUsageLog(options.usageLog)
  const httpServer: HttpServer = createServer(httpHandler(() => ({
    service: 'cloakfall-lobby',
    status: 'up',
    version,
    startedAt: startedAt.toISOString(),
    uptimeSeconds: Math.floor((Date.now() - startedAt.getTime()) / 1000),
    rooms: rooms.size,
    games: [...rooms.values()].filter(room => room.game && !isRoomGameOver(room.game)).length,
    players: io.engine.clientsCount,
    totals: usage.totals()
  })))
  const io: Server = new Server(httpServer, {
    maxHttpBufferSize: limits.maxMessageBytes,
    cors: { origin: origins.length ? origins : '*' },
    // CORS alone only covers the polling transport: browsers don't apply it to WebSockets, so check the Origin
    // header on every handshake too.
    allowRequest: (request, callback) => {
      const origin = request.headers.origin
      callback(null, !origins.length || origin === undefined || origins.includes(origin))
    }
  })

  /**
   * Close a room for everyone in it: stop its game (so no timer keeps playing it) and forget it.
   * @param roomCode
   */
  /**
   * Log a room's current game as stopped before its end (a restart, back to the lobby, the room closing), once.
   * A finished game was already logged as finished.
   * @param room
   * @param reason
   */
  const logGameStopped = (room: Room, reason: 'restart' | 'lobby' | 'host-left' | 'idle'): void => {
    if (!room.game || room.gameLogged || isRoomGameOver(room.game)) {
      return
    }
    room.gameLogged = true
    usage.record('game-stopped', {
      reason,
      humans: room.game.playerBySocket.size,
      robots: room.gameRobots ?? 0,
      minutes: minutesSince(room.gameStartedAt ?? Date.now(), Date.now())
    })
  }

  /**
   * Start a game in a room (startGame, and a host's restart): its players become the human players, in join order,
   * and `robots` fill seats. Its pushes go to each player's own socket, and only while it is still the room's game:
   * a game that was stopped (closed room, host's restart or return to lobby) never pushes again, even if a step it had
   * already queued finishes after.
   * @param room
   * @param hints
   * @param robots
   */
  const beginGame = (room: Room, hints: HintSetting, robots: number, restart: boolean = false): void => {
    room.lastStart = { hints, robots }
    room.gameStartedAt = Date.now()
    room.gameRobots = robots
    room.gameLogged = false
    room.gamesPlayed += 1
    usage.record('game-started', { humans: room.players.size, robots, hints, restart })
    // room.broadcastGame does not exist yet at this exact line - startRoomGame's own placement timer will not
    // fire for a good two minutes, long after the next line assigns it, so the closure below still reads
    // the real function by the time it's ever actually called.
    const game = startRoomGame([...room.players.entries()], hints, () => room.broadcastGame?.(), robots)
    room.game = game
    room.broadcastGame = watchRoomGame(game, (socketId, redactedBody) => {
      if (room.game !== game) {
        return
      }
      if (!room.gameLogged && isRoomGameOver(game)) {
        room.gameLogged = true
        usage.record('game-finished', {
          humans: game.playerBySocket.size,
          robots: room.gameRobots ?? 0,
          minutes: minutesSince(room.gameStartedAt ?? Date.now(), Date.now()),
          turns: game.players.reduce((turns, player) => turns + (player.turnCnt || 0), 0)
        })
      }
      room.lastActivity = Date.now()
      io.to(socketId).emit('gameUpdate', forTransport(redactedBody))
    })
  }

  const closeRoom = (roomCode: string, reason: 'host-left' | 'idle'): void => {
    const room = rooms.get(roomCode)
    if (!room) {
      return
    }
    logGameStopped(room, reason)
    usage.record('room-closed', { reason, players: room.players.size, games: room.gamesPlayed, minutes: minutesSince(room.createdAt, Date.now()) })
    room.game?.stop()
    room.broadcastGame = undefined
    rooms.delete(roomCode)
    io.to(roomCode).emit('roomClosed')
    io.in(roomCode).socketsLeave(roomCode)
  }

  const sweep = setInterval(() => {
    const idleSince = Date.now() - limits.roomIdleMs
    rooms.forEach((room, roomCode) => {
      if (room.lastActivity < idleSince) {
        closeRoom(roomCode, 'idle')
      }
    })
    failedLookups.sweep()
  }, Math.min(SWEEP_INTERVAL_MS, limits.roomIdleMs))
  // unref so the sweep never keeps the process (or a test) alive on its own; optional for jsdom test runs.
  ;(sweep as { unref?: () => void }).unref?.()
  httpServer.on('close', () => clearInterval(sweep))

  // Connections per network address, counted from the handshake to the disconnect.
  io.use((socket, next) => {
    const address = clientAddress(socket, limits.trustProxy)
    const count = connectionsByAddress.get(address) ?? 0
    if (count >= limits.maxConnectionsPerAddress) {
      next(new Error('Too many connections from your network, please close some tabs and try again'))
      return
    }
    connectionsByAddress.set(address, count + 1)
    socket.data.address = address
    socket.on('disconnect', () => {
      const left = (connectionsByAddress.get(address) ?? 1) - 1
      if (left > 0) {
        connectionsByAddress.set(address, left)
      } else {
        connectionsByAddress.delete(address)
      }
    })
    next()
  })

  io.on('connection', (socket: Socket) => {
    let currentRoom: string | null = null
    const address: string = socket.data.address
    const inRoom = (): boolean => currentRoom !== null && rooms.has(currentRoom)

    // Messages per connection: one that comes too fast is answered with an error (if it asked for an answer) and
    // dropped, and a connection that keeps going after many refusals is closed.
    const bucket = createRateLimiter(limits.messagesPerSecond, limits.messageBurst)
    let refused = 0
    socket.use((packet, next) => {
      if (bucket.take()) {
        const room = currentRoom ? rooms.get(currentRoom) : undefined
        if (room) {
          room.lastActivity = Date.now()
        }
        next()
        return
      }
      refused += 1
      const ack = packet[packet.length - 1]
      if (typeof ack === 'function') {
        ack({ error: 'Too many messages, please slow down' })
      }
      if (refused >= limits.maxRefusedMessages) {
        socket.disconnect(true)
      }
    })

    /**
     * Whether this address has failed too many room-code lookups lately; answers the caller if so. Checked before
     * looking the code up at all, so a blocked scanner learns nothing, not even from a real code.
     * @param ack
     */
    const lookupsBlocked = (ack: Ack): boolean => {
      if (!failedLookups.blocked(address)) {
        return false
      }
      ack({ error: 'Too many tries with codes that don\'t exist, please wait a few minutes' })
      return true
    }

    on(socket, 'createRoom', (payload, ack) => {
      const name = cleanName(payload.name, MAX_PLAYER_NAME, ...NAME_ERRORS)
      if ('error' in name) {
        ack(name)
        return
      }
      const roomName = cleanName(payload.roomName, MAX_LOBBY_NAME, 'A lobby name is required', `Lobby names can be up to ${MAX_LOBBY_NAME} characters`)
      if ('error' in roomName) {
        ack(roomName)
        return
      }
      if (inRoom()) {
        ack({ error: 'Already in a room' })
        return
      }
      if (rooms.size >= limits.maxRooms) {
        ack({ error: 'The lobby is full right now, please try again in a few minutes' })
        return
      }
      const roomCode = generateRoomCode(rooms)
      rooms.set(roomCode, { roomName: roomName.name, hostId: socket.id, players: new Map([[socket.id, name.name]]), lastActivity: Date.now(), createdAt: Date.now(), gamesPlayed: 0 })
      usage.record('room-created', {})
      currentRoom = roomCode
      socket.join(roomCode)
      ack(roomState(rooms, roomCode))
    })

    // A read-only lookup, callable before the caller has even entered their own name or joined anything - lets
    // a joiner see whose lobby it is (see mainMenu.ts's remote-join-confirm) before they commit to anything.
    on(socket, 'peekRoom', ({ roomCode }, ack) => {
      if (lookupsBlocked(ack)) {
        return
      }
      const room = typeof roomCode === 'string' ? rooms.get(roomCode) : undefined
      if (!room) {
        failedLookups.fail(address)
        ack({ error: 'No room with that code' })
        return
      }
      ack({ roomName: room.roomName, hostName: room.players.get(room.hostId) as string })
    })

    on(socket, 'joinRoom', (payload, ack) => {
      const name = cleanName(payload.name, MAX_PLAYER_NAME, ...NAME_ERRORS)
      if ('error' in name) {
        ack(name)
        return
      }
      if (inRoom()) {
        ack({ error: 'Already in a room' })
        return
      }
      if (lookupsBlocked(ack)) {
        return
      }
      const roomCode = typeof payload.roomCode === 'string' ? payload.roomCode : ''
      const room = rooms.get(roomCode)
      if (!room) {
        failedLookups.fail(address)
        ack({ error: 'No room with that code' })
        return
      }
      if (room.players.size >= MAX_PLAYERS) {
        ack({ error: 'That room is full' })
        return
      }
      room.players.set(socket.id, name.name)
      usage.record('room-joined', { players: room.players.size })
      currentRoom = roomCode
      socket.join(roomCode)
      const state = roomState(rooms, roomCode)
      ack(state)
      socket.to(roomCode).emit('roomUpdate', state)
    })

    on(socket, 'startGame', ({ hints, robots = 0 }, ack) => {
      if (!isHintSetting(hints)) {
        ack({ error: 'Unknown hint setting' })
        return
      }
      if (!Number.isInteger(robots)) {
        ack({ error: 'The number of robots must be a whole number' })
        return
      }
      const room = currentRoom ? rooms.get(currentRoom) : undefined
      if (!room) {
        ack({ error: 'No room to start a game in' })
        return
      }
      if (socket.id !== room.hostId) {
        ack({ error: 'Only the host can start the game' })
        return
      }
      if (room.game && !isRoomGameOver(room.game)) {
        ack({ error: 'The game has already started' })
        return
      }
      if (room.players.size < MIN_PLAYERS_TO_START) {
        ack({ error: `Need at least ${MIN_PLAYERS_TO_START} players to start` })
        return
      }
      // Robots only ever fill the seats this room's own human players haven't - never grow the room past
      // MAX_PLAYERS in total.
      if ((robots as number) < 0 || (robots as number) > MAX_PLAYERS - room.players.size) {
        ack({ error: `Robots can only fill the ${MAX_PLAYERS - room.players.size} remaining seat(s)` })
        return
      }
      beginGame(room, hints, robots as number)
      ack({ started: true })
    })

    // The host's game menu, mid-game: end the game for everyone and go back to the waiting room ('lobby'), or end it
    // and start a new one with the same settings at once ('restart'). Everyone is sent backToLobby with the room's
    // state first (the client goes back to the waiting room, which listens for the next game's first push).
    on(socket, 'hostGameAction', (payload, ack) => {
      const action = isRecord(payload) ? payload.action : undefined
      if (action !== 'restart' && action !== 'lobby') {
        ack({ error: 'Unknown game action' })
        return
      }
      const room = currentRoom ? rooms.get(currentRoom) : undefined
      if (!room || !currentRoom) {
        ack({ error: 'No room' })
        return
      }
      if (socket.id !== room.hostId) {
        ack({ error: 'Only the host can do that' })
        return
      }
      if (!room.game) {
        ack({ error: 'No game to end' })
        return
      }
      if (action === 'restart' && room.players.size < MIN_PLAYERS_TO_START) {
        ack({ error: `Need at least ${MIN_PLAYERS_TO_START} players to start` })
        return
      }
      logGameStopped(room, action)
      room.game.stop()
      room.game = undefined
      room.broadcastGame = undefined
      io.to(currentRoom).emit('backToLobby', roomState(rooms, currentRoom))
      if (action === 'restart') {
        const last = room.lastStart ?? { hints: 'optional' as HintSetting, robots: 0 }
        // Robots fill the seats the humans don't; fewer seats if someone joined since (never past MAX_PLAYERS)
        beginGame(room, last.hints, Math.min(last.robots, MAX_PLAYERS - room.players.size), true)
      }
      ack({ ok: true })
    })

    on(socket, 'gameAction', payload => {
      const envelope = cleanGameAction(payload)
      const room = currentRoom ? rooms.get(currentRoom) : undefined
      if (!envelope || !room?.game) {
        return
      }
      // Choosing the turn order (Random, or Set order's own board clicks) is host-only - enforced here, not just
      // by those controls being disabled on a non-host's own redacted copy, since receiveForwardedEvent dispatches
      // a bare DOM event with no socket identity attached once it reaches whatever listener actually runs.
      if (isHostOnlyStage(room.game.root) && socket.id !== room.hostId) {
        return
      }
      // An id is a real, resolvable server-side reference, not markup a client has to already have on screen to
      // use: a hand-built gameAction payload could name another player's board or controls by id (guessed, or
      // recalled from an earlier push). So resolve the envelope's own target first and work out whose player it
      // belongs to. A stale id (the tree already moved on, or never had it - see treeloom's getItemById) is refused
      // here: it throws for that, never silently resolves to the wrong spot.
      let target: DomItem
      try {
        target = treeloom.getItemById(room.game.root, envelope.itemId) as DomItem
      } catch {
        return
      }
      const sender = room.game.playerBySocket.get(socket.id)
      const ownsTarget = Boolean(sender) && treeloom.getParentsByClass('player', target)[0] === sender
      // A player's own controls (PLAYER_CONTROLS_CLASS: the sensor-scan checkbox, and the in-game control panel
      // later) are theirs alone, in every stage: nobody else may use them, not even the current attacker.
      const inControls = treeloom.getParentsByClass(PLAYER_CONTROLS_CLASS, target).length > 0
      if (inControls && !ownsTarget) {
        return
      }
      // While actively placing, a viewer's own push only ever includes their own player (see redactGameState.ts's
      // applyPlacingView); anything that doesn't land inside the sender's own player is refused.
      if (remotePlacementStage(room.game.root) === 'placing' && !ownsTarget) {
        return
      }
      // Once real gameplay begins (placement/ordering both over), every remote client renders every board, live
      // and clickable, so only the current attacker's own socket may act on the game itself - attackFleet.ts's own
      // player.attacker check refuses the attacker hitting their *own* board, but has no notion of sockets, so this
      // is the socket-identity half it cannot do on its own. Own controls are the exception: their owner may use
      // them at any time, also on someone else's turn (checked just above).
      if (!isRemoteSessionActive(room.game.root) && !inControls) {
        const attacker = room.game.players.find(player => player.attacker)
        if (sender !== attacker) {
          return
        }
      }
      // Plenty of real actions run entirely synchronously (continueTurn, placeCell, finishTurn...), queuing
      // nothing at all - watchRoomGame's own queue hook alone would never see them, so broadcast again
      // unconditionally here too; a queued action's own later pushes (robot turns, animations) still happen
      // on top of this via that hook, unaffected.
      //
      // Wrapped in a try/catch deliberately broader than just the resolve step above: getItemById throwing on
      // a stale/unknown id is the known, expected failure, but the real, already-bound listener this goes on
      // to run (attackListener, remotePlacementListener, ...) is arbitrary application code this handler has
      // no way to fully vouch for - one bad or unexpected click crashing this whole process, for every room
      // and every connected player, is a far worse outcome than silently dropping the one action that caused
      // it. Any real bug surfaced this way is still worth fixing at its own source (see attackListener.ts's
      // own guard against treeloom-matrix's getDomItemFromElement returning false) - this is the backstop under
      // that, not a replacement for it.
      try {
        treeloom.receiveForwardedEvent(room.game.root, envelope)
      } catch {
        return
      }
      room.broadcastGame?.()
    })

    socket.on('disconnect', () => {
      if (!currentRoom || !rooms.has(currentRoom)) {
        return
      }
      const room = rooms.get(currentRoom) as Room
      if (socket.id === room.hostId) {
        closeRoom(currentRoom, 'host-left')
        return
      }
      room.players.delete(socket.id)
      usage.record('player-left', { during: room.game && !isRoomGameOver(room.game) ? 'game' : 'waiting', players: room.players.size })
      io.to(currentRoom).emit('roomUpdate', roomState(rooms, currentRoom))
    })
  })

  return httpServer
}

if (process.argv[1] && process.argv[1].endsWith('lobbyServer.js')) {
  const port = process.env.PORT || 3002
  const settings = settingsFromEnv(process.env)
  createLobbyServer({ ...settings, usageLog: line => console.log(line) }).listen(port, () => console.log(`cloakfall lobby server ${version} listening on port ${port}` +
    (settings.origins.length ? `, for ${settings.origins.join(', ')}` : ', for any origin') +
    (settings.limits.trustProxy ? ', behind a proxy' : '')))
}
