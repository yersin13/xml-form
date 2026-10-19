import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_SETTINGS,
  barcodes,
  buildSegments,
  buildVehicles,
  computeProdDate,
  parseXml,
  toXml,
  tokenFor,
  uid,
  validate,
} from './payload.js'
import { loadCurrent, loadVersions, saveCurrent, saveVersions } from './storage.js'

const part = (prtnum, opsSeq, qty = 1) => ({ id: uid(), prtnum, opsSeq, qty })

function starterState() {
  const models = [
    {
      id: uid(),
      name: 'MODEL1',
      parts: [part('5459361-070', 'D220'), part('5459362-070', 'D220'), part('5459363-070', 'D220')],
    },
    {
      id: uid(),
      name: 'MODEL2',
      parts: [part('5459364-070', 'D220'), part('5454346-070', 'D220'), part('5454347-070', 'D220')],
    },
  ]
  return {
    settings: { ...DEFAULT_SETTINGS, cartType: '2DRFLR1', maxCtn: 12 },
    models,
    pattern: 'MODEL1,MODEL2',
    count: 12,
    vehicles: buildVehicles('MODEL1,MODEL2', 12),
    liveTokens: true,
  }
}

function initialState() {
  const saved = loadCurrent()
  if (saved && saved.settings && saved.models && saved.vehicles) {
    return { ...starterState(), ...saved, settings: { ...DEFAULT_SETTINGS, ...saved.settings } }
  }
  return starterState()
}

function download(filename, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  }
}

export default function App() {
  const [state, setState] = useState(initialState)
  const [now, setNow] = useState(() => new Date())
  const [live, setLive] = useState(true)
  const [versions, setVersions] = useState(loadVersions)
  const [versionName, setVersionName] = useState('')
  const [xmlText, setXmlText] = useState('')
  const [toast, setToast] = useState('')
  const [serial, setSerial] = useState('A01')
  const fileRef = useRef(null)
  const importRef = useRef(null)

  const { settings, models, vehicles } = state

  // keep the clock running so the tokens always show the current time
  useEffect(() => {
    if (!live) return undefined
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [live])

  useEffect(() => {
    saveCurrent(state)
  }, [state])

  useEffect(() => {
    saveVersions(versions)
  }, [versions])

  const flash = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2200)
  }

  const set = (patch) => setState((s) => ({ ...s, ...patch }))
  const setSetting = (key, value) => setState((s) => ({ ...s, settings: { ...s.settings, [key]: value } }))

  // ---------- derived ----------
  const segs = useMemo(() => buildSegments(state, now), [state, now])
  const xml = useMemo(() => toXml(settings, segs), [settings, segs])
  const issues = useMemo(() => validate(state, segs, now), [state, segs, now])
  const errors = issues.filter((i) => i.level === 'error')
  const codes = useMemo(
    () => barcodes(settings.cartType.trim(), models, serial.trim()),
    [settings.cartType, models, serial],
  )

  // ---------- models ----------
  const updateModel = (id, fn) =>
    setState((s) => ({ ...s, models: s.models.map((m) => (m.id === id ? fn(m) : m)) }))

  const renameModel = (id, name) =>
    setState((s) => {
      const old = s.models.find((m) => m.id === id)
      return {
        ...s,
        models: s.models.map((m) => (m.id === id ? { ...m, name } : m)),
        vehicles: s.vehicles.map((v) => (v.model === old.name ? { ...v, model: name } : v)),
      }
    })

  const addModel = () =>
    setState((s) => {
      let n = s.models.length + 1
      while (s.models.some((m) => m.name === `MODEL${n}`)) n++
      return { ...s, models: [...s.models, { id: uid(), name: `MODEL${n}`, parts: [part('', '')] }] }
    })

  const removeModel = (id) => setState((s) => ({ ...s, models: s.models.filter((m) => m.id !== id) }))

  const pasteParts = (id, text) => {
    const rows = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [p, o, q] = l.split(/[\t,; ]+/)
        return part(p || '', o || '', Number(q) > 0 ? Number(q) : 1)
      })
    updateModel(id, (m) => ({ ...m, parts: [...m.parts.filter((p) => p.prtnum || p.opsSeq), ...rows] }))
  }

  // ---------- vehicles ----------
  const generate = () => set({ vehicles: buildVehicles(state.pattern, state.count) })
  const updateVehicle = (id, patch) =>
    setState((s) => ({ ...s, vehicles: s.vehicles.map((v) => (v.id === id ? { ...v, ...patch } : v)) }))
  const removeVehicle = (id) => setState((s) => ({ ...s, vehicles: s.vehicles.filter((v) => v.id !== id) }))
  const clearTokens = () => setState((s) => ({ ...s, vehicles: s.vehicles.map((v) => ({ ...v, token: '' })) }))

  // ---------- output ----------
  const freshXml = () => {
    // build again at the exact moment of copy / download so the tokens are current
    const t = new Date()
    setNow(t)
    return toXml(settings, buildSegments(state, t))
  }

  const doCopy = async () => {
    if (errors.length && !window.confirm(`${errors.length} error(s) in the checks. Copy anyway?`)) return
    flash((await copyText(live ? freshXml() : xml)) ? 'Payload copied' : 'Copy failed')
  }

  const doDownload = () => {
    if (errors.length && !window.confirm(`${errors.length} error(s) in the checks. Download anyway?`)) return
    const t = new Date()
    const stamp = `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}-${String(t.getHours()).padStart(2, '0')}${String(t.getMinutes()).padStart(2, '0')}`
    download(`USR_PLSEQ_${stamp}.xml`, live ? freshXml() : xml, 'application/xml')
  }

  // ---------- versions ----------
  const snapshot = () => ({
    settings: state.settings,
    models: state.models,
    pattern: state.pattern,
    count: state.count,
    vehicles: state.vehicles,
    liveTokens: state.liveTokens,
  })

  const saveVersion = () => {
    const name = versionName.trim() || `Version ${versions.length + 1}`
    setVersions((v) => [{ id: uid(), name, savedAt: new Date().toISOString(), data: snapshot() }, ...v])
    setVersionName('')
    flash(`Saved "${name}"`)
  }

  const loadVersion = (v) => {
    const data = v.data
    const next = {
      ...state,
      ...data,
      settings: { ...DEFAULT_SETTINGS, ...data.settings },
      vehicles: data.vehicles.map((x) => ({ ...x, id: uid(), token: data.liveTokens ? '' : x.token })),
    }
    setState(next)
    setNow(new Date())
    flash(`Loaded "${v.name}" with fresh tokens`)
  }

  const deleteVersion = (id) => setVersions((v) => v.filter((x) => x.id !== id))

  const exportVersions = () => download('plseq-versions.json', JSON.stringify(versions, null, 2), 'application/json')

  const importVersions = async (file) => {
    try {
      const list = JSON.parse(await file.text())
      if (!Array.isArray(list)) throw new Error()
      setVersions((v) => [...list.map((x) => ({ ...x, id: uid() })), ...v])
      flash(`Imported ${list.length} version(s)`)
    } catch {
      flash('That file is not a versions export')
    }
  }

  // ---------- pre-load an XML ----------
  const loadXml = (text) => {
    try {
      const parsed = parseXml(text)
      const live = state.liveTokens
      setState((s) => ({
        ...s,
        settings: { ...s.settings, ...parsed.settings },
        models: parsed.models,
        vehicles: parsed.vehicles.map((v) => ({ ...v, token: live ? '' : v.token })),
        pattern: [...new Set(parsed.vehicles.map((v) => v.model))].join(','),
        count: parsed.vehicles.length,
      }))
      setNow(new Date())
      setXmlText('')
      flash(`Loaded ${parsed.vehicles.length} vehicle(s)${live ? ' with fresh tokens' : ''}`)
    } catch (e) {
      flash(e.message)
    }
  }

  const onFile = async (file) => {
    if (file) loadXml(await file.text())
  }

  const resetAll = () => {
    if (window.confirm('Reset to the starter example? Saved versions are kept.')) {
      setState(starterState())
      setNow(new Date())
    }
  }

  const prodDate = computeProdDate(settings, now)

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>PLSEQ Payload Builder</h1>
          <p className="sub">USR_PLSEQ_TRAN inbound for the sequencing chain</p>
        </div>
        <div className="clock">
          <span className={live ? 'dot on' : 'dot'} />
          <label>
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> Live time
          </label>
          <button className="ghost" onClick={() => setNow(new Date())}>
            Refresh now
          </button>
          <code>{now.toLocaleTimeString()}</code>
        </div>
      </header>

      <main className="grid">
        <section className="col">
          {/* ---------------- settings ---------------- */}
          <div className="card">
            <h2>Header</h2>
            <div className="fields">
              <label>
                WHSE_ID
                <input value={settings.whseId} onChange={(e) => setSetting('whseId', e.target.value)} />
              </label>
              <label>
                TRNTYP
                <select value={settings.trntyp} onChange={(e) => setSetting('trntyp', e.target.value)}>
                  <option>R</option>
                  <option>A</option>
                </select>
              </label>
              <label>
                Production line
                <input value={settings.prodLine} onChange={(e) => setSetting('prodLine', e.target.value)} />
              </label>
              <label>
                UC_OP_AREA
                <input value={settings.opArea} onChange={(e) => setSetting('opArea', e.target.value)} />
              </label>
              <label>
                UC_QUE_DTE
                <input value={settings.queDte} onChange={(e) => setSetting('queDte', e.target.value)} placeholder="empty" />
              </label>
              <label>
                Prod date
                <select value={settings.prodDateMode} onChange={(e) => setSetting('prodDateMode', e.target.value)}>
                  <option value="auto">Today + days</option>
                  <option value="manual">Type it</option>
                </select>
              </label>
              {settings.prodDateMode === 'auto' ? (
                <>
                  <label>
                    Days from today
                    <input type="number" value={settings.prodDateOffset} onChange={(e) => setSetting('prodDateOffset', e.target.value)} />
                  </label>
                  <label>
                    Time part
                    <input value={settings.prodTime} onChange={(e) => setSetting('prodTime', e.target.value)} />
                  </label>
                </>
              ) : (
                <label className="wide">
                  UC_PROD_DTE
                  <input value={settings.prodDateManual} onChange={(e) => setSetting('prodDateManual', e.target.value)} placeholder="20261008000001" />
                </label>
              )}
            </div>
            <p className="hint">
              UC_PROD_DTE will be <code>{prodDate}</code>
            </p>
            <details>
              <summary>Token and cart options</summary>
              <div className="fields">
                <label>
                  Token suffix starts at
                  <input type="number" value={settings.tokenSuffixStart} onChange={(e) => setSetting('tokenSuffixStart', e.target.value)} />
                </label>
                <label>
                  Seconds between vehicles
                  <input type="number" value={settings.tokenStepSec} onChange={(e) => setSetting('tokenStepSec', e.target.value)} />
                </label>
                <label>
                  DAYS-OUT policy
                  <input type="number" value={settings.daysOut} onChange={(e) => setSetting('daysOut', e.target.value)} />
                </label>
                <label>
                  Cart type (for barcodes)
                  <input value={settings.cartType} onChange={(e) => setSetting('cartType', e.target.value)} placeholder="2DRFLR1" />
                </label>
                <label>
                  Cart max_ctn
                  <input type="number" value={settings.maxCtn} onChange={(e) => setSetting('maxCtn', e.target.value)} />
                </label>
              </div>
            </details>
          </div>

          {/* ---------------- models ---------------- */}
          <div className="card">
            <div className="row-between">
              <h2>Models</h2>
              <button onClick={addModel}>+ Model</button>
            </div>
            {models.map((m) => (
              <div className="model" key={m.id}>
                <div className="row-between">
                  <input className="model-name" value={m.name} onChange={(e) => renameModel(m.id, e.target.value)} />
                  <button className="ghost danger" onClick={() => removeModel(m.id)}>
                    Delete
                  </button>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>Part number</th>
                      <th>Ops seq</th>
                      <th>Qty</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {m.parts.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <input
                            value={p.prtnum}
                            onChange={(e) =>
                              updateModel(m.id, (mm) => ({ ...mm, parts: mm.parts.map((x) => (x.id === p.id ? { ...x, prtnum: e.target.value } : x)) }))
                            }
                          />
                        </td>
                        <td className="narrow">
                          <input
                            value={p.opsSeq}
                            onChange={(e) =>
                              updateModel(m.id, (mm) => ({ ...mm, parts: mm.parts.map((x) => (x.id === p.id ? { ...x, opsSeq: e.target.value } : x)) }))
                            }
                          />
                        </td>
                        <td className="narrow">
                          <input
                            type="number"
                            min="1"
                            value={p.qty}
                            onChange={(e) =>
                              updateModel(m.id, (mm) => ({ ...mm, parts: mm.parts.map((x) => (x.id === p.id ? { ...x, qty: e.target.value } : x)) }))
                            }
                          />
                        </td>
                        <td className="x">
                          <button className="ghost" onClick={() => updateModel(m.id, (mm) => ({ ...mm, parts: mm.parts.filter((x) => x.id !== p.id) }))}>
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="row">
                  <button className="ghost" onClick={() => updateModel(m.id, (mm) => ({ ...mm, parts: [...mm.parts, part('', mm.parts.at(-1)?.opsSeq || '')] }))}>
                    + Part
                  </button>
                  <PasteParts onAdd={(t) => pasteParts(m.id, t)} />
                </div>
              </div>
            ))}
          </div>

          {/* ---------------- vehicles ---------------- */}
          <div className="card">
            <h2>Vehicles</h2>
            <div className="fields">
              <label className="wide">
                Model sequence (comma separated, repeats)
                <input value={state.pattern} onChange={(e) => set({ pattern: e.target.value })} placeholder="MODEL1,MODEL2" />
              </label>
              <label>
                How many vehicles
                <input type="number" min="1" value={state.count} onChange={(e) => set({ count: e.target.value })} />
              </label>
              <div className="end">
                <button className="primary" onClick={generate}>
                  Generate vehicles
                </button>
              </div>
            </div>
            <label className="check">
              <input type="checkbox" checked={state.liveTokens} onChange={(e) => set({ liveTokens: e.target.checked })} />
              Tokens always follow real time (loading a version or XML replaces old tokens)
            </label>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Model</th>
                  <th>UC_SEQ_NUM</th>
                  <th>Token</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {vehicles.map((v, i) => (
                  <tr key={v.id}>
                    <td className="n">{i + 1}</td>
                    <td className="narrow">
                      <select value={v.model} onChange={(e) => updateVehicle(v.id, { model: e.target.value })}>
                        {!models.some((m) => m.name === v.model) && <option>{v.model}</option>}
                        {models.map((m) => (
                          <option key={m.id}>{m.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="narrow">
                      <input type="number" value={v.seqNum} onChange={(e) => updateVehicle(v.id, { seqNum: Number(e.target.value) })} />
                    </td>
                    <td>
                      <input
                        className={v.token ? 'mono pinned' : 'mono'}
                        value={v.token}
                        placeholder={tokenFor(settings, v, i, now)}
                        onChange={(e) => updateVehicle(v.id, { token: e.target.value })}
                      />
                    </td>
                    <td className="x">
                      <button className="ghost" onClick={() => removeVehicle(v.id)}>
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint">
              An empty token follows the clock. Typing one pins it.{' '}
              <button className="link" onClick={clearTokens}>
                Unpin all
              </button>
            </p>
          </div>
        </section>

        <section className="col sticky">
          {/* ---------------- output ---------------- */}
          <div className="card">
            <div className="row-between">
              <h2>
                Payload <span className="count">{vehicles.length} vehicles · {segs.length} segments</span>
              </h2>
              <div className="row">
                <button className="primary" onClick={doCopy}>
                  Copy
                </button>
                <button onClick={doDownload}>Download</button>
              </div>
            </div>
            <pre className="xml">{xml}</pre>
          </div>

          <div className="card">
            <h2>Checks</h2>
            {issues.length === 0 ? (
              <p className="ok">All good. Nothing to fix.</p>
            ) : (
              <ul className="issues">
                {issues.slice(0, 12).map((i, k) => (
                  <li key={k} className={i.level}>
                    {i.text}
                  </li>
                ))}
                {issues.length > 12 && <li className="warn">…and {issues.length - 12} more</li>}
              </ul>
            )}
          </div>

          <div className="card">
            <h2>Cart barcodes</h2>
            {settings.cartType.trim() ? (
              <>
                <label className="inline">
                  Serial
                  <input className="serial" value={serial} onChange={(e) => setSerial(e.target.value)} />
                </label>
                <ul className="codes">
                  {codes.map((c) => (
                    <li key={c.ops}>
                      <code>{c.barcode}</code>
                      {c.warn && <span className="warn"> cart type should be 7 characters and ops seq 4</span>}
                      <button className="ghost" onClick={async () => flash((await copyText(c.barcode)) ? 'Copied' : 'Copy failed')}>
                        Copy
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="hint">Use a new serial for every test. A barcode counts as existing work until its shipment is complete or cancelled.</p>
              </>
            ) : (
              <p className="hint">Set the cart type under Header → Token and cart options.</p>
            )}
          </div>

          {/* ---------------- versions ---------------- */}
          <div className="card">
            <h2>Saved versions</h2>
            <div className="row">
              <input
                className="grow"
                placeholder="Name this setup, for example D220 12 vehicles"
                value={versionName}
                onChange={(e) => setVersionName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveVersion()}
              />
              <button className="primary" onClick={saveVersion}>
                Save
              </button>
            </div>
            {versions.length === 0 && <p className="hint">Nothing saved yet.</p>}
            <ul className="versions">
              {versions.map((v) => (
                <li key={v.id}>
                  <div>
                    <strong>{v.name}</strong>
                    <span className="hint">
                      {' '}
                      {v.data.vehicles.length} vehicles · {new Date(v.savedAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="row">
                    <button onClick={() => loadVersion(v)}>Load</button>
                    <button className="ghost danger" onClick={() => deleteVersion(v.id)}>
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="row">
              <button className="ghost" onClick={exportVersions} disabled={!versions.length}>
                Export all
              </button>
              <button className="ghost" onClick={() => importRef.current?.click()}>
                Import
              </button>
              <input ref={importRef} type="file" accept=".json" hidden onChange={(e) => e.target.files[0] && importVersions(e.target.files[0])} />
            </div>
          </div>

          <div className="card">
            <h2>Pre-load an XML</h2>
            <p className="hint">Paste a payload or pick a file. Parts, models and ops sequences are kept. Tokens follow the clock when that option is on.</p>
            <textarea rows="5" value={xmlText} onChange={(e) => setXmlText(e.target.value)} placeholder="<USR_PLSEQ_INB_IFD>…" />
            <div className="row">
              <button className="primary" onClick={() => loadXml(xmlText)} disabled={!xmlText.trim()}>
                Load pasted XML
              </button>
              <button onClick={() => fileRef.current?.click()}>Choose file</button>
              <input ref={fileRef} type="file" accept=".xml,.txt" hidden onChange={(e) => onFile(e.target.files[0])} />
              <span className="grow" />
              <button className="ghost danger" onClick={resetAll}>
                Reset
              </button>
            </div>
          </div>
        </section>
      </main>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function PasteParts({ onAdd }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  if (!open) {
    return (
      <button className="ghost" onClick={() => setOpen(true)}>
        Paste list
      </button>
    )
  }
  return (
    <div className="paste">
      <textarea
        rows="4"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'One part per line:\n5459361-070 D220 1\n5459362-070 D220'}
      />
      <div className="row">
        <button
          className="primary"
          onClick={() => {
            onAdd(text)
            setText('')
            setOpen(false)
          }}
        >
          Add parts
        </button>
        <button className="ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  )
}
