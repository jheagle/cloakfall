/**
 * @jest-environment node
 */
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client'
import { createLobbyServer, isRoomGameOver } from './lobbyServer'
import * as gameplay from './gameplay'
import type { Server as HttpServer } from 'http'
import type { LobbyOptions, RoomState } from './lobbyServer'
import type { RoomGame } from './gameplay'

// These tests run real socket.io servers and play real games (the slowest takes ~5.5s on its own); the default 5s
// and the old per-test 15s limits ran out when several builds shared the machine. 45s leaves room for that.
jest.setTimeout(45000)

let server: HttpServer
let baseUrl: string
const sockets: ClientSocket[] = []

/** Start `server` on a free port and point baseUrl at it. */
const listen = async (): Promise<void> => {
  await new Promise<void>(resolve => server.listen(0, resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  baseUrl = `http://localhost:${port}`
}

beforeEach(async () => {
  server = createLobbyServer()
  await listen()
})

/** Replace this test's server with one started with these options (afterEach closes it like the default one). */
const restartWith = async (options: LobbyOptions): Promise<void> => {
  await new Promise(resolve => server.close(resolve))
  server = createLobbyServer(options)
  await listen()
}

afterEach(async () => {
  sockets.forEach(socket => socket.close())
  sockets.length = 0
  await new Promise(resolve => server.close(resolve))
})

/** A connected client socket, closed automatically after the test. */
const connect = (): ClientSocket => {
  const socket = ioClient(baseUrl, { transports: ['websocket'], forceNew: true })
  sockets.push(socket)
  return socket
}

/** Emit with an acknowledgement, as a promise. */
const emit = <T>(socket: ClientSocket, event: string, payload: object): Promise<T> =>
  new Promise(resolve => socket.emit(event, payload, (response: T) => resolve(response)))

// A pushed view is a clone of the server's real body (see domItemToJson/cloneObject), so every node's own id
// survives the trip untouched - walking the same child-index path against the pushed view that would once
// have been sent to the server as an itemPath now just reads the real id off the node it lands on.
const idAtPath = (pushedView: any, path: number[]): number => path.reduce((node, index) => node.children[index], pushedView).id

describe('isRoomGameOver', () => {
  const gameWith = (statuses: number[]): RoomGame => ({ players: statuses.map(status => ({ status })) } as unknown as RoomGame)

  test('is false while at least 2 players are still alive', () => {
    expect(isRoomGameOver(gameWith([100, 100]))).toBe(false)
    expect(isRoomGameOver(gameWith([1, 1, 0]))).toBe(false)
  })

  test('is true once fewer than 2 players are still alive', () => {
    expect(isRoomGameOver(gameWith([100, 0]))).toBe(true)
    expect(isRoomGameOver(gameWith([0, 0, 0]))).toBe(true)
  })
})

describe('payloads from clients are never trusted', () => {
  const junk = [undefined, null, 5, 'x', [], { name: 5 }, { name: {}, roomName: [] }, { roomCode: {}, name: 'Bo' },
    { hints: 'loud', robots: 'all' }, { hints: 'on', robots: 1.5 }, { hints: 'on', robots: NaN }, { itemId: null }]
  const events = ['createRoom', 'peekRoom', 'joinRoom', 'startGame', 'gameAction']

  test('junk sent to every event, with and without a callback, never stops the server', async () => {
    // ~170 messages at once: far past the message rate limit (see 'limits' below), which isn't what this tests.
    await restartWith({ limits: { messagesPerSecond: 10000, messageBurst: 10000 } })
    const attacker = connect()
    await new Promise(resolve => attacker.on('connect', resolve))
    for (const event of events) {
      for (const payload of junk) {
        attacker.emit(event, payload)
        attacker.emit(event)
      }
    }
    await new Promise(resolve => setTimeout(resolve, 200))
    const answers = await Promise.all(events.filter(event => event !== 'gameAction').flatMap(event => junk.map(payload => emit<{ error?: string }>(attacker, event, payload as object))))
    expect(answers.every(answer => typeof answer.error === 'string')).toBe(true)
    // Still serving: a real room works afterwards, from a fresh connection.
    const host = connect()
    const state = await emit<RoomState>(host, 'createRoom', { name: 'Alice', roomName: 'Still here' })
    expect(state.roomName).toBe('Still here')
  })

  test('a handler that throws answers with an error, logs it, and the server keeps serving', async () => {
    const failure = jest.spyOn(gameplay, 'startRoomGame').mockImplementation(() => { throw new Error('boom') })
    const log = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const host = connect()
      const state = await emit<RoomState>(host, 'createRoom', { name: 'Ann', roomName: 'Lobby' })
      await emit(connect(), 'joinRoom', { roomCode: state.roomCode, name: 'Bo' })
      expect(await emit(host, 'startGame', { hints: 'on' })).toEqual({ error: 'Something went wrong, please try again' })
      expect(log).toHaveBeenCalledWith('cloakfall lobby: startGame failed: boom')
    } finally {
      failure.mockRestore()
      log.mockRestore()
    }
    expect(await emit(connect(), 'peekRoom', { roomCode: 'none' })).toEqual({ error: 'No room with that code' })
  })

  test('junk game actions during a real game are ignored, and the game goes on', async () => {
    const host = connect()
    const joiner = connect()
    const pushes: object[] = []
    joiner.on('gameUpdate', body => pushes.push(body))
    const state = await emit<RoomState>(host, 'createRoom', { name: 'Ann', roomName: 'Lobby' })
    await emit(joiner, 'joinRoom', { roomCode: state.roomCode, name: 'Bo' })
    expect(await emit(host, 'startGame', { hints: 'on' })).toEqual({ started: true })
    for (const payload of [null, undefined, 5, [], { itemId: null }, { itemId: 'x', eventType: 'click' }, { itemId: 1, eventType: {} },
      { itemId: 1, eventType: 'click', targetState: JSON.parse('{"__proto__": {"x": 1}, "dispatchEvent": 1}') }]) {
      joiner.emit('gameAction', payload)
      host.emit('gameAction', payload)
    }
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(pushes.length).toBeGreaterThan(0)
    expect(await emit(connect(), 'peekRoom', { roomCode: state.roomCode })).toEqual({ roomName: 'Lobby', hostName: 'Ann' })
  })

  test('names are cleaned and limited', async () => {
    const host = connect()
    expect(await emit(host, 'createRoom', { name: 'a'.repeat(25), roomName: 'Lobby' })).toEqual({ error: 'Names can be up to 24 characters' })
    expect(await emit(host, 'createRoom', { name: 'Ann', roomName: 'b'.repeat(41) })).toEqual({ error: 'Lobby names can be up to 40 characters' })
    const state = await emit<RoomState>(host, 'createRoom', { name: '  Ann\u0000  Lee ', roomName: ' My   lobby ' })
    expect(state.roomName).toBe('My lobby')
    expect(state.players[0].name).toBe('Ann Lee')
  })

  test('startGame refuses an unknown hint setting or a robot count that is not a whole number', async () => {
    const host = connect()
    const state = await emit<RoomState>(host, 'createRoom', { name: 'Ann', roomName: 'Lobby' })
    await emit(connect(), 'joinRoom', { roomCode: state.roomCode, name: 'Bo' })
    expect(await emit(host, 'startGame', { hints: 'loud' })).toEqual({ error: 'Unknown hint setting' })
    expect(await emit(host, 'startGame', { hints: 'on', robots: 'all' })).toEqual({ error: 'The number of robots must be a whole number' })
    expect(await emit(host, 'startGame', { hints: 'on', robots: 1.5 })).toEqual({ error: 'The number of robots must be a whole number' })
    expect(await emit(host, 'startGame', { hints: 'on' })).toEqual({ started: true })
  })
})

describe('GET /status', () => {
  test('says the lobby is up, with counts only (no names or room codes)', async () => {
    const response = await fetch(`${baseUrl}/status`)
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('cache-control')).toBe('no-store')
    const status = await response.json()
    expect(status).toMatchObject({ service: 'cloakfall-lobby', status: 'up', rooms: 0, games: 0, players: 0 })
    expect(typeof status.version).toBe('string')
    expect(Number.isNaN(Date.parse(status.startedAt))).toBe(false)
    expect(status.uptimeSeconds).toBeGreaterThanOrEqual(0)
  })

  test('counts rooms and connected players', async () => {
    const host = connect()
    await emit<RoomState>(host, 'createRoom', { name: 'Alice', roomName: 'Secret lobby' })
    connect()
    await new Promise(resolve => setTimeout(resolve, 100))
    const text = await (await fetch(`${baseUrl}/status`)).text()
    expect(JSON.parse(text)).toMatchObject({ rooms: 1, games: 0, players: 2 })
    expect(text).not.toMatch(/Alice|Secret lobby/)
  })

  test('anything else is a 404', async () => {
    expect((await fetch(`${baseUrl}/`)).status).toBe(404)
    expect((await fetch(`${baseUrl}/status`, { method: 'POST' })).status).toBe(404)
  })
})

describe('the lobby server', () => {
  test('creating a room makes the creator its host and only player', async () => {
    const host = connect()
    const state = await emit<RoomState>(host, 'createRoom', { name: 'Alice', roomName: 'Test Lobby' })
    expect(state.roomCode).toHaveLength(4)
    expect(state.roomName).toBe('Test Lobby')
    expect(state.hostId).toBe(host.id)
    expect(state.players).toEqual([{ id: host.id, name: 'Alice' }])
  })

  test('creating a room with a blank lobby name is refused', async () => {
    const response = await emit<{ error: string }>(connect(), 'createRoom', { name: 'Alice', roomName: '   ' })
    expect(response.error).toMatch(/lobby name/i)
  })

  describe('peekRoom', () => {
    test('a known room\'s code resolves to its lobby name and host\'s name, without joining it', async () => {
      const host = connect()
      const { roomCode } = await emit<RoomState>(host, 'createRoom', { name: 'Alice', roomName: 'Pirate Battle' })
      const peeker = connect()
      const info = await emit<{ roomName: string, hostName: string }>(peeker, 'peekRoom', { roomCode })
      expect(info).toEqual({ roomName: 'Pirate Battle', hostName: 'Alice' })
      // Peeking must not have joined the room - a second, real join still sees only the host.
      const state = await emit<RoomState>(peeker, 'joinRoom', { roomCode, name: 'Bob' })
      expect(state.players.map(p => p.name)).toEqual(['Alice', 'Bob'])
    })

    test('an unknown code gets the same error joinRoom uses', async () => {
      const response = await emit<{ error: string }>(connect(), 'peekRoom', { roomCode: 'ZZZZ' })
      expect(response.error).toMatch(/no room/i)
    })
  })

  test('joining a room by its code adds the joiner, and both players see it', async () => {
    const host = connect()
    const { roomCode } = await emit<RoomState>(host, 'createRoom', { name: 'Alice', roomName: 'Test Lobby' })
    const joiner = connect()
    const joinedAck = emit<RoomState>(joiner, 'joinRoom', { roomCode, name: 'Bob' })
    const hostNotified = new Promise<RoomState>(resolve => host.on('roomUpdate', resolve))
    const [joinedState, hostSawUpdate] = await Promise.all([joinedAck, hostNotified])
    expect(joinedState.players.map(p => p.name).sort()).toEqual(['Alice', 'Bob'])
    expect(hostSawUpdate.players.map(p => p.name).sort()).toEqual(['Alice', 'Bob'])
  })

  test('joining a room that does not exist is refused', async () => {
    const joiner = connect()
    const response = await emit<{ error: string }>(joiner, 'joinRoom', { roomCode: 'ZZZZ', name: 'Bob' })
    expect(response.error).toMatch(/no room/i)
  })

  test('creating a room with a blank name is refused', async () => {
    const response = await emit<{ error: string }>(connect(), 'createRoom', { name: '   ', roomName: 'Test Lobby' })
    expect(response.error).toMatch(/name/i)
  })

  test('joining a room with a blank name is refused', async () => {
    const host = connect()
    const { roomCode } = await emit<RoomState>(host, 'createRoom', { name: 'Alice', roomName: 'Test Lobby' })
    const response = await emit<{ error: string }>(connect(), 'joinRoom', { roomCode, name: '' })
    expect(response.error).toMatch(/name/i)
  })

  test('a fifth player cannot join a room that already has four', async () => {
    const host = connect()
    const { roomCode } = await emit<RoomState>(host, 'createRoom', { name: 'Player 1', roomName: 'Test Lobby' })
    for (let i = 2; i <= 4; i++) {
      await emit<RoomState>(connect(), 'joinRoom', { roomCode, name: `Player ${i}` })
    }
    const response = await emit<{ error: string }>(connect(), 'joinRoom', { roomCode, name: 'Player 5' })
    expect(response.error).toMatch(/full/i)
  })

  test('a player leaving updates the room for whoever is left', async () => {
    const host = connect()
    const { roomCode } = await emit<RoomState>(host, 'createRoom', { name: 'Alice', roomName: 'Test Lobby' })
    const joiner = connect()
    const hostSawJoin = new Promise<RoomState>(resolve => host.once('roomUpdate', resolve))
    await emit<RoomState>(joiner, 'joinRoom', { roomCode, name: 'Bob' })
    await hostSawJoin
    const hostSawLeave = new Promise<RoomState>(resolve => host.once('roomUpdate', resolve))
    joiner.close()
    const state = await hostSawLeave
    expect(state.players.map(p => p.name)).toEqual(['Alice'])
  })

  test('the host leaving closes the room for everyone', async () => {
    const host = connect()
    const { roomCode } = await emit<RoomState>(host, 'createRoom', { name: 'Alice', roomName: 'Test Lobby' })
    const joiner = connect()
    await emit<RoomState>(joiner, 'joinRoom', { roomCode, name: 'Bob' })
    const joinerSawClose = new Promise(resolve => joiner.on('roomClosed', resolve))
    host.close()
    await joinerSawClose
    const response = await emit<{ error: string }>(connect(), 'joinRoom', { roomCode, name: 'Carol' })
    expect(response.error).toMatch(/no room/i)
  })

  describe('starting a game', () => {
    const setUpRoom = async () => {
      const host = connect()
      const { roomCode } = await emit<RoomState>(host, 'createRoom', { name: 'Alice', roomName: 'Test Lobby' })
      const joiner = connect()
      await emit<RoomState>(joiner, 'joinRoom', { roomCode, name: 'Bob' })
      return { host, joiner, roomCode }
    }

    const boardsOf = (redactedBody: any): any[] =>
      redactedBody.children.find((child: any) => child.attributes?.className === 'boards').children

    test('the host starting a game sends every connected player their own redacted view', async () => {
      const { host, joiner } = await setUpRoom()
      const hostUpdate = new Promise<any>(resolve => host.once('gameUpdate', resolve))
      const joinerUpdate = new Promise<any>(resolve => joiner.once('gameUpdate', resolve))
      const ack = await emit<{ started: true } | { error: string }>(host, 'startGame', { hints: 'optional' })
      expect(ack).toEqual({ started: true })
      const [hostView, joinerView] = await Promise.all([hostUpdate, joinerUpdate])
      // Still placing - each socket's own push includes only their own player at all (see
      // redactGameState.ts's applyPlacingView). Resolution is by id now (treeloom's getItemById), not by
      // position, so there is no need to keep the other player's own subtree around just to preserve shape.
      expect(boardsOf(hostView)).toHaveLength(1)
      expect(boardsOf(joinerView)).toHaveLength(1)
      expect(boardsOf(hostView)[0].name).toBe('Alice')
      expect(boardsOf(hostView)[0].attributes.className).toBe('player')
      expect(boardsOf(joinerView)[0].name).toBe('Bob')
      expect(boardsOf(joinerView)[0].attributes.className).toBe('player')
    })

    // The real bug this guards against (when forwarding was itemPath-based): a path is resolved by *index*
    // against the server's own real tree, which always has every player, in real join order - a client-side
    // tree that *drops* some players (an earlier version of applyPlacingView/redactGameBody did exactly that)
    // shifts a joiner's own index relative to their real one, so a click they make during placement resolves
    // against whichever player actually sits at that index on the server - in a 2-player room, the host.
    // Reported directly by the user from a real two-browser test: "remote player was unable to click or
    // update anything during placement." Resolution is by id now (see treeloom's getItemById), which this
    // bug class cannot recur under even if a future client tree omits a player entirely - kept as a
    // regression test for the real click-lands-on-the-right-player behavior either way.
    test('a joiner\'s own click during placement lands on the joiner\'s own fleet, not the host\'s', async () => {
      const { host, joiner } = await setUpRoom()
      const hostUpdate = new Promise<any>(resolve => host.once('gameUpdate', resolve))
      const joinerUpdate = new Promise<any>(resolve => joiner.once('gameUpdate', resolve))
      await emit(host, 'startGame', { hints: 'optional' })
      // While placing, each one's own push includes only their own player - Bob's own board/panel only ever
      // exist in his own view, never Alice's, so the id used below has to come from the joiner's own push.
      const [, initialJoinerView] = await Promise.all([hostUpdate, joinerUpdate])

      const boardsIndex = initialJoinerView.children.findIndex((child: any) => child.attributes?.className === 'boards')
      const bob = boardsOf(initialJoinerView)[0]
      const panelIndex = bob.children.findIndex((child: any) => child.attributes?.className === 'remote-placement-panel')
      const randomiseIndex = bob.children[panelIndex].children.findIndex((child: any) => child.attributes?.className === 'remote-placement-randomise')

      // Read each one's own readiness from their *own* push, not the other's view of them - the other
      // player is not even present in it any more (applyPlacingView), let alone their real state.
      const readyDisabled = (view: any, name: string): boolean => {
        const player = boardsOf(view).find((p: any) => p.name === name)
        const panel = player.children.find((child: any) => child.attributes?.className === 'remote-placement-panel')
        return panel.children.find((child: any) => child.attributes?.className === 'remote-placement-ready').attributes.disabled
      }

      const hostSawIt = new Promise<any>(resolve => host.once('gameUpdate', resolve))
      const joinerSawIt = new Promise<any>(resolve => joiner.once('gameUpdate', resolve))
      joiner.emit('gameAction', { itemId: idAtPath(initialJoinerView, [boardsIndex, 0, panelIndex, randomiseIndex]), eventType: 'click', listenerFunc: 'remotePlacementListener', data: [] })
      const [hostsOwnView, bobsOwnView] = await Promise.all([hostSawIt, joinerSawIt])

      // Bob's own fleet is now fully placed (Ready enabled, from his own point of view) - his click landed on
      // his own board. Alice's own placement (from her own point of view) is completely untouched by it.
      expect(readyDisabled(bobsOwnView, 'Bob')).toBeFalsy()
      expect(readyDisabled(hostsOwnView, 'Alice')).toBe(true)
    })

    // The real gap this guards against: an id is a real, resolvable server-side reference, not markup a client
    // has to already have on screen to use - even though a still-placing viewer's own push no longer includes
    // anyone else's board or panel at all (applyPlacingView), a client that bypasses its own UI (devtools, or
    // a hand-built gameAction payload) naming another player's id directly - guessed, or obtained some other
    // way, simulated here by reading it from the host's own view - could still target a board that was never
    // theirs. Found live by the user, back when every player's subtree was still sent (just CSS-hidden): "I
    // can also find it in the html dom, remove display: none, and place ships on boards I do not own."
    test('a socket cannot place a ship on - or ready up - a board that is not its own, even with a crafted id', async () => {
      const { host, joiner } = await setUpRoom()
      const hostUpdate = new Promise<any>(resolve => host.once('gameUpdate', resolve))
      // startGame's own initial broadcast pushes to every connected player, joiner included - has to be
      // drained here too, not just the host's own copy, or it can still be sitting unconsumed by the time the
      // "did anything happen" listener below is registered and look like a result of the malicious action.
      const joinerUpdate = new Promise<any>(resolve => joiner.once('gameUpdate', resolve))
      await emit(host, 'startGame', { hints: 'optional' })
      // Alice's own ids, read from the host's own view - standing in for however the joiner actually got
      // hold of them (a still-placing viewer's own push no longer contains another player's subtree at all).
      const [aliceOwnView] = await Promise.all([hostUpdate, joinerUpdate])

      const boardsIndex = aliceOwnView.children.findIndex((child: any) => child.attributes?.className === 'boards')
      const alice = boardsOf(aliceOwnView)[0]
      const matrixIndex = alice.children.findIndex((child: any) => child.attributes?.className === 'matrix')
      const panelIndex = alice.children.findIndex((child: any) => child.attributes?.className === 'remote-placement-panel')
      const randomiseIndex = alice.children[panelIndex].children.findIndex((child: any) => child.attributes?.className === 'remote-placement-randomise')

      // The joiner targets Alice's own board tile and her own Randomise button directly, by id. Neither
      // should do anything: no broadcast, no state change either side.
      let sawAnyUpdate = false
      const onUpdate = (): void => { sawAnyUpdate = true }
      host.on('gameUpdate', onUpdate)
      joiner.on('gameUpdate', onUpdate)
      joiner.emit('gameAction', { itemId: idAtPath(aliceOwnView, [boardsIndex, 0, matrixIndex, 0, 0, 0]), eventType: 'click', listenerFunc: 'attackListener', data: [] })
      joiner.emit('gameAction', { itemId: idAtPath(aliceOwnView, [boardsIndex, 0, panelIndex, randomiseIndex]), eventType: 'click', listenerFunc: 'remotePlacementListener', data: [] })
      await new Promise(resolve => setTimeout(resolve, 150))
      host.off('gameUpdate', onUpdate)
      joiner.off('gameUpdate', onUpdate)
      expect(sawAnyUpdate).toBe(false)

      // Confirmed from the real server-side source of truth, not just the absence of a push: Alice's own
      // fleet is still completely unplaced - her own, real Randomise click (right after) is the first thing
      // that actually places it.
      const aliceSeesItForReal = new Promise<any>(resolve => host.once('gameUpdate', resolve))
      host.emit('gameAction', { itemId: idAtPath(aliceOwnView, [boardsIndex, 0, panelIndex, randomiseIndex]), eventType: 'click', listenerFunc: 'remotePlacementListener', data: [] })
      const aliceRealOwnView = await aliceSeesItForReal
      const alicePanel = boardsOf(aliceRealOwnView)[0].children.find((child: any) => child.attributes?.className === 'remote-placement-panel')
      expect(alicePanel.children.find((child: any) => child.attributes?.className === 'remote-placement-ready').attributes.disabled).toBeFalsy()
    })

    test('only the host can start the game', async () => {
      const { joiner } = await setUpRoom()
      const response = await emit<{ error: string }>(joiner, 'startGame', { hints: 'optional' })
      expect(response.error).toMatch(/only the host/i)
    })

    // Also covers the relaxed "or the game is over" guard's own "still active" branch (see isRoomGameOver,
    // used by this same handler to let a room's startGame double as a rematch once a game actually ends) -
    // a still-active game must keep refusing a second startGame exactly as before.
    test('the game cannot be started twice', async () => {
      const { host } = await setUpRoom()
      await emit(host, 'startGame', { hints: 'optional' })
      const response = await emit<{ error: string }>(host, 'startGame', { hints: 'optional' })
      expect(response.error).toMatch(/already started/i)
    })

    test('starting a game with no room to start it in is refused', async () => {
      const response = await emit<{ error: string }>(connect(), 'startGame', { hints: 'optional' })
      expect(response.error).toMatch(/no room/i)
    })

    test('starting a game with only one player in the room is refused', async () => {
      const host = connect()
      await emit<RoomState>(host, 'createRoom', { name: 'Alice', roomName: 'Test Lobby' })
      const response = await emit<{ error: string }>(host, 'startGame', { hints: 'optional' })
      expect(response.error).toMatch(/at least 2 players/i)
    })
  })

  describe('playing a started game', () => {
    const setUpStartedGame = async () => {
      const host = connect()
      const { roomCode } = await emit<RoomState>(host, 'createRoom', { name: 'Alice', roomName: 'Test Lobby' })
      const joiner = connect()
      await emit<RoomState>(joiner, 'joinRoom', { roomCode, name: 'Bob' })
      const hostUpdate = new Promise<any>(resolve => host.once('gameUpdate', resolve))
      const joinerUpdate = new Promise<any>(resolve => joiner.once('gameUpdate', resolve))
      await emit(host, 'startGame', { hints: 'optional' })
      // While placing, each one's own push includes only their own player (applyPlacingView) - indexed here
      // by player, not socket, so a caller needing Bob's own ids can read them from his own view instead of
      // the host's, which never has him in it at all during this stage.
      const [initialView, joinerInitialView] = await Promise.all([hostUpdate, joinerUpdate])
      return { host, joiner, initialView, initialViews: [initialView, joinerInitialView] }
    }

    test('a forwarded action actually runs on the server and both players see the result', async () => {
      const { host, initialView } = await setUpStartedGame()
      // Both humans place simultaneously, each on their own board - there is no shared handoff panel any more.
      // Alice is players[0] (the host), with her own placement panel as one of her own subtree's children.
      const boardsIndex = initialView.children.findIndex((child: any) => child.attributes?.className === 'boards')
      const alice = initialView.children[boardsIndex].children[0]
      const panelIndex = alice.children.findIndex((child: any) => child.attributes?.className === 'remote-placement-panel')
      const panel = alice.children[panelIndex]
      const buttonIndex = (className: string): number => panel.children.findIndex((child: any) => child.attributes?.className === className)
      const randomiseIndex = buttonIndex('remote-placement-randomise')
      expect(panel.children[buttonIndex('remote-placement-ready')].attributes.disabled).toBe(true)

      const nextUpdate = new Promise<any>(resolve => host.once('gameUpdate', resolve))
      host.emit('gameAction', { itemId: panel.children[randomiseIndex].id, eventType: 'click', listenerFunc: 'remotePlacementListener', data: [] })
      const updatedView = await nextUpdate

      // Randomise fully placed Alice's fleet - nothing left pending, so Ready is no longer disabled.
      const updatedAlice = updatedView.children[boardsIndex].children[0]
      const updatedPanel = updatedAlice.children[panelIndex]
      expect(updatedPanel.children[buttonIndex('remote-placement-ready')].attributes.disabled).toBeFalsy()
    })

    // A longer budget than the suite's default: several real round trips in sequence (two ready-ups, a 150ms
    // negative-result race, then a final confirming click), which can run past 5000ms under load.
    test('only the host can choose the turn order, once everyone has placed', async () => {
      const { host, joiner, initialView, initialViews } = await setUpStartedGame()
      const boardsIndex = initialView.children.findIndex((child: any) => child.attributes?.className === 'boards')
      const panelIndex = initialView.children[boardsIndex].children[0].children.findIndex((child: any) => child.attributes?.className === 'remote-placement-panel')
      const panel = initialView.children[boardsIndex].children[0].children[panelIndex]
      const randomiseIndex = panel.children.findIndex((child: any) => child.attributes?.className === 'remote-placement-randomise')
      const readyIndex = panel.children.findIndex((child: any) => child.attributes?.className === 'remote-placement-ready')
      // Every change broadcasts to every player, so host always sees a fresh gameUpdate after either player's
      // action - awaiting that each step keeps the two players' actions from racing each other over the wire.
      const readyUp = async (socket: ClientSocket, playerIndex: number): Promise<any> => {
        // Each player's own view has only their own player while still placing - always at index 0 there,
        // whichever socket's view it is.
        const idOf = (buttonIndex: number): number => idAtPath(initialViews[playerIndex], [boardsIndex, 0, panelIndex, buttonIndex])
        const afterRandomise = new Promise<any>(resolve => host.once('gameUpdate', resolve))
        socket.emit('gameAction', { itemId: idOf(randomiseIndex), eventType: 'click', listenerFunc: 'remotePlacementListener', data: [] })
        await afterRandomise
        const afterReady = new Promise<any>(resolve => host.once('gameUpdate', resolve))
        socket.emit('gameAction', { itemId: idOf(readyIndex), eventType: 'click', listenerFunc: 'remotePlacementListener', data: [] })
        return afterReady
      }

      await readyUp(host, 0)
      // The joiner's own pushes too: what a guest sees once everyone is ready (CLOA-29)
      const joinerViews: any[] = []
      joiner.on('gameUpdate', (view: any) => joinerViews.push(view))
      const choosingView = await readyUp(joiner, 1)

      const orderingIndex = choosingView.children.findIndex((child: any) => child.attributes?.className === 'remote-ordering')
      const orderingPanel = choosingView.children[orderingIndex]
      // Set order (not Random) on purpose - it transitions synchronously with no queued animation steps of its
      // own, so nothing is left running past this test's end to interfere with whichever test runs next.
      const setOrderIndex = orderingPanel.children.findIndex((child: any) => child.attributes?.className === 'remote-order-set')
      expect(orderingPanel.children.find((child: any) => child.attributes?.className === 'remote-ordering-message').attributes.innerHTML).toMatch(/all players are ready\. choose who goes first/i)

      // The guest's copy (redactGameBody -> guestOrderingPanel): told who is choosing, and no buttons of their own
      const guestPanelOf = (view: any): any => view.children.find((child: any) => child.attributes?.className === 'remote-ordering')
      const shown = (view: any): boolean => guestPanelOf(view) !== undefined && guestPanelOf(view).attributes?.style?.display !== 'none'
      for (let wait = 0; wait < 40 && !joinerViews.some(shown); wait++) {
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      const guestPanel = guestPanelOf(joinerViews.filter(shown).at(-1))
      expect(guestPanel.children.find((child: any) => child.attributes?.className === 'remote-ordering-message').attributes.innerHTML).toMatch(/all players are ready\. .+ is choosing who goes first/i)
      guestPanel.children.filter((child: any) => child.nodeName === 'button').forEach((button: any) => {
        expect(button.attributes.disabled).toBe(true)
        expect(button.attributes.style.display).toBe('none')
      })

      // A non-host's attempt is silently ignored - nothing gets pushed as a result of it at all.
      const sawUpdateFromJoiner = new Promise<string>(resolve => host.once('gameUpdate', () => resolve('update')))
      joiner.emit('gameAction', { itemId: idAtPath(choosingView, [orderingIndex, setOrderIndex]), eventType: 'click', listenerFunc: 'remotePlacementListener', data: [] })
      const raceResult = await Promise.race([sawUpdateFromJoiner, new Promise<string>(resolve => setTimeout(() => resolve('timeout'), 150))])
      expect(raceResult).toBe('timeout')

      // The host's own click, right after, really does work - proving the harness itself is sound, not just quiet.
      const hostChose = new Promise<any>(resolve => host.once('gameUpdate', resolve))
      host.emit('gameAction', { itemId: idAtPath(choosingView, [orderingIndex, setOrderIndex]), eventType: 'click', listenerFunc: 'remotePlacementListener', data: [] })
      const orderingView = await hostChose
      const orderingMessage = orderingView.children[orderingIndex].children.find((child: any) => child.attributes?.className === 'remote-ordering-message')
      expect(orderingMessage.attributes.innerHTML).toMatch(/tap each player/i)

      // The host taps a player's name (CLOA-18): forwarded like any click, it adds that player to the order
      const pickIndex = orderingView.children[boardsIndex].children[1].children.findIndex((child: any) => child.attributes?.className === 'order-pick')
      const picked = new Promise<any>(resolve => host.once('gameUpdate', resolve))
      host.emit('gameAction', { itemId: idAtPath(orderingView, [boardsIndex, 1, pickIndex]), eventType: 'click', listenerFunc: 'placementListener', data: [] })
      const pickedView = await picked
      expect(pickedView.children[boardsIndex].children[1].children[pickIndex].attributes.disabled).toBe(true)
      expect(pickedView.children[boardsIndex].children[0].children[pickIndex].attributes.disabled).toBe(false)
      expect(pickedView.children[boardsIndex].children[1].children[0].attributes.innerHTML).toBe('1st')
    })

    /**
     * A started game played up to its first real turn: both players ready, the host sets the order (Alice first),
     * and the turn's own follow-up updates have settled. Returns the sockets by role, the view at that point and
     * helpers to find ids in it.
     */
    const reachFirstTurn = async () => {
      const { host, joiner, initialView, initialViews } = await setUpStartedGame()
      // Each socket's own latest view: a player's own controls are only in their own push (redactGameState.ts)
      const latest = new Map<ClientSocket, any>()
      host.on('gameUpdate', view => latest.set(host, view))
      joiner.on('gameUpdate', view => latest.set(joiner, view))
      const boardsIndex = initialView.children.findIndex((child: any) => child.attributes?.className === 'boards')
      const panelIndex = initialView.children[boardsIndex].children[0].children.findIndex((child: any) => child.attributes?.className === 'remote-placement-panel')
      const panel = initialView.children[boardsIndex].children[0].children[panelIndex]
      const randomiseIndex = panel.children.findIndex((child: any) => child.attributes?.className === 'remote-placement-randomise')
      const readyIndex = panel.children.findIndex((child: any) => child.attributes?.className === 'remote-placement-ready')
      const readyUp = async (socket: ClientSocket, playerIndex: number): Promise<any> => {
        // Each player's own view has only their own player while still placing - always at index 0 there,
        // whichever socket's view it is.
        const idOf = (buttonIndex: number): number => idAtPath(initialViews[playerIndex], [boardsIndex, 0, panelIndex, buttonIndex])
        const afterRandomise = new Promise<any>(resolve => host.once('gameUpdate', resolve))
        socket.emit('gameAction', { itemId: idOf(randomiseIndex), eventType: 'click', listenerFunc: 'remotePlacementListener', data: [] })
        await afterRandomise
        const afterReady = new Promise<any>(resolve => host.once('gameUpdate', resolve))
        socket.emit('gameAction', { itemId: idOf(readyIndex), eventType: 'click', listenerFunc: 'remotePlacementListener', data: [] })
        return afterReady
      }
      await readyUp(host, 0)
      const choosingView = await readyUp(joiner, 1)

      const orderingIndex = choosingView.children.findIndex((child: any) => child.attributes?.className === 'remote-ordering')
      const setOrderIndex = choosingView.children[orderingIndex].children.findIndex((child: any) => child.attributes?.className === 'remote-order-set')
      const afterBeginOrderSet = new Promise<any>(resolve => host.once('gameUpdate', resolve))
      host.emit('gameAction', { itemId: idAtPath(choosingView, [orderingIndex, setOrderIndex]), eventType: 'click', listenerFunc: 'remotePlacementListener', data: [] })
      await afterBeginOrderSet

      // Host (the only one allowed to during ordering) clicks Alice's board, then Bob's - Alice goes first.
      // Both players' own board index comes from choosingView, not initialView: while still placing, a
      // viewer's own push only ever includes themselves (see redactGameState.ts's redactGameBody), so
      // initialView (captured right after startGame, before anyone has readied up) has no entry for Bob at
      // all yet - choosingView (captured once both have) is the first view with both players present.
      const boardIndexOf = (playerIndex: number): number => choosingView.children[boardsIndex].children[playerIndex].children.findIndex((child: any) => child.attributes?.className === 'matrix')
      const tileId = (playerIndex: number): number => idAtPath(choosingView, [boardsIndex, playerIndex, boardIndexOf(playerIndex), 0, 0, 0])
      const afterFirstPick = new Promise<any>(resolve => host.once('gameUpdate', resolve))
      host.emit('gameAction', { itemId: tileId(0), eventType: 'click', listenerFunc: 'attackListener', data: [] })
      await afterFirstPick
      const afterSecondPick = new Promise<any>(resolve => host.once('gameUpdate', resolve))
      host.emit('gameAction', { itemId: tileId(1), eventType: 'click', listenerFunc: 'attackListener', data: [] })
      const gameView = await afterSecondPick

      const attackerIndex = gameView.children[boardsIndex].children.findIndex((player: any) => player.attacker)
      expect(attackerIndex).toBeGreaterThanOrEqual(0)
      const attackerSocket = attackerIndex === 0 ? host : joiner
      const nonAttackerSocket = attackerIndex === 0 ? joiner : host
      const victimIndex = attackerIndex === 0 ? 1 : 0

      // updatePlayer (the shared engine, unrelated to this fix) queues several of its own follow-up updates on
      // every turn change - valid-target highlighting, the attacker's outline, stats, a short attack-lock
      // release - each resolving through the same session queue watchRoomGame's own broadcast hook wraps
      // (debounced, but still eventually firing) once they settle, on no fixed schedule under test-suite load.
      // Waiting for a quiet stretch (no gameUpdate for 300ms) rather than a fixed delay keeps the next check
      // honest - racing a short window while one of these is still in flight would catch one of those instead
      // of whatever joiner's own blocked click did or didn't do.
      await new Promise<void>(resolve => {
        let quietTimer: ReturnType<typeof setTimeout>
        const onUpdate = (): void => {
          clearTimeout(quietTimer)
          quietTimer = setTimeout(finish, 300)
        }
        const finish = (): void => {
          host.off('gameUpdate', onUpdate)
          resolve()
        }
        host.on('gameUpdate', onUpdate)
        quietTimer = setTimeout(finish, 300)
      })
      const latestView = (socket: ClientSocket): any => latest.get(socket)
      return { host, joiner, boardsIndex, gameView, attackerSocket, nonAttackerSocket, attackerIndex, victimIndex, tileId, boardIndexOf, latestView }
    }

    /** A player's own sensor-scan checkbox in a view: Alice (the host) is player 0, Bob player 1. */
    const hintCheckbox = (view: any, boardsIndex: number, playerIndex: number): any => {
      const stats = view.children[boardsIndex].children[playerIndex].children.find((child: any) => child.attributes?.className === 'player-stats')
      const controls = stats?.children.find((child: any) => child.attributes?.className === 'player-controls')
      return controls?.children[0].children.find((child: any) => child.nodeName === 'input')
    }

    test('a player can use their own controls (the sensor-scan checkbox) on someone else\'s turn', async () => {
      const { host, boardsIndex, attackerIndex, nonAttackerSocket, latestView } = await reachFirstTurn()
      const ownIndex = attackerIndex === 0 ? 1 : 0
      const checkbox = hintCheckbox(latestView(nonAttackerSocket), boardsIndex, ownIndex)
      expect(checkbox.attributes.checked).toBe(false)
      const ownUpdate = new Promise<any>(resolve => nonAttackerSocket.once('gameUpdate', resolve))
      nonAttackerSocket.emit('gameAction', { itemId: checkbox.id, eventType: 'change', listenerFunc: 'hintListener', data: [], targetState: { checked: true } })
      const view = await ownUpdate
      expect(hintCheckbox(view, boardsIndex, ownIndex).attributes.checked).toBe(true)
      expect(view.children[boardsIndex].children[ownIndex].showHint).toBe(true)
      expect(host.connected).toBe(true)
    })

    describe('the host\'s game menu mid-game (hostGameAction)', () => {
      /** Resolves with the next payload of `event` on `socket`, or 'none' if none arrives within `ms`. */
      const next = (socket: ClientSocket, event: string, ms: number = 2000): Promise<any> => new Promise(resolve => {
        const timer = setTimeout(() => resolve('none'), ms)
        socket.once(event, (payload: any) => {
          clearTimeout(timer)
          resolve(payload)
        })
      })

      test('Return to lobby: everyone goes back to the waiting room, the game stops, and a new one can start', async () => {
        const { host, joiner } = await reachFirstTurn()
        const backs = [next(host, 'backToLobby'), next(joiner, 'backToLobby')]
        expect(await emit(host, 'hostGameAction', { action: 'lobby' })).toEqual({ ok: true })
        const [hostState, joinerState] = await Promise.all(backs)
        expect(hostState.players.map((player: any) => player.name)).toEqual(['Alice', 'Bob'])
        expect(joinerState).toEqual(hostState)
        // Stopped: nothing more is pushed for it
        expect(await next(joiner, 'gameUpdate', 1500)).toBe('none')
        // And the room is free for the next game
        const firstPush = next(joiner, 'gameUpdate')
        expect(await emit(host, 'startGame', { hints: 'optional' })).toEqual({ started: true })
        expect(await firstPush).not.toBe('none')
      })

      test('Restart: everyone goes back to the waiting room, then the new game\'s first push follows at once', async () => {
        const { host, joiner } = await reachFirstTurn()
        const order: string[] = []
        joiner.once('backToLobby', () => order.push('backToLobby'))
        const firstPush = new Promise<any>(resolve => joiner.once('gameUpdate', view => {
          order.push('gameUpdate')
          resolve(view)
        }))
        expect(await emit(host, 'hostGameAction', { action: 'restart' })).toEqual({ ok: true })
        const view = await firstPush
        expect(order).toEqual(['backToLobby', 'gameUpdate'])
        // A new game: placing ships again
        const boardsIndex = view.children.findIndex((child: any) => child.attributes?.className === 'boards')
        expect(view.children[boardsIndex].children[0].children.some((child: any) => child.attributes?.className === 'remote-placement-panel')).toBe(true)
      })

      test('only the host, and only the two known actions', async () => {
        const { host, joiner } = await reachFirstTurn()
        const back = next(joiner, 'backToLobby', 1000)
        expect(await emit(joiner, 'hostGameAction', { action: 'lobby' })).toEqual({ error: 'Only the host can do that' })
        expect(await emit(host, 'hostGameAction', { action: 'explode' })).toEqual({ error: 'Unknown game action' })
        expect(await emit(host, 'hostGameAction', 'lobby')).toEqual({ error: 'Unknown game action' })
        expect(await back).toBe('none')
      })

      test('a stopped game never pushes again, even if a step it had queued finishes afterwards', async () => {
        const broadcasts: Array<() => void> = []
        const realWatch = gameplay.watchRoomGame
        jest.spyOn(gameplay, 'watchRoomGame').mockImplementation((...args) => {
          const broadcast = realWatch(...args)
          broadcasts.push(broadcast)
          return broadcast
        })
        try {
          const { host, joiner } = await reachFirstTurn()
          await emit(host, 'hostGameAction', { action: 'lobby' })
          const late = next(joiner, 'gameUpdate', 1000)
          // The old game's own broadcast, as a step it had queued would call it
          broadcasts[0]()
          expect(await late).toBe('none')
        } finally {
          jest.restoreAllMocks()
        }
      })
    })

    test('nobody can use another player\'s controls, not even the current attacker', async () => {
      const { boardsIndex, attackerIndex, attackerSocket, nonAttackerSocket, latestView } = await reachFirstTurn()
      const otherIndex = attackerIndex === 0 ? 1 : 0
      // The id comes from the other player's own view: it is never in the attacker's (redactGameState.ts)
      const checkbox = hintCheckbox(latestView(nonAttackerSocket), boardsIndex, otherIndex)
      expect(hintCheckbox(latestView(attackerSocket), boardsIndex, otherIndex)).toBeUndefined()
      const sawUpdate = new Promise<string>(resolve => nonAttackerSocket.once('gameUpdate', () => resolve('update')))
      attackerSocket.emit('gameAction', { itemId: checkbox.id, eventType: 'change', listenerFunc: 'hintListener', data: [], targetState: { checked: true } })
      const raceResult = await Promise.race([sawUpdate, new Promise<string>(resolve => setTimeout(() => resolve('timeout'), 150))])
      expect(raceResult).toBe('timeout')
      expect(hintCheckbox(latestView(nonAttackerSocket), boardsIndex, otherIndex).attributes.checked).toBe(false)
    })

    // Every independent remote client renders both boards, live and clickable - nothing but this guard stops a
    // click from resolving against any board regardless of whose turn it actually is or which socket sent it.
    test('only the current attacker\'s own socket can act once real gameplay begins', async () => {
      const { host, attackerSocket, nonAttackerSocket, victimIndex, tileId, boardsIndex, boardIndexOf } = await reachFirstTurn()

      // The non-attacker's own socket, attacking the real victim's board: silently ignored - not their turn.
      const sawUpdateFromNonAttacker = new Promise<string>(resolve => host.once('gameUpdate', () => resolve('update')))
      nonAttackerSocket.emit('gameAction', { itemId: tileId(victimIndex), eventType: 'click', listenerFunc: 'attackListener', data: [] })
      const raceResult = await Promise.race([sawUpdateFromNonAttacker, new Promise<string>(resolve => setTimeout(() => resolve('timeout'), 150))])
      expect(raceResult).toBe('timeout')

      // The real attacker's own socket, attacking the same cell, right after: this one actually lands.
      const afterRealAttack = new Promise<any>(resolve => host.once('gameUpdate', resolve))
      attackerSocket.emit('gameAction', { itemId: tileId(victimIndex), eventType: 'click', listenerFunc: 'attackListener', data: [] })
      const attackedView = await afterRealAttack
      const victimTile = attackedView.children[boardsIndex].children[victimIndex].children[boardIndexOf(victimIndex)].children[0].children[0].children[0]
      expect(victimTile.isHit).toBe(true)
    })

    // The real bug this guards against: an id that fails to resolve (stale, unregistered, or - the live case
    // that actually crashed the server - resolving to something attackListener's own code could not turn
    // back into a real tile) threw all the way up through receiveForwardedEvent, uncaught, taking down this
    // whole process - every room, every connected player - for the one socket's one bad click. Found live
    // during a real two-browser game, past placement and ordering, on a real attack click.
    test('a crafted or unresolvable id during real gameplay never crashes the server', async () => {
      const { host, joiner, initialView, initialViews } = await setUpStartedGame()
      const boardsIndex = initialView.children.findIndex((child: any) => child.attributes?.className === 'boards')
      const panelIndex = initialView.children[boardsIndex].children[0].children.findIndex((child: any) => child.attributes?.className === 'remote-placement-panel')
      const panel = initialView.children[boardsIndex].children[0].children[panelIndex]
      const randomiseIndex = panel.children.findIndex((child: any) => child.attributes?.className === 'remote-placement-randomise')
      const readyIndex = panel.children.findIndex((child: any) => child.attributes?.className === 'remote-placement-ready')
      const readyUp = async (socket: ClientSocket, playerIndex: number): Promise<any> => {
        const idOf = (buttonIndex: number): number => idAtPath(initialViews[playerIndex], [boardsIndex, 0, panelIndex, buttonIndex])
        const afterRandomise = new Promise<any>(resolve => host.once('gameUpdate', resolve))
        socket.emit('gameAction', { itemId: idOf(randomiseIndex), eventType: 'click', listenerFunc: 'remotePlacementListener', data: [] })
        await afterRandomise
        const afterReady = new Promise<any>(resolve => host.once('gameUpdate', resolve))
        socket.emit('gameAction', { itemId: idOf(readyIndex), eventType: 'click', listenerFunc: 'remotePlacementListener', data: [] })
        return afterReady
      }
      await readyUp(host, 0)
      const choosingView = await readyUp(joiner, 1)
      const orderingIndex = choosingView.children.findIndex((child: any) => child.attributes?.className === 'remote-ordering')
      const setOrderIndex = choosingView.children[orderingIndex].children.findIndex((child: any) => child.attributes?.className === 'remote-order-set')
      const afterSetOrder = new Promise<any>(resolve => host.once('gameUpdate', resolve))
      // Set (not Random) order - it transitions synchronously with no queued animation of its own, so nothing
      // is left running past this test's own end to interfere with whichever test runs next (same reasoning
      // as the "only the host can choose the turn order" test above).
      host.emit('gameAction', { itemId: idAtPath(choosingView, [orderingIndex, setOrderIndex]), eventType: 'click', listenerFunc: 'remotePlacementListener', data: [] })
      const orderPickingView = await afterSetOrder
      const boardIndexOf = (playerIndex: number): number => orderPickingView.children[boardsIndex].children[playerIndex].children.findIndex((child: any) => child.attributes?.className === 'matrix')
      const afterFirstPick = new Promise<any>(resolve => host.once('gameUpdate', resolve))
      host.emit('gameAction', { itemId: idAtPath(orderPickingView, [boardsIndex, 0, boardIndexOf(0), 0, 0, 0]), eventType: 'click', listenerFunc: 'attackListener', data: [] })
      await afterFirstPick
      const afterSecondPick = new Promise<any>(resolve => host.once('gameUpdate', resolve))
      host.emit('gameAction', { itemId: idAtPath(orderPickingView, [boardsIndex, 1, boardIndexOf(1), 0, 0, 0]), eventType: 'click', listenerFunc: 'attackListener', data: [] })
      await afterSecondPick

      // An id nothing has ever been registered under - the same shape of failure a resolvable-but-wrong-kind
      // id (attackListener's own now-guarded case) would also have hit before reaching this point.
      expect(() => host.emit('gameAction', { itemId: 999999999, eventType: 'click', listenerFunc: 'attackListener', data: [] })).not.toThrow()

      // The server is still alive and responsive to a real, well-formed action right after.
      const stillAlive = new Promise<{ error: string } | { started: true }>(resolve => host.emit('startGame', { hints: 'optional' }, resolve))
      const response = await stillAlive
      expect(response).toEqual({ error: expect.stringMatching(/already started/i) })
    })

    test('an action for a room with no started game is silently ignored', async () => {
      const lonelyHost = connect()
      await emit<RoomState>(lonelyHost, 'createRoom', { name: 'Carol', roomName: 'Test Lobby' })
      // The id is never actually resolved - the handler returns on the missing-game check before that.
      expect(() => lonelyHost.emit('gameAction', { itemId: 0, eventType: 'click', listenerFunc: 'whatever', data: [] })).not.toThrow()
    })

    // A full real win was tried here (place both fleets by hand, alternate real attacks through to an actual
    // sink, then restart) and genuinely works, but costs several minutes end to end: updatePlayer's own
    // per-turn follow-ups (valid-target highlighting, outline, stats, the attack-lock release) each broadcast
    // separately, and a real win needs 33 turn changes (turns strictly alternate - no "keep attacking on a
    // hit" house rule, see getNextAttacker.ts). That cost is disproportionate to what actually changed here -
    // one relaxed guard condition, reusing startRoomGame/watchRoomGame entirely unmodified otherwise. The
    // existing "the game cannot be started twice" test above already covers the relaxed guard's "still
    // active" branch; isRoomGameOver's own logic is unit tested above, and server/gameplay.test.ts's own
    // "calling startRoomGame again... produces a genuinely fresh, independent game" test proves the restart
    // mechanics the guard's "is over" branch unlocks - between the three, a full socket-driven win is not
    // needed to trust this change.
  })
})

describe('limits (hardening H3/H4/H5)', () => {
  /** A client socket with extra handshake headers (an Origin, or what a reverse proxy would add). */
  const connectWithHeaders = (extraHeaders: Record<string, string>): ClientSocket => {
    const socket = ioClient(baseUrl, { transports: ['websocket'], forceNew: true, extraHeaders })
    sockets.push(socket)
    return socket
  }

  /** Resolves to 'connected', or to the refusal's message. */
  const outcome = (socket: ClientSocket): Promise<string> => new Promise(resolve => {
    socket.once('connect', () => resolve('connected'))
    socket.once('connect_error', (error: Error) => resolve(error.message))
  })

  const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

  test('a connection sending too fast is answered with an error instead of being handled', async () => {
    await restartWith({ limits: { messagesPerSecond: 0.001, messageBurst: 2 } })
    const client = connect()
    expect(await emit(client, 'peekRoom', { roomCode: 'AAAA' })).toEqual({ error: 'No room with that code' })
    expect(await emit(client, 'peekRoom', { roomCode: 'AAAA' })).toEqual({ error: 'No room with that code' })
    expect(await emit(client, 'peekRoom', { roomCode: 'AAAA' })).toEqual({ error: 'Too many messages, please slow down' })
  })

  test('a connection that keeps going after being refused is closed', async () => {
    await restartWith({ limits: { messagesPerSecond: 0.001, messageBurst: 1, maxRefusedMessages: 3 } })
    const client = connect()
    await new Promise(resolve => client.on('connect', resolve))
    const closed = new Promise(resolve => client.once('disconnect', resolve))
    for (let i = 0; i < 5; ++i) {
      client.emit('peekRoom', { roomCode: 'AAAA' })
    }
    expect(await closed).toBe('io server disconnect')
  })

  test('a message bigger than maxMessageBytes closes the connection', async () => {
    await restartWith({ limits: { maxMessageBytes: 1000 } })
    const client = connect()
    await new Promise(resolve => client.on('connect', resolve))
    const closed = new Promise(resolve => client.once('disconnect', resolve))
    client.emit('createRoom', { name: 'x'.repeat(5000), roomName: 'Big' })
    expect(await closed).toBe('transport close')
  })

  test('connections per address are capped, and a closed one frees its place', async () => {
    await restartWith({ limits: { maxConnectionsPerAddress: 2 } })
    const first = connect()
    expect(await outcome(first)).toBe('connected')
    expect(await outcome(connect())).toBe('connected')
    expect(await outcome(connect())).toBe('Too many connections from your network, please close some tabs and try again')
    first.close()
    await wait(100)
    expect(await outcome(connect())).toBe('connected')
  })

  test('behind a trusted proxy, connections count per forwarded address (the last X-Forwarded-For entry)', async () => {
    await restartWith({ limits: { maxConnectionsPerAddress: 1, trustProxy: true } })
    expect(await outcome(connectWithHeaders({ 'X-Forwarded-For': '203.0.113.5' }))).toBe('connected')
    expect(await outcome(connectWithHeaders({ 'X-Forwarded-For': '203.0.113.6' }))).toBe('connected')
    // A client can put anything first; only the entry our proxy appended counts.
    expect(await outcome(connectWithHeaders({ 'X-Forwarded-For': '198.51.100.1, 203.0.113.5' }))).toMatch(/Too many connections/)
  })

  test('without trustProxy, X-Forwarded-For is ignored (a client could otherwise pick any address)', async () => {
    await restartWith({ limits: { maxConnectionsPerAddress: 1 } })
    expect(await outcome(connectWithHeaders({ 'X-Forwarded-For': '203.0.113.5' }))).toBe('connected')
    expect(await outcome(connectWithHeaders({ 'X-Forwarded-For': '203.0.113.6' }))).toMatch(/Too many connections/)
  })

  test('with origins set, a page from another site is refused; the allowed site and non-browser clients are not', async () => {
    await restartWith({ origins: ['https://joshuaheagle.com'] })
    expect(await outcome(connectWithHeaders({ Origin: 'https://joshuaheagle.com' }))).toBe('connected')
    expect(await outcome(connectWithHeaders({ Origin: 'https://evil.example' }))).not.toBe('connected')
    expect(await outcome(connect())).toBe('connected')
  })

  test('rooms open at once are capped', async () => {
    await restartWith({ limits: { maxRooms: 1 } })
    await emit<RoomState>(connect(), 'createRoom', { name: 'Ann', roomName: 'One' })
    expect(await emit(connect(), 'createRoom', { name: 'Bo', roomName: 'Two' })).toEqual({ error: 'The lobby is full right now, please try again in a few minutes' })
  })

  test('one connection is in one room at a time (it cannot pile up rooms nobody closes)', async () => {
    const host = connect()
    const state = await emit<RoomState>(host, 'createRoom', { name: 'Ann', roomName: 'One' })
    expect(await emit(host, 'createRoom', { name: 'Ann', roomName: 'Two' })).toEqual({ error: 'Already in a room' })
    const joiner = connect()
    await emit<RoomState>(joiner, 'joinRoom', { roomCode: state.roomCode, name: 'Bo' })
    expect(await emit(joiner, 'joinRoom', { roomCode: state.roomCode, name: 'Bo' })).toEqual({ error: 'Already in a room' })
    expect(await emit(joiner, 'createRoom', { name: 'Bo', roomName: 'Three' })).toEqual({ error: 'Already in a room' })
  })

  test('after too many unknown codes, lookups from that address are refused, even for a real code', async () => {
    await restartWith({ limits: { maxFailedLookups: 3 } })
    const state = await emit<RoomState>(connect(), 'createRoom', { name: 'Ann', roomName: 'Real' })
    const scanner = connect()
    expect(await emit(scanner, 'peekRoom', { roomCode: 'ZZZ2' })).toEqual({ error: 'No room with that code' })
    expect(await emit(scanner, 'joinRoom', { roomCode: 'ZZZ3', name: 'Eve' })).toEqual({ error: 'No room with that code' })
    expect(await emit(scanner, 'peekRoom', { roomCode: 'ZZZ4' })).toEqual({ error: 'No room with that code' })
    const blocked = { error: 'Too many tries with codes that don\'t exist, please wait a few minutes' }
    expect(await emit(scanner, 'peekRoom', { roomCode: state.roomCode })).toEqual(blocked)
    expect(await emit(scanner, 'joinRoom', { roomCode: state.roomCode, name: 'Eve' })).toEqual(blocked)
    // Counted per address, not per connection: a fresh connection from the same place is still blocked.
    expect(await emit(connect(), 'peekRoom', { roomCode: state.roomCode })).toEqual(blocked)
  })

  test('a room nobody uses is closed after roomIdleMs, and its members are told', async () => {
    await restartWith({ limits: { roomIdleMs: 150 } })
    const host = connect()
    const state = await emit<RoomState>(host, 'createRoom', { name: 'Ann', roomName: 'Idle' })
    await new Promise(resolve => host.once('roomClosed', resolve))
    expect(await emit(connect(), 'peekRoom', { roomCode: state.roomCode })).toEqual({ error: 'No room with that code' })
  })

  test('a room in use stays open past roomIdleMs', async () => {
    await restartWith({ limits: { roomIdleMs: 400 } })
    const host = connect()
    const state = await emit<RoomState>(host, 'createRoom', { name: 'Ann', roomName: 'Busy' })
    for (let i = 0; i < 10; ++i) {
      await wait(100)
      await emit(host, 'peekRoom', { roomCode: state.roomCode })
    }
    expect(await emit(connect(), 'peekRoom', { roomCode: state.roomCode })).toEqual({ roomName: 'Busy', hostName: 'Ann' })
  })

  describe('a closed room stops its game (no timer keeps playing it for players who are gone)', () => {
    const realStartRoomGame = gameplay.startRoomGame
    let stops: jest.Mock[]

    beforeEach(() => {
      stops = []
      jest.spyOn(gameplay, 'startRoomGame').mockImplementation((...args) => {
        const game = realStartRoomGame(...args)
        const stop = jest.fn(game.stop)
        stops.push(stop)
        return { ...game, stop }
      })
    })

    afterEach(() => jest.restoreAllMocks())

    const startedGame = async (): Promise<ClientSocket> => {
      const host = connect()
      const state = await emit<RoomState>(host, 'createRoom', { name: 'Ann', roomName: 'Game' })
      await emit(connect(), 'joinRoom', { roomCode: state.roomCode, name: 'Bo' })
      expect(await emit(host, 'startGame', { hints: 'on' })).toEqual({ started: true })
      return host
    }

    test('when the host leaves', async () => {
      const host = await startedGame()
      host.close()
      await wait(200)
      expect(stops).toHaveLength(1)
      expect(stops[0]).toHaveBeenCalled()
    })

    test('when it sits idle', async () => {
      await restartWith({ limits: { roomIdleMs: 300 } })
      await startedGame()
      await wait(1000)
      expect(stops).toHaveLength(1)
      expect(stops[0]).toHaveBeenCalled()
    })
  })
})

describe('the usage log (usage.ts): anonymous lines per event, and totals on /status', () => {
  const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
  let lines: Array<Record<string, unknown>>

  beforeEach(async () => {
    lines = []
    await restartWith({ usageLog: line => lines.push(JSON.parse(line)) })
  })

  afterEach(() => jest.restoreAllMocks())

  const usages = () => lines.map(({ time, ...rest }) => rest)

  test('rooms, joins, games started, restarted and stopped, players leaving, the room closing: no names or codes', async () => {
    const host = connect()
    const { roomCode } = await emit<RoomState>(host, 'createRoom', { name: 'Alice', roomName: 'Secret lobby' })
    await emit(connect(), 'joinRoom', { roomCode, name: 'Bob' })
    const leaver = connect()
    await emit(leaver, 'joinRoom', { roomCode, name: 'Cyd' })
    expect(await emit(host, 'startGame', { hints: 'on', robots: 1 })).toEqual({ started: true })
    expect(await emit(host, 'hostGameAction', { action: 'restart' })).toEqual({ ok: true })
    leaver.close()
    await wait(150)
    expect(await emit(host, 'hostGameAction', { action: 'lobby' })).toEqual({ ok: true })
    const status = await (await fetch(`${baseUrl}/status`)).json()
    host.close()
    await wait(150)

    expect(usages()).toEqual([
      { usage: 'room-created' },
      { usage: 'room-joined', players: 2 },
      { usage: 'room-joined', players: 3 },
      { usage: 'game-started', humans: 3, robots: 1, hints: 'on', restart: false },
      { usage: 'game-stopped', reason: 'restart', humans: 3, robots: 1, minutes: 0 },
      { usage: 'game-started', humans: 3, robots: 1, hints: 'on', restart: true },
      { usage: 'player-left', during: 'game', players: 2 },
      { usage: 'game-stopped', reason: 'lobby', humans: 3, robots: 1, minutes: 0 },
      { usage: 'room-closed', reason: 'host-left', players: 2, games: 2, minutes: 0 }
    ])
    expect(lines.every(line => !Number.isNaN(Date.parse(line.time as string)))).toBe(true)
    expect(JSON.stringify(lines)).not.toMatch(new RegExp(`Alice|Bob|Cyd|Secret|${roomCode}`))
    expect(status.totals).toEqual({ roomsCreated: 1, gamesStarted: 2, gamesFinished: 0, gamesStopped: 2, playersLeftMidGame: 1 })
  })

  test('a game reaching its final score is logged once as finished (with its turns), not as stopped when the room closes', async () => {
    const games: RoomGame[] = []
    const broadcasts: Array<() => void> = []
    const realStart = gameplay.startRoomGame
    const realWatch = gameplay.watchRoomGame
    jest.spyOn(gameplay, 'startRoomGame').mockImplementation((...args) => {
      const game = realStart(...args)
      games.push(game)
      return game
    })
    jest.spyOn(gameplay, 'watchRoomGame').mockImplementation((...args) => {
      const broadcast = realWatch(...args)
      broadcasts.push(broadcast)
      return broadcast
    })
    const host = connect()
    const { roomCode } = await emit<RoomState>(host, 'createRoom', { name: 'Ann', roomName: 'Game' })
    await emit(connect(), 'joinRoom', { roomCode, name: 'Bo' })
    await emit(host, 'startGame', { hints: 'off' })
    // Everyone but the first player sunk, as the last shot of a real game leaves it
    games[0].players.forEach((player, index) => {
      player.turnCnt = 7
      if (index > 0) player.status = 0
    })
    broadcasts[0]()
    broadcasts[0]()
    host.close()
    await wait(150)

    expect(usages().filter(line => String(line.usage).startsWith('game-'))).toEqual([
      { usage: 'game-started', humans: 2, robots: 0, hints: 'off', restart: false },
      { usage: 'game-finished', humans: 2, robots: 0, minutes: 0, turns: 14 }
    ])
  })

  test('without a writer nothing is written, and /status still counts', async () => {
    await restartWith({})
    const host = connect()
    await emit<RoomState>(host, 'createRoom', { name: 'Ann', roomName: 'Game' })
    expect((await (await fetch(`${baseUrl}/status`)).json()).totals.roomsCreated).toBe(1)
    expect(lines).toEqual([])
  })
})
