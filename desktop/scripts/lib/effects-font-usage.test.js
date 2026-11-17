'use strict'
/* eslint-disable @typescript-eslint/no-require-imports -- Desktop test tools use the existing CommonJS entry convention. */
const test = require('node:test')
const assert = require('node:assert/strict')
const { validateFontUsage } = require('./effects-font-usage')
function fixture() {
  const binding = { case_id: 'text-emoji', family: 'sans', side: 'renderer', frame: 29, input_sha256: 'a'.repeat(64), fontHash: 'b'.repeat(64) }
  const raw = name => ({ familyName: name, postScriptName: name, isCustomFont: true, glyphCount: 1 })
  const reference = { side: 'renderer', fontHash: binding.fontHash, fonts: ['sans', 'serif', 'mono', 'emoji'].flatMap(family => [400, 600].map(weight => ({ family, path: `${family}.ttf`, sha256: 'c'.repeat(64), weight, fonts: [raw(family)] }))) }
  const usage = { ...binding, nodes: [{ field: 'title', text: '效果 🎬✨😀', node_index: 0, node_id: 1, fonts: [raw('sans'), raw('emoji')] }] }
  return { usage, reference, expectedReference: structuredClone(reference), binding, fields: { title: '效果 🎬✨😀' } }
}
test('完整双端绑定字体节点可独立匹配本端探针', () => {
  const f = fixture(); assert.equal(validateFontUsage(f), true)
  f.binding.side = 'player'; f.usage.side = 'player'; f.reference.side = 'player'; f.expectedReference.side = 'player'
  assert.equal(validateFontUsage(f), true)
})
test('rejects_incomplete_font_usage', () => {
  for (const mutate of [f => { f.usage.nodes = [] }, f => { f.usage.nodes[0].fonts = [] },
    f => { f.usage.side = 'player' }, f => { f.usage.fontHash = '0'.repeat(64) },
    f => { f.usage.nodes[0].text = '' }, f => { f.usage.nodes[0].fonts[0].isCustomFont = false },
    f => { f.usage.nodes[0].fonts[0].familyName = 'System' },
    f => { f.usage.nodes[0].fonts = [f.usage.nodes[0].fonts[0]] },
    f => { f.reference.fonts[0].sha256 = '0'.repeat(64) },
    f => { f.usage.nodes[0].fonts[0].glyphCount = -1 },
  ]) { const f = fixture(); mutate(f); assert.throws(() => validateFontUsage(f)) }
})
test('同一字段另一行有glyph不能掩盖本行空记录', () => {
  const f = fixture(); f.binding.case_id = 'text-newline'; f.usage.case_id = 'text-newline'
  f.fields.title = 'First\nSecond'
  f.usage.nodes = [{ ...f.usage.nodes[0], text: 'First' },
    { ...f.usage.nodes[0], text: 'Second', node_id: 2, node_index: 1, fonts: [] }]
  assert.throws(() => validateFontUsage(f), /节点缺少实际glyph/)
})
