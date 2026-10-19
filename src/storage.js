// Small localStorage helpers. Everything is wrapped in try/catch because
// storage can be blocked (private window, cleared site data).

const CURRENT = 'plb.current.v1'
const VERSIONS = 'plb.versions.v1'

export function loadCurrent() {
  try {
    const raw = localStorage.getItem(CURRENT)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function saveCurrent(state) {
  try {
    localStorage.setItem(CURRENT, JSON.stringify(state))
  } catch {
    /* ignore */
  }
}

export function loadVersions() {
  try {
    const raw = localStorage.getItem(VERSIONS)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveVersions(list) {
  try {
    localStorage.setItem(VERSIONS, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}
