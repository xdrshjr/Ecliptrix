'use strict'
const FAMILIES = Object.freeze(['sans', 'serif', 'mono'])
const TEXT_VECTORS = Object.freeze([
  ['text-zh', '中文排版测试', ''], ['text-en', 'English layout', ''],
  ['text-newline', '第一行\nSecond line', ''], ['text-120', '文'.repeat(120), ''],
  ['text-300', 'Subtitle', 'a'.repeat(300)], ['text-combining', 'Cafe\u0301 A\u030a', ''],
  ['text-emoji', '效果 🎬✨😀', ''], ['text-crlf', '第一行\r\nSecond line', ''],
  ['text-emoji-sequence', '👩‍💻 ❤️ 👍🏽', ''],
].map(([case_id, title, subtitle]) => Object.freeze({ case_id, title, subtitle })))
function createTextVectorDocument(template, vector, family) {
  if (template.id !== 'title-rise' || !TEXT_VECTORS.includes(vector) || !FAMILIES.includes(family)) throw Error('Invalid fixed text vector')
  return { schemaVersion: 1, templateId: 'title-rise', templateVersion: template.version,
    canvas: { width: 1920, height: 1080, fps: 30 }, durationFrames: 60, seed: 1,
    content: { title: vector.title, subtitle: vector.subtitle },
    palette: { background: '#15171A', foreground: '#F5F4F1', accent: '#C87758' },
    typography: { family, scale: 1, align: 'center' }, motion: { speed: 1, intensity: 1 },
    params: structuredClone(template.defaults), inputs: [] }
}
module.exports = { FAMILIES, TEXT_VECTORS, createTextVectorDocument }
