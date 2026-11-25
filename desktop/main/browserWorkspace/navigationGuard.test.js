'use strict'

// Pure-node tests: navigationGuard (shared vectors) + risk classifier.

const assert = require('assert')
const path = require('path')
const { checkUrl, isPrivateAddress, dnsAnswersAllowed } = require('./navigationGuard')
const { classify } = require('./risk')
const { createRunner, main } = require('./testkit')

const vectors = require(path.join(__dirname, '__fixtures__', 'url-guard-vectors.json'))

async function run() {
  const t = createRunner()

  await t.test(`shared vectors (${vectors.length}) classify identically`, () => {
    for (const v of vectors) {
      const got = checkUrl(v.input, {
        actor: v.actor,
        allowPrivate: v.allowPrivate,
        ownPorts: v.ownPorts || [],
        denyHosts: v.denyHosts || [],
      })
      assert.strictEqual(got.ok, v.expect.ok, `ok mismatch for ${v.input}`)
      if (!v.expect.ok) assert.strictEqual(got.code, v.expect.code, `code mismatch for ${v.input}`)
    }
  })

  await t.test('sensitive-site refusals are sticky, private refusals are not', () => {
    assert.strictEqual(checkUrl('https://paypal.com/', { actor: 'agent' }).sticky, true)
    assert.strictEqual(checkUrl('http://10.0.0.1/', { actor: 'agent' }).sticky, false)
  })

  await t.test('url longer than 4096 chars is rejected', () => {
    const long = `https://example.com/${'a'.repeat(4100)}`
    assert.strictEqual(checkUrl(long, { actor: 'user' }).code, 'navigation_blocked')
  })

  await t.test('isPrivateAddress covers v4/v6 literals and ignores hostnames', () => {
    assert.ok(isPrivateAddress('10.0.0.1'))
    assert.ok(isPrivateAddress('[::1]'))
    assert.ok(isPrivateAddress('::ffff:10.0.0.1'))
    assert.ok(!isPrivateAddress('93.184.216.34'))
    assert.ok(!isPrivateAddress('example.com'))
    assert.ok(!isPrivateAddress('2606:4700::1111'))
  })

  await t.test('dnsAnswersAllowed: any private answer blocks unless allowed', () => {
    assert.strictEqual(dnsAnswersAllowed(['93.184.216.34', '10.0.0.5'], false), false)
    assert.strictEqual(dnsAnswersAllowed(['93.184.216.34'], false), true)
    assert.strictEqual(dnsAnswersAllowed(['10.0.0.5'], true), true)
  })

  await t.test('risk: always-confirm tier ignores cookies and the setting', () => {
    assert.strictEqual(classify({ kind: 'click', name: 'Place order' }), 'confirm')
    assert.strictEqual(classify({ kind: 'click', name: '去支付', confirmLoggedIn: false }), 'confirm')
    assert.strictEqual(classify({ kind: 'click', href: 'https://x.com/checkout' }), 'confirm')
  })

  await t.test('risk: logged-in tier needs cookies and the setting', () => {
    assert.strictEqual(classify({ kind: 'click', name: '发布' }), 'none')
    assert.strictEqual(classify({ kind: 'click', name: '发布', hasProfileCookies: true }), 'confirm')
    assert.strictEqual(
      classify({ kind: 'click', name: 'Delete', hasProfileCookies: true, confirmLoggedIn: false }), 'none')
    assert.strictEqual(
      classify({ kind: 'press_enter', formMethod: 'post', hasProfileCookies: true }), 'confirm')
    assert.strictEqual(classify({ kind: 'press_enter', formMethod: 'get', hasProfileCookies: true }), 'none')
    assert.strictEqual(classify({ kind: 'fill', name: 'delete', hasProfileCookies: true }), 'none')
  })

  return t.count()
}

if (require.main === module) main('navigationGuard', run)
module.exports = { run }
