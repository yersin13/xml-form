// Pure logic: build, validate and parse USR_PLSEQ inbound payloads.
// No React in here so it can be tested with `npm test`.

export const pad = (n, len = 2) => String(n).padStart(len, '0')

let idCounter = 0
export const uid = () => `${Date.now().toString(36)}${(idCounter++).toString(36)}`

export const DEFAULT_SETTINGS = {
  whseId: 'U10',
  trntyp: 'R',
  opArea: '',
  prodLine: '3',
  prodDateMode: 'auto', // 'auto' = today + offset, 'manual' = typed value
  prodDateOffset: 0,
  prodTime: '000001',
  prodDateManual: '',
  queDte: '',
  tokenSuffixStart: 40001,
  tokenStepSec: 2,
  daysOut: 3,
  maxCtn: '',
  cartType: '',
}

// ---------- tokens and dates ----------

export function fmtToken(date, suffix) {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `-${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}.${suffix}`
  )
}

export function computeProdDate(settings, now) {
  if (settings.prodDateMode === 'manual') return settings.prodDateManual
  const d = new Date(now.getTime())
  d.setDate(d.getDate() + Number(settings.prodDateOffset || 0))
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${settings.prodTime || '000001'}`
}

export function tokenFor(settings, vehicle, index, now) {
  if (vehicle.token && vehicle.token.trim()) return vehicle.token.trim()
  const t = new Date(now.getTime() + index * Number(settings.tokenStepSec || 0) * 1000)
  return fmtToken(t, Number(settings.tokenSuffixStart || 0) + index)
}

// ---------- vehicles ----------

export function buildVehicles(pattern, count) {
  const names = String(pattern)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!names.length) return []
  const out = []
  for (let i = 0; i < Number(count || 0); i++) {
    out.push({ id: uid(), model: names[i % names.length], seqNum: i + 1, token: '' })
  }
  return out
}

// ---------- segments ----------

export function buildSegments(state, now) {
  const { settings, models, vehicles } = state
  const prodDte = computeProdDate(settings, now)
  const segs = []
  vehicles.forEach((v, i) => {
    const model = models.find((m) => m.name === v.model)
    const token = tokenFor(settings, v, i, now)
    const parts = model ? model.parts : []
    parts.forEach((p, j) => {
      segs.push({
        trntyp: settings.trntyp,
        opArea: settings.opArea,
        prodLine: settings.prodLine,
        prodDte,
        seqNum: v.seqNum,
        fgItem: v.model,
        prtnum: p.prtnum.trim(),
        token,
        queDte: settings.queDte,
        opsSeq: p.opsSeq.trim(),
        pckqty: p.qty,
        incPrtNum: j + 1,
      })
    })
  })
  return segs
}

// ---------- XML ----------

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

const el = (indent, name, value) => {
  const v = value === undefined || value === null || String(value) === '' ? '' : esc(value)
  return v === '' ? `${indent}<${name} />` : `${indent}<${name}>${v}</${name}>`
}

export function toXml(settings, segs) {
  const lines = []
  lines.push('<USR_PLSEQ_INB_IFD>')
  lines.push('  <CTRL_SEG>')
  lines.push(el('    ', 'TRNNAM', 'USR_PLSEQ_TRAN'))
  lines.push(el('    ', 'WHSE_ID', settings.whseId))
  for (const s of segs) {
    const i = '      '
    lines.push('    <USR_PLSEQ_SEG>')
    lines.push(el(i, 'SEGNAM', 'USR PLSEQ'))
    lines.push(el(i, 'TRNTYP', s.trntyp))
    lines.push(el(i, 'UC_OP_AREA', s.opArea))
    lines.push(el(i, 'UC_PRODUCTION_LINE', s.prodLine))
    lines.push(el(i, 'UC_PROD_DTE', s.prodDte))
    lines.push(el(i, 'UC_SEQ_NUM', s.seqNum))
    lines.push(el(i, 'UC_FG_ITEM', s.fgItem))
    lines.push(el(i, 'UC_SNBR', ''))
    lines.push(el(i, 'PRTNUM', s.prtnum))
    lines.push(el(i, 'UC_TOKEN_NUM', s.token))
    lines.push(el(i, 'UC_ALT_ITEM', ''))
    lines.push(el(i, 'UC_QUE_DTE', s.queDte))
    lines.push(el(i, 'UC_OPS_SEQ', s.opsSeq))
    lines.push(el(i, 'PCKQTY', s.pckqty))
    lines.push(el(i, 'UC_INC_PRT_NUM', s.incPrtNum))
    lines.push(el(i, 'UC_VIN_NUM', ''))
    lines.push(el(i, 'UC_CARRIER', ''))
    lines.push(el(i, 'UC_STATUS', ''))
    lines.push(el(i, 'UC_SUBSAREA', ''))
    lines.push(el(i, 'UC_VINDTE', ''))
    lines.push('    </USR_PLSEQ_SEG>')
  }
  lines.push('  </CTRL_SEG>')
  lines.push('</USR_PLSEQ_INB_IFD>')
  return lines.join('\n') + '\n'
}

// ---------- checks ----------

export function validate(state, segs, now) {
  const { settings, models, vehicles } = state
  const issues = []
  const add = (level, text) => issues.push({ level, text })

  if (!vehicles.length) add('error', 'No vehicles. Set the model sequence and press Generate vehicles.')
  if (!settings.whseId.trim()) add('error', 'WHSE_ID is empty.')

  const known = new Set(models.map((m) => m.name))
  for (const v of vehicles) {
    if (!known.has(v.model)) add('error', `Vehicle ${v.seqNum} uses model "${v.model}" which does not exist.`)
  }
  for (const m of models) {
    if (!m.parts.length) add('warn', `Model ${m.name} has no parts.`)
  }

  const seen = new Set()
  for (const s of segs) {
    const key = `${s.token}|${s.incPrtNum}`
    if (seen.has(key)) add('error', `Repeated token + UC_INC_PRT_NUM (${s.token} / ${s.incPrtNum}). The second one fails on inbound.`)
    seen.add(key)
    if (!s.prtnum) add('error', `Vehicle ${s.seqNum}: a part number is empty.`)
    if (!s.opsSeq) add('error', `Vehicle ${s.seqNum}: ${s.prtnum || 'a part'} has no ops sequence.`)
    if (!(Number(s.pckqty) > 0)) add('error', `Vehicle ${s.seqNum}: ${s.prtnum} has a quantity that is not above 0.`)
  }

  const tokens = vehicles.map((v, i) => tokenFor(settings, v, i, now))
  if (new Set(tokens).size !== tokens.length) add('error', 'Two vehicles share the same token. Each vehicle needs its own token.')

  const seqNums = vehicles.map((v) => v.seqNum)
  if (new Set(seqNums).size !== seqNums.length) add('warn', 'UC_SEQ_NUM repeats across vehicles.')

  if (settings.maxCtn && vehicles.length > Number(settings.maxCtn)) {
    add('warn', `${vehicles.length} vehicles but the cart holds ${settings.maxCtn}. The extra vehicles go to the next cart.`)
  }

  if (segs.length) {
    const prod = segs[0].prodDte
    const y = Number(String(prod).slice(0, 4))
    const mo = Number(String(prod).slice(4, 6))
    const d = Number(String(prod).slice(6, 8))
    if (y && mo && d) {
      const prodDay = new Date(y, mo - 1, d)
      const limit = new Date(now.getFullYear(), now.getMonth(), now.getDate() + Number(settings.daysOut || 0))
      if (prodDay >= limit) {
        add('warn', `UC_PROD_DTE ${prod.slice(0, 8)} is outside the DAYS-OUT window (${settings.daysOut} days). The scan will not pick these up.`)
      }
    }
  }
  return issues
}

// ---------- cart barcodes ----------

export function barcodes(cartType, models, serial) {
  if (!cartType) return []
  const ops = new Set()
  for (const m of models) for (const p of m.parts) if (p.opsSeq.trim()) ops.add(p.opsSeq.trim())
  return [...ops].map((o) => ({
    ops: o,
    barcode: `S${cartType}${o}${serial}`,
    warn: cartType.length !== 7 || o.length !== 4,
  }))
}

// ---------- parsing a pasted / uploaded XML ----------

export function parseXml(text) {
  const cleaned = text
    .split('\n')
    .map((l) => l.replace(/^\s*-\s+(?=<)/, ''))
    .join('\n')
  const doc = new DOMParser().parseFromString(cleaned, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('That is not valid XML.')

  const get = (node, name) => {
    const n = node.getElementsByTagName(name)[0]
    return n ? n.textContent.trim() : ''
  }
  const segNodes = [...doc.getElementsByTagName('USR_PLSEQ_SEG')]
  if (!segNodes.length) throw new Error('No USR_PLSEQ_SEG segments found.')

  const settings = { whseId: get(doc, 'WHSE_ID') || 'U10' }
  const first = segNodes[0]
  settings.trntyp = get(first, 'TRNTYP') || 'R'
  settings.opArea = get(first, 'UC_OP_AREA')
  settings.prodLine = get(first, 'UC_PRODUCTION_LINE')
  settings.queDte = get(first, 'UC_QUE_DTE')
  const pd = get(first, 'UC_PROD_DTE')
  if (pd.length >= 8) {
    settings.prodTime = pd.slice(8) || '000001'
  }

  // group segments by token (one vehicle each); keep file order
  const byToken = new Map()
  for (const n of segNodes) {
    const tok = get(n, 'UC_TOKEN_NUM') || `__${byToken.size}`
    if (!byToken.has(tok)) byToken.set(tok, [])
    byToken.get(tok).push(n)
  }

  const models = []
  const modelBySig = new Map()
  const nameCount = new Map()
  const vehicles = []
  for (const [tok, nodes] of byToken) {
    const fg = get(nodes[0], 'UC_FG_ITEM') || 'MODEL'
    const parts = nodes
      .slice()
      .sort((a, b) => Number(get(a, 'UC_INC_PRT_NUM')) - Number(get(b, 'UC_INC_PRT_NUM')))
      .map((n) => ({
        id: uid(),
        prtnum: get(n, 'PRTNUM'),
        opsSeq: get(n, 'UC_OPS_SEQ'),
        qty: Number(get(n, 'PCKQTY') || 1),
      }))
    const sig = fg + '|' + parts.map((p) => `${p.prtnum}/${p.opsSeq}/${p.qty}`).join(';')
    if (!modelBySig.has(sig)) {
      const c = (nameCount.get(fg) || 0) + 1
      nameCount.set(fg, c)
      const name = c === 1 ? fg : `${fg}-${c}`
      modelBySig.set(sig, name)
      models.push({ id: uid(), name, parts })
    }
    vehicles.push({
      id: uid(),
      model: modelBySig.get(sig),
      seqNum: Number(get(nodes[0], 'UC_SEQ_NUM')) || vehicles.length + 1,
      token: tok.startsWith('__') ? '' : tok, // original token, only kept if "real time" is off
    })
  }
  return { settings, models, vehicles }
}
