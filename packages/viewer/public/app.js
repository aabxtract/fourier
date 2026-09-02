// ============================================================
// Fourier hosted viewer — code-gated, read-only live view.
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  const $ = id => document.getElementById(id)

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  }
  function num(value, digits = 1) {
    return typeof value === 'number' && isFinite(value) ? value.toFixed(digits) : '–'
  }
  function badge(text, cls) {
    return `<span class="chip ${cls}">${esc(text)}</span>`
  }
  function vrow(k, v) {
    return `<div class="vrow"><span class="k">${esc(k)}</span><span class="v">${v}</span></div>`
  }

  function storedCode() { return sessionStorage.getItem('fourierViewCode') }
  function setCode(code) { sessionStorage.setItem('fourierViewCode', code) }

  function showApp() {
    $('gate').style.display = 'none'
    $('appShell').hidden = false
    $('appMain').hidden = false
  }

  // ---------- navigation ----------
  const titles = { overview: 'Overview', memory: 'Memory & learning', delegation: 'Delegation' }
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'))
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
      btn.classList.add('active')
      $('page-' + btn.dataset.page).classList.add('active')
      $('pageTitle').textContent = titles[btn.dataset.page]
    })
  })

  $('forgetCode').addEventListener('click', () => {
    sessionStorage.removeItem('fourierViewCode')
    location.reload()
  })

  // ---------- gate ----------
  async function tryCode(code) {
    const res = await fetch('/api/view/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    })
    return res.ok
  }

  $('gateSubmit').addEventListener('click', async () => {
    const code = $('gateCode').value.trim()
    if (!code) return
    $('gateSubmit').disabled = true
    $('gateSubmit').textContent = 'Checking…'
    const ok = await tryCode(code)
    $('gateSubmit').disabled = false
    $('gateSubmit').textContent = 'View my agent'
    if (ok) {
      setCode(code)
      showApp()
      refresh()
    } else {
      $('gateError').hidden = false
    }
  })
  $('gateCode').addEventListener('keydown', e => { if (e.key === 'Enter') $('gateSubmit').click() })

  // ---------- data ----------
  function api(path) {
    return fetch(path, { headers: { 'X-Fourier-Code': storedCode() ?? '' } })
  }

  let overview = null

  async function refresh() {
    if (!storedCode()) return
    try {
      const [ov, mem, req] = await Promise.all([
        api('/api/view/overview'),
        api('/api/view/memory'),
        api('/api/view/requests')
      ])
      if (ov.status === 401) { sessionStorage.removeItem('fourierViewCode'); location.reload(); return }
      if (ov.ok) { overview = await ov.json(); renderOverview(overview) }
      if (mem.ok) renderMemory(await mem.json())
      if (req.ok) renderRequests(await req.json())
    } catch (err) {
      console.error('viewer refresh failed', err)
    }
  }

  function renderOverview({ agentId, policy, events }) {
    $('footAgent').textContent = agentId
    const latest = events[0]
    if (!latest) {
      $('kpiRunwayState').textContent = 'no checks synced yet'
      $('eventsTableBody').innerHTML = '<tr class="empty-row"><td colspan="6">No decisions mirrored yet — the agent pushes here after its next cycle.</td></tr>'
      $('runwayChart').innerHTML = '<div class="verdict-empty">No data yet.</div>'
      return
    }

    $('chipUpdated').textContent = `updated ${new Date(latest.created_at).toLocaleTimeString()}`

    const warn = policy?.warningRunwayDays ?? 7
    const act = policy?.actionRunwayDays ?? 3

    $('kpiRunway').textContent = num(Number(latest.runway_days))
    $('kpiAvailable').textContent = num(Number(latest.available_usdfc), 2)
    $('kpiLocked').textContent = '–' // locked is not mirrored per-event yet
    const rate = latest.spend_rate_per_day !== null && latest.spend_rate_per_day !== undefined
    $('kpiSpend').textContent = rate ? num(Number(latest.spend_rate_per_day), 2) : '–'
    $('kpiSpendNote').textContent = rate ? 'USDFC per day' : 'no active storage spend'

    const prev = events[1]
    if (prev) {
      const diff = Number(latest.runway_days) - Number(prev.runway_days)
      const el = $('kpiRunwayDelta')
      if (Math.abs(diff) > 0.001) {
        el.textContent = `${diff > 0 ? '▲' : '▼'} ${Math.abs(diff).toFixed(1)}d`
        el.className = `delta ${diff > 0 ? 'delta-up' : 'delta-down'}`
      }
    }

    const stateEl = $('kpiRunwayState')
    const runway = Number(latest.runway_days)
    if (runway <= act) { stateEl.textContent = 'below action threshold'; stateEl.className = 'chip chip-bad' }
    else if (runway <= warn) { stateEl.textContent = 'below warning threshold'; stateEl.className = 'chip chip-warn' }
    else { stateEl.textContent = 'healthy'; stateEl.className = 'chip chip-ok' }

    renderChart(events, warn, act)
    renderEvents(events)
  }

  function renderChart(events, warn, act) {
    const chart = $('runwayChart')
    const recent = events.slice(0, 7).reverse()
    const values = recent.map(e => Number(e.runway_days) || 0)
    const max = Math.max(...values, warn, act, 1) * 1.15

    const thresholds =
      '<div class="chart-grid"></div>' +
      `<div class="chart-thresh" style="bottom:${Math.min(96, (warn / max) * 100)}%"><span>warn ${warn}d</span></div>` +
      `<div class="chart-thresh" style="bottom:${Math.min(96, (act / max) * 100)}%"><span>act ${act}d</span></div>`

    chart.innerHTML = thresholds + recent.map((e, i) => {
      const v = Number(e.runway_days) || 0
      const sim = e.mode === 'simulate' ? ' bar-sim' : ''
      const label = i === recent.length - 1 ? 'now' : `-${recent.length - 1 - i}`
      return `
        <div class="bar-col">
          <div class="bar-tip">${num(v)} d · ${esc(e.mode)}</div>
          <div class="bar${sim}" style="height:${Math.max(2, (v / max) * 100)}%"></div>
          <span class="bar-label">${esc(label)}</span>
        </div>`
    }).join('')
    $('chartAux').textContent = `last ${recent.length} check${recent.length > 1 ? 's' : ''}`
  }

  function renderEvents(events) {
    $('eventsTableBody').innerHTML = events.map(e => {
      const chip = e.guardrail_status === 'allow'
        ? badge('allow', 'chip-ok')
        : e.guardrail_status === 'approval_required'
        ? badge('approval required', 'chip-warn')
        : badge(e.guardrail_status ?? '—', 'chip')
      return `
        <tr>
          <td class="dim">${esc(new Date(e.created_at).toLocaleTimeString())}</td>
          <td>${badge(e.mode, e.mode === 'live' ? 'chip-accent' : 'chip')}</td>
          <td class="num">${esc(num(Number(e.runway_days)))} d</td>
          <td><code>${esc(e.action)}</code></td>
          <td>${chip}</td>
          <td class="dim">${esc(e.reasoning)}</td>
        </tr>`
    }).join('')
  }

  function renderMemory(records) {
    const graded = records.filter(r => r.outcome)
    const ok = graded.filter(r => r.outcome.includes('SUCCESS') || r.outcome.includes('STABILIZED')).length
    const failed = graded.filter(r => r.outcome.includes('FAILED')).length
    $('memoryInsight').textContent = graded.length === 0
      ? 'No outcomes graded yet — decisions appear here after the agent\'s next cycle.'
      : `${ok} of ${graded.length} graded decisions landed well${failed ? `, ${failed} backfired` : ''}. The agent reads these outcomes into its next prompt.`

    $('memoryTableBody').innerHTML = records.length === 0
      ? '<tr class="empty-row"><td colspan="5">No memory mirrored yet.</td></tr>'
      : records.map(r => {
        const isSuccess = r.outcome?.includes('SUCCESS') || r.outcome?.includes('STABILIZED')
        const chip = !r.outcome ? badge('pending', 'chip')
          : r.outcome.includes('FAILED') ? badge(r.outcome, 'chip-bad')
          : isSuccess ? badge(r.outcome, 'chip-ok')
          : badge(r.outcome, 'chip')
        return `
          <tr>
            <td class="dim">${esc(new Date(r.created_at).toLocaleTimeString())}</td>
            <td><strong>${esc(r.action)}</strong></td>
            <td class="num">${esc(num(Number(r.runway_days_at_decision)))} d</td>
            <td class="num">${r.amount_if_topup !== null && r.amount_if_topup !== undefined ? esc(r.amount_if_topup) + ' USDFC' : '—'}</td>
            <td>${chip}</td>
          </tr>`
      }).join('')
  }

  function renderRequests(requests) {
    $('delegationTableBody').innerHTML = requests.length === 0
      ? '<tr class="empty-row"><td colspan="7">No delegation requests mirrored.</td></tr>'
      : requests.map(r => {
        const chip = r.status === 'approved' ? badge('approved', 'chip-ok')
          : r.status === 'rejected' ? badge('rejected', 'chip-bad')
          : badge('pending', 'chip-warn')
        return `
          <tr>
            <td><code>${esc(r.id)}</code></td>
            <td>${esc(r.requesting_agent_id)}</td>
            <td>${esc(r.treasury_agent_id)}</td>
            <td class="num">${esc(r.amount_requested)} USDFC</td>
            <td class="dim">${esc(r.reason)}</td>
            <td>${chip}${r.settled_at ? '<span class="dim" style="font-size:11px"> · settled</span>' : ''}</td>
            <td>${r.tx_hash ? `<code>${esc(String(r.tx_hash).slice(0, 14))}…</code>` : '—'}</td>
          </tr>`
      }).join('')
  }

  // boot: auto-enter if a code is already in this session (e.g., ?code= link)
  const urlCode = new URLSearchParams(location.search).get('code')
  if (urlCode) setCode(urlCode.trim())
  if (storedCode()) {
    tryCode(storedCode()).then(ok => {
      if (ok) { showApp(); refresh() } else { sessionStorage.removeItem('fourierViewCode') }
    })
  }
  setInterval(refresh, 5000)
})
