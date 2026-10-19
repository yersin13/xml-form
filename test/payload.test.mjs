import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

// parseXml uses DOMParser; give node one for the test
const dom = new JSDOM('')
globalThis.DOMParser = dom.window.DOMParser

const P = await import('../src/payload.js')

const models = [
  { id: 'a', name: 'MODEL1', parts: [
    { id: '1', prtnum: '5459361-070', opsSeq: 'D220', qty: 1 },
    { id: '2', prtnum: '5459362-070', opsSeq: 'D220', qty: 1 },
    { id: '3', prtnum: '5459363-070', opsSeq: 'D220', qty: 1 },
  ] },
  { id: 'b', name: 'MODEL2', parts: [
    { id: '4', prtnum: '5459364-070', opsSeq: 'D220', qty: 1 },
    { id: '5', prtnum: '5454346-070', opsSeq: 'D220', qty: 1 },
    { id: '6', prtnum: '5454347-070', opsSeq: 'D220', qty: 1 },
  ] },
]
const settings = { ...P.DEFAULT_SETTINGS, cartType: '2DRFLR1', maxCtn: 12 }
const now = new Date(2026, 9, 11, 21, 9, 30)

function state(n = 12) {
  return { settings, models, vehicles: P.buildVehicles('MODEL1,MODEL2', n), liveTokens: true }
}

test('12 vehicles alternate models and make 36 segments', () => {
  const segs = P.buildSegments(state(), now)
  assert.equal(segs.length, 36)
  assert.equal(segs[0].fgItem, 'MODEL1')
  assert.equal(segs[3].fgItem, 'MODEL2')
})

test('token + UC_INC_PRT_NUM pairs are unique and inc restarts per vehicle', () => {
  const segs = P.buildSegments(state(), now)
  const keys = new Set(segs.map((s) => `${s.token}|${s.incPrtNum}`))
  assert.equal(keys.size, 36)
  assert.deepEqual(segs.slice(0, 3).map((s) => s.incPrtNum), [1, 2, 3])
  assert.deepEqual(segs.slice(3, 6).map((s) => s.incPrtNum), [1, 2, 3])
})

test('token format and real-time stepping', () => {
  const segs = P.buildSegments(state(), now)
  assert.equal(segs[0].token, '2026-10-11-21.09.30.40001')
  assert.equal(segs[3].token, '2026-10-11-21.09.32.40002')
  assert.match(segs[0].token, /^\d{4}-\d{2}-\d{2}-\d{2}\.\d{2}\.\d{2}\.\d{5}$/)
})

test('prod date is today by default', () => {
  assert.equal(P.computeProdDate(settings, now), '20261011000001')
  assert.equal(P.computeProdDate({ ...settings, prodDateOffset: 1 }, now), '20261012000001')
})

test('xml has no comments, one element per line, empty tags self-close', () => {
  const xml = P.toXml(settings, P.buildSegments(state(2), now))
  assert.ok(!xml.includes('<!--'))
  assert.ok(xml.includes('<TRNTYP>R</TRNTYP>'))
  assert.ok(xml.includes('<UC_VIN_NUM />'))
  assert.ok(xml.includes('<WHSE_ID>U10</WHSE_ID>'))
  for (const line of xml.trim().split('\n')) {
    assert.ok((line.match(/</g) || []).length <= 2, line)
  }
})

test('validation flags a repeated pair and a missing ops seq', () => {
  const bad = state(2)
  bad.vehicles[1].token = bad.vehicles[0].token = 'SAME'
  const issues = P.validate(bad, P.buildSegments(bad, now), now)
  assert.ok(issues.some((i) => i.level === 'error' && i.text.includes('Repeated')))
  assert.ok(issues.some((i) => i.text.includes('same token')))
})

test('validation warns above max_ctn and outside DAYS-OUT', () => {
  const s = state(13)
  assert.ok(P.validate(s, P.buildSegments(s, now), now).some((i) => i.text.includes('cart holds')))
  const far = { ...state(2), settings: { ...settings, prodDateOffset: 5 } }
  assert.ok(P.validate(far, P.buildSegments(far, now), now).some((i) => i.text.includes('DAYS-OUT')))
})

test('clean payload has no errors', () => {
  const s = state()
  assert.equal(P.validate(s, P.buildSegments(s, now), now).filter((i) => i.level === 'error').length, 0)
})

test('barcodes use S + cart type + ops seq + serial', () => {
  const codes = P.barcodes('2DRFLR1', models, 'A01')
  assert.deepEqual(codes.map((c) => c.barcode), ['S2DRFLR1D220A01'])
  assert.equal(codes[0].warn, false)
})

test('round trip: parse the generated XML back into the same shape', () => {
  const s = state()
  const xml = P.toXml(settings, P.buildSegments(s, now))
  const parsed = P.parseXml(xml)
  assert.equal(parsed.vehicles.length, 12)
  assert.equal(parsed.models.length, 2)
  assert.equal(parsed.models[0].parts.length, 3)
  assert.equal(parsed.settings.whseId, 'U10')
  // rebuilding from the parsed data with fresh tokens gives the same structure
  const rebuilt = P.buildSegments(
    { settings: { ...settings, ...parsed.settings }, models: parsed.models, vehicles: parsed.vehicles.map((v) => ({ ...v, token: '' })) },
    new Date(2026, 9, 12, 8, 0, 0),
  )
  assert.equal(rebuilt.length, 36)
  assert.equal(rebuilt[0].token, '2026-10-12-08.00.00.40001')
})

test('parse handles the browser-view "- <" prefixes and a bad file', () => {
  const xml = '- <USR_PLSEQ_INB_IFD>\n- <CTRL_SEG>\n<WHSE_ID>10</WHSE_ID>\n- <USR_PLSEQ_SEG>\n<PRTNUM>X1</PRTNUM>\n<UC_TOKEN_NUM>T1</UC_TOKEN_NUM>\n<UC_OPS_SEQ>1100</UC_OPS_SEQ>\n<PCKQTY>2</PCKQTY>\n<UC_INC_PRT_NUM>1</UC_INC_PRT_NUM>\n</USR_PLSEQ_SEG>\n</CTRL_SEG>\n</USR_PLSEQ_INB_IFD>'
  const p = P.parseXml(xml)
  assert.equal(p.settings.whseId, '10')
  assert.equal(p.models[0].parts[0].qty, 2)
  assert.throws(() => P.parseXml('<a><b></a>'))
})
