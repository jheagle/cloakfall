import type { Socket } from 'socket.io'

/**
 * The lobby's limits (hardening H3 / H4): enough to keep one person, script or network from using up the server or
 * scanning room codes, without getting in the way of a real game. Each can be changed per server (tests use small ones).
 */
export interface LobbyLimits {
  /** Rooms open at once, across everyone. */
  maxRooms: number
  /** Connections at once from one network address. */
  maxConnectionsPerAddress: number
  /** The largest single message a client may send (bytes). Lobby and game messages are a few hundred bytes. */
  maxMessageBytes: number
  /** Messages per second one connection may send, on average... */
  messagesPerSecond: number
  /** ...and in a burst. */
  messageBurst: number
  /** Messages refused for coming too fast before the connection is closed. */
  maxRefusedMessages: number
  /** Failed room-code lookups (peek or join with an unknown code) per network address... */
  maxFailedLookups: number
  /** ...within this window (ms). */
  failedLookupWindowMs: number
  /** A room nobody in it has sent anything to for this long (ms) is closed, game and all. */
  roomIdleMs: number
  /** Read the client's address from X-Forwarded-For (set by a reverse proxy we run, such as Caddy). */
  trustProxy: boolean
}

export const DEFAULT_LIMITS: LobbyLimits = {
  maxRooms: 200,
  maxConnectionsPerAddress: 20,
  maxMessageBytes: 16 * 1024,
  messagesPerSecond: 20,
  messageBurst: 40,
  maxRefusedMessages: 100,
  maxFailedLookups: 30,
  failedLookupWindowMs: 10 * 60 * 1000,
  roomIdleMs: 30 * 60 * 1000,
  trustProxy: false
}

/**
 * A token bucket: `take()` is true while there are tokens, which refill at `perSecond` up to `burst`.
 * @param perSecond
 * @param burst
 * @param now The clock (tests pass their own).
 */
export const createRateLimiter = (perSecond: number, burst: number, now: () => number = Date.now): { take: () => boolean } => {
  let tokens = burst
  let last = now()
  return {
    take () {
      const time = now()
      tokens = Math.min(burst, tokens + ((time - last) / 1000) * perSecond)
      last = time
      if (tokens < 1) {
        return false
      }
      tokens -= 1
      return true
    }
  }
}

/**
 * Counts failures per key within a sliding window: `blocked(key)` once `max` failures happened in the last `windowMs`.
 * Old entries are dropped as they age, so it never grows without bound.
 * @param max
 * @param windowMs
 * @param now
 */
export const createFailureCounter = (max: number, windowMs: number, now: () => number = Date.now) => {
  const failures = new Map<string, number[]>()
  const recent = (key: string): number[] => {
    const since = now() - windowMs
    const times = (failures.get(key) ?? []).filter(time => time > since)
    if (times.length) {
      failures.set(key, times)
    } else {
      failures.delete(key)
    }
    return times
  }
  return {
    fail (key: string): void {
      failures.set(key, [...recent(key), now()])
    },
    blocked: (key: string): boolean => recent(key).length >= max,
    /** Forget every key whose failures have all aged out (keys that never come back are otherwise kept). */
    sweep (): void {
      [...failures.keys()].forEach(recent)
    },
    /** How many keys are being tracked (for tests). */
    size: (): number => failures.size
  }
}

/**
 * The eight 16-bit groups of an IPv6 address, as numbers, or null when it isn't one. Handles `::` and an embedded
 * IPv4 tail (`::ffff:1.2.3.4`).
 * @param address
 */
const ipv6Groups = (address: string): number[] | null => {
  let text = address.split('%')[0]
  const v4 = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/)
  if (v4) {
    const bytes = v4[2].split('.').map(Number)
    if (bytes.some(byte => byte > 255)) {
      return null
    }
    text = `${v4[1]}${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`
  }
  const halves = text.split('::')
  if (halves.length > 2) {
    return null
  }
  const parse = (part: string): string[] => part ? part.split(':') : []
  const head = parse(halves[0])
  const tail = halves.length === 2 ? parse(halves[1]) : []
  const missing = 8 - head.length - tail.length
  if (halves.length === 2 ? missing < 1 : missing !== 0) {
    return null
  }
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail]
  if (!groups.every(group => /^[0-9a-f]{1,4}$/i.test(group))) {
    return null
  }
  return groups.map(group => parseInt(group, 16))
}

/**
 * The key limits count a network address under. IPv4 is the address itself (also when written IPv4-mapped,
 * `::ffff:1.2.3.4`). IPv6 is its /64 prefix: one home or phone connection is usually handed a whole /64, billions of
 * addresses, so counting single IPv6 addresses would let one person pick a fresh address for every attempt.
 * @param address
 */
export const addressKey = (address: string): string => {
  const groups = address.includes(':') ? ipv6Groups(address) : null
  if (!groups) {
    return address
  }
  if (groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join('.')
  }
  return `${groups.slice(0, 4).map(group => group.toString(16)).join(':')}::/64`
}

/**
 * The address a connection comes from, as an addressKey. Behind a reverse proxy every connection comes from the
 * proxy, so with trustProxy the last X-Forwarded-For entry (the one our proxy added) is used instead: entries before
 * it came from the client and can say anything. Only turn it on behind a proxy we run (and that nothing else can
 * reach the server directly): otherwise a client could send its own header and pick any address.
 * @param socket
 * @param trustProxy
 */
export const clientAddress = (socket: Pick<Socket, 'handshake'>, trustProxy: boolean): string => {
  const forwarded = socket.handshake.headers['x-forwarded-for']
  if (trustProxy && typeof forwarded === 'string' && forwarded.trim()) {
    const last = forwarded.split(',').map(part => part.trim()).filter(Boolean).pop()
    if (last) {
      return addressKey(last)
    }
  }
  return addressKey(socket.handshake.address)
}

/**
 * The lobby's settings from the environment, for a deployed server: CLOAKFALL_TRUST_PROXY (`1` or `true` behind
 * our reverse proxy) and CLOAKFALL_ORIGINS (comma-separated page origins allowed to use the lobby, e.g.
 * `https://joshuaheagle.com`; unset or empty allows any, as on a LAN).
 * @param env
 */
export const settingsFromEnv = (env: Record<string, string | undefined>): { limits: Partial<LobbyLimits>, origins: string[] } => ({
  limits: { trustProxy: /^(1|true|yes)$/i.test(env.CLOAKFALL_TRUST_PROXY ?? '') },
  origins: (env.CLOAKFALL_ORIGINS ?? '').split(',').map(origin => origin.trim().replace(/\/+$/, '')).filter(Boolean)
})
