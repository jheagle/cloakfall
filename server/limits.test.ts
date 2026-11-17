import { addressKey, clientAddress, createFailureCounter, createRateLimiter, settingsFromEnv } from './limits'

describe('createRateLimiter', () => {
  test('allows a burst, then refills at the rate, never above the burst', () => {
    let time = 0
    const limiter = createRateLimiter(2, 3, () => time)
    expect([limiter.take(), limiter.take(), limiter.take(), limiter.take()]).toEqual([true, true, true, false])
    time = 500
    expect([limiter.take(), limiter.take()]).toEqual([true, false])
    time = 60000
    expect([limiter.take(), limiter.take(), limiter.take(), limiter.take()]).toEqual([true, true, true, false])
  })
})

describe('createFailureCounter', () => {
  test('blocks a key after max failures within the window, and forgets them as they age', () => {
    let time = 0
    const counter = createFailureCounter(2, 1000, () => time)
    counter.fail('a')
    expect(counter.blocked('a')).toBe(false)
    counter.fail('a')
    expect(counter.blocked('a')).toBe(true)
    expect(counter.blocked('b')).toBe(false)
    time = 1001
    expect(counter.blocked('a')).toBe(false)
  })

  test('sweep drops keys whose failures have aged out, so addresses that never come back are not kept', () => {
    let time = 0
    const counter = createFailureCounter(5, 1000, () => time)
    counter.fail('a')
    counter.fail('b')
    time = 600
    counter.fail('c')
    time = 1200
    counter.sweep()
    expect(counter.size()).toBe(1)
  })
})

describe('addressKey', () => {
  test('IPv4 is the address itself, also when IPv4-mapped', () => {
    expect(addressKey('203.0.113.5')).toBe('203.0.113.5')
    expect(addressKey('::ffff:203.0.113.5')).toBe('203.0.113.5')
    expect(addressKey('::FFFF:cb00:7105')).toBe('203.0.113.5')
  })

  test('IPv6 counts by its /64, however it is written', () => {
    expect(addressKey('2607:5300:205:200::6fcb')).toBe('2607:5300:205:200::/64')
    expect(addressKey('2607:5300:0205:0200:1:2:3:4')).toBe('2607:5300:205:200::/64')
    expect(addressKey('2001:db8::1')).toBe('2001:db8:0:0::/64')
    expect(addressKey('::1')).toBe('0:0:0:0::/64')
    expect(addressKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64')
  })

  test('anything else is kept as it is', () => {
    expect(addressKey('')).toBe('')
    expect(addressKey('not:an::address::')).toBe('not:an::address::')
    expect(addressKey('1:2:3:4:5:6:7:8:9')).toBe('1:2:3:4:5:6:7:8:9')
  })
})

describe('clientAddress', () => {
  const socket = (address: string, forwarded?: string): any => ({ handshake: { address, headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded } } })

  test('uses the connection address unless trustProxy is on', () => {
    expect(clientAddress(socket('172.18.0.2', '203.0.113.5'), false)).toBe('172.18.0.2')
    expect(clientAddress(socket('::ffff:172.18.0.2'), true)).toBe('172.18.0.2')
  })

  test('with trustProxy, the last X-Forwarded-For entry, keyed the same way', () => {
    expect(clientAddress(socket('172.18.0.2', '198.51.100.1, 203.0.113.5'), true)).toBe('203.0.113.5')
    expect(clientAddress(socket('172.18.0.2', '2001:db8:1:2::99'), true)).toBe('2001:db8:1:2::/64')
    expect(clientAddress(socket('172.18.0.2', ' , '), true)).toBe('172.18.0.2')
  })
})

describe('settingsFromEnv', () => {
  test('defaults: no proxy, any origin', () => {
    expect(settingsFromEnv({})).toEqual({ limits: { trustProxy: false }, origins: [] })
  })

  test('reads CLOAKFALL_TRUST_PROXY and a comma-separated CLOAKFALL_ORIGINS', () => {
    expect(settingsFromEnv({ CLOAKFALL_TRUST_PROXY: 'true', CLOAKFALL_ORIGINS: 'https://joshuaheagle.com/, http://cloakfall.local:8080 ,' }))
      .toEqual({ limits: { trustProxy: true }, origins: ['https://joshuaheagle.com', 'http://cloakfall.local:8080'] })
  })
})
