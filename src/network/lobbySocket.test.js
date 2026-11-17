/**
 * @jest-environment jsdom
 */
import { Server } from 'socket.io'
import { createServer } from 'http'
import {
  configuredLobbyUrl,
  connectLobbySocket,
  disconnectLobbySocket,
  joinRoom,
  lobbyUrl,
  LOBBY_PORT,
  peekRoom,
  setLobbyTimeout,
  UNREACHABLE_ERROR
} from './lobbySocket'

describe('lobbyUrl', () => {
  test('the lobby is on port 3002 of the host the page came from, so another device on the network reaches it', () => {
    expect(lobbyUrl({ protocol: 'http:', hostname: '192.168.1.20' })).toBe('http://192.168.1.20:3002')
    expect(lobbyUrl({ protocol: 'http:', hostname: 'cloakfall.local' })).toBe('http://cloakfall.local:3002')
    expect(lobbyUrl({ protocol: 'https:', hostname: 'example.test' })).toBe('https://example.test:3002')
  })

  test('outside a web page (a file, no location), it is localhost', () => {
    expect(lobbyUrl({ protocol: 'file:', hostname: '' })).toBe('http://localhost:3002')
    expect(lobbyUrl(null)).toBe('http://localhost:3002')
  })

  test("by default it reads the page's own location", () => {
    expect(lobbyUrl()).toBe(`${window.location.protocol}//${window.location.hostname}:${LOBBY_PORT}`)
  })

  describe('a page that names its lobby in a cloakfall-lobby meta tag', () => {
    const page = { protocol: 'https:', hostname: 'joshuaheagle.com' }
    let meta

    beforeEach(() => {
      meta = document.createElement('meta')
      meta.name = 'cloakfall-lobby'
      document.head.appendChild(meta)
    })

    afterEach(() => meta.remove())

    test("uses only the tag's origin: a path or query would otherwise become a socket.io namespace", () => {
      meta.content = 'https://cloakfall.joshuaheagle.com:8443/lobby/?x=1'
      expect(lobbyUrl(page)).toBe('https://cloakfall.joshuaheagle.com:8443')
    })

    test("uses the tag's https URL, without its trailing slash", () => {
      meta.content = 'https://cloakfall.joshuaheagle.com/'
      expect(configuredLobbyUrl()).toBe('https://cloakfall.joshuaheagle.com/')
      expect(lobbyUrl(page)).toBe('https://cloakfall.joshuaheagle.com')
      expect(lobbyUrl(null)).toBe('https://cloakfall.joshuaheagle.com')
      expect(lobbyUrl(page, 'http://192.168.1.20:3002')).toBe('http://192.168.1.20:3002')
    })

    test.each([
      ['a javascript: URL', 'javascript:alert(1)'],
      ['an empty value', ''],
      ['something that is not a URL', 'not a url'],
      ['another kind of URL', 'ftp://cloakfall.joshuaheagle.com']
    ])('ignores %s and falls back to the page host', (_, content) => {
      meta.content = content
      expect(lobbyUrl(page)).toBe('https://joshuaheagle.com:3002')
      expect(lobbyUrl(null)).toBe('http://localhost:3002')
    })
  })

  test('without the tag, there is no configured lobby', () => {
    expect(configuredLobbyUrl()).toBeNull()
    expect(configuredLobbyUrl(null)).toBeNull()
  })
})

describe('lobby calls', () => {
  let httpServer
  let io
  let baseUrl

  beforeEach(async () => {
    httpServer = createServer()
    io = new Server(httpServer, { cors: { origin: '*' } })
    await new Promise(resolve => httpServer.listen(0, resolve))
    baseUrl = `http://localhost:${httpServer.address().port}`
    setLobbyTimeout(300)
  })

  afterEach(async () => {
    disconnectLobbySocket()
    setLobbyTimeout(8000)
    io.close()
    await new Promise(resolve => httpServer.close(resolve))
  })

  test("resolve with the server's answer when it answers", async () => {
    io.on('connection', socket => socket.on('peekRoom', ({ roomCode }, ack) => ack({ roomName: `Room ${roomCode}`, hostName: 'Ann' })))
    connectLobbySocket(baseUrl)
    await expect(peekRoom('ABCD')).resolves.toEqual({ roomName: 'Room ABCD', hostName: 'Ann' })
  })

  test('give up with an error when the server never answers, instead of waiting forever', async () => {
    io.on('connection', socket => socket.on('joinRoom', () => {}))
    connectLobbySocket(baseUrl)
    await expect(joinRoom('ABCD', 'Bo')).resolves.toEqual({ error: UNREACHABLE_ERROR })
  })

  test('give up with an error when no server is running at all', async () => {
    io.close()
    await new Promise(resolve => httpServer.close(resolve))
    httpServer = createServer()
    io = new Server(httpServer)
    connectLobbySocket(baseUrl)
    const started = Date.now()
    await expect(peekRoom('ABCD')).resolves.toEqual({ error: UNREACHABLE_ERROR })
    expect(Date.now() - started).toBeLessThan(3000)
  })
})
