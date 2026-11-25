'use strict'

// risk.js — pure risk classifier for agent clicks / Enter / fills (spec §4.5.3).
//
// Why it lives in the main process and not only in the backend policy: the
// target's name / href / form action are read *from the live page* at action
// time, so this is the only place that sees what the click would really do.
// Always-confirm tier cannot be switched off by any setting.

const ALWAYS_CONFIRM =
  /(?:pay|checkout|place[ -]?order|confirm[ -]?(?:order|payment)|transfer|withdraw|delete[ -]?account|close[ -]?account|支付|付款|结算|下单|提交订单|转账|提现|注销账号|删除账号)/i
const LOGGED_IN_CONFIRM =
  /(?:delete|remove|publish|post|send|submit|unfollow|block|删除|移除|发布|发表|发送|提交|取消关注|拉黑)/i

/**
 * @param {object} input
 * @param {'click'|'press_enter'|'fill'} input.kind
 * @param {string} [input.name] Accessible name of the target.
 * @param {string} [input.href]
 * @param {string} [input.formAction]
 * @param {string} [input.formMethod] 'GET' | 'POST' …
 * @param {boolean} [input.hasProfileCookies] Host has cookies in the active profile.
 * @param {boolean} [input.confirmLoggedIn=true] Setting `confirm_risky_actions`.
 * @returns {'none'|'confirm'}
 */
function classify(input) {
  const { kind, name = '', href = '', formAction = '', formMethod = '', hasProfileCookies = false } = input
  if (kind === 'fill') return 'none'
  const haystack = `${name} ${href} ${formAction}`
  if (ALWAYS_CONFIRM.test(haystack)) return 'confirm'
  if (!hasProfileCookies || input.confirmLoggedIn === false) return 'none'
  if (kind === 'press_enter' && String(formMethod).toUpperCase() === 'POST') return 'confirm'
  return LOGGED_IN_CONFIRM.test(haystack) ? 'confirm' : 'none'
}

module.exports = { classify, ALWAYS_CONFIRM, LOGGED_IN_CONFIRM }
