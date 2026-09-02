// ============================================================
// Fourier Operational Dashboard — app logic
// Pages: Overview · Simulation · Delegation · Memory · Policy Studio
// All store-derived strings are HTML-escaped before rendering.
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  const $ = id => document.getElementById(id)

  // ---------- utilities ----------

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function num(value, digits = 1) {
    return typeof value === 'number' && isFinite(value) ? value.toFixed(digits) : '–'
  }

  function time(iso) {
    const d = new Date(iso)
    return isNaN(d) ? '–' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  function api(path, options = {}) {
    const token = sessionStorage.getItem('fourierToken')
    const headers = { ...(options.headers || {}) }
    if (token) headers.Authorization = `Bearer ${token}`
    return fetch(path, { ...options, headers })
  }

  function handle401() {
    $('authOverlay').hidden = false
  }

  $('authSubmit').addEventListener('click', async () => {
    sessionStorage.setItem('fourierToken', $('authTokenInput').value.trim())
    try {
      const res = await api('/api/status')
      if (res.ok) {
        $('authOverlay').hidden = true
        $('authError').hidden = true
        refresh()
      } else {
        $('authError').hidden = false
      }
    } catch { $('authError').hidden = false }
  })

  // ---------- navigation ----------

  const pageTitles = {
    overview: 'Overview',
    simulation: 'Simulation',
    delegation: 'Delegation',
    memory: 'Memory & learning',
    policy: 'Policy Studio'
  }

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'))
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
      btn.classList.add('active')
      const page = btn.dataset.page
      $('page-' + page).classList.add('active')
      $('pageTitle').textContent = pageTitles[page]
      document.title = `Fourier — ${pageTitles[page]}`
    })
  })

  $('refreshBtn').addEventListener('click', refresh)

  // ---------- state ----------

  let latestStatus = null
  let latestEvents = []
  let simChoice = 'burn-spike'

  // ---------- simulation picker ----------

  document.querySelectorAll('.sim-option').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sim-option').forEach(b => b.classList.remove('selected'))
      btn.classList.add('selected')
      simChoice = btn.dataset.sim
      $('replayRow').hidden = simChoice !== 'replay'
    })
  })

  $('replayDays').addEventListener('input', e => {
    $('replayDaysLabel').textContent = e.target.value
  })

  $('btnRunSim').addEventListener('click', async () => {
    const btn = $('btnRunSim')
    btn.disabled = true
    btn.textContent = 'Running…'
    try {
      const payload =
        simChoice === 'replay' ? { replayDays: parseInt($('replayDays').value, 10) }
        : simChoice === 'live' ? {}
        : { scenario: simChoice }

      const res = await api('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const data = await res.json()
      renderSimVerdict(data)
      $('simRaw').hidden = false
      $('simRawOutput').textContent = JSON.stringify(data, null, 2)
      refresh()
    } catch (err) {
      $('simVerdict').innerHTML = `<div class="verdict-empty">Simulation failed: ${esc(err.message)}</div>`
    } finally {
      btn.disabled = false
      btn.textContent = 'Run simulation'
    }
  })

  function badge(text, cls) {
    return `<span class="chip ${cls}">${esc(text)}</span>`
  }

  function renderSimVerdict(data) {
    const state = data.state || {}
    const proposal = data.proposal || {}
    const decision = data.decision || proposal
    const guardrail = data.guardrail || {}
    const execution = data.execution || {}
    const approval = data.approval

    let title = decision.action || proposal.action || 'HOLD'
    let extra = ''

    if (title === 'TOP_UP') {
      const projected = execution.estimatedNewRunwayDays
      title = `Top up ${decision.amountUSDFC} USDFC`
      extra += vrow('Runway now', `${num(state.runwayDays)} days`)
      if (projected) extra += vrow('Runway after', `~${num(projected)} days`)
      if (guardrail.clamped) extra += vrow('Guardrail', 'amount clamped to policy max')
      extra += vrow('Transaction', 'none — simulation only')
    } else if (title === 'TRIAGE') {
      title = 'Triage approval required'
      const ranked = (decision.rankedDatasetIds || []).map(esc).join(' → ')
      extra += vrow('Ranked datasets', ranked || '–')
      if (approval?.token) extra += vrow('Approval token', `<code>${esc(approval.token)}</code>`)
      extra += vrow('Transaction', 'none — approval first')
    } else if (title === 'HOLD') {
      title = 'Hold — no action needed'
      extra += vrow('Runway', `${num(state.runwayDays)} days`)
    } else if (title === 'WARN') {
      title = 'Warning raised'
      extra += vrow('Runway', `${num(state.runwayDays)} days`)
    }

    if (data.mode === 'replay') {
      extra += vrow('Replay window', `last ${data.replayDays} day(s)`)
    }

    const statusChip = guardrail.status === 'approval_required'
      ? badge('approval required', 'chip-warn')
      : guardrail.status === 'hold'
      ? badge('blocked by guardrail', 'chip-bad')
      : badge('guardrails passed', 'chip-ok')

    $('simVerdict').innerHTML = `
      <div class="verdict-action">${statusChip}<span class="verdict-title">${esc(title)}</span></div>
      ${decision.reasoning ? `<div class="verdict-reason">${esc(decision.reasoning)}</div>` : ''}
      <div class="verdict-rows">${extra}</div>
      <div class="verdict-chips">${badge('zero transactions', 'chip')}</div>
    `
  }

  function vrow(k, v) {
    return `<div class="vrow"><span class="k">${esc(k)}</span><span class="v">${v}</span></div>`
  }

  // ---------- policy compiler ----------

  $('btnCompilePolicy').addEventListener('click', async () => {
    const btn = $('btnCompilePolicy')
    btn.disabled = true
    btn.textContent = 'Compiling…'
    try {
      const res = await api('/api/policy/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: $('policyInputText').value })
      })
      const compiled = await res.json()
      renderPolicy(compiled)
      $('policyRaw').hidden = false
      $('compiledPolicyOutput').textContent = JSON.stringify(compiled, null, 2)
    } catch (err) {
      $('policyResult').innerHTML = `<div class="verdict-empty">Compilation failed: ${esc(err.message)}. The compiler refuses to guess — tighten the wording and retry.</div>`
      $('policyRaw').hidden = true
    } finally {
      btn.disabled = false
      btn.textContent = 'Compile policy'
    }
  })

  function renderPolicy(p) {
    $('policyVersion').textContent = p.version ? `version ${p.version}` : ''
    const flags = []
    flags.push(p.topUpEnabled ? badge('top-ups on', 'chip-ok') : badge('top-ups off', 'chip-bad'))
    flags.push(p.triageEnabled ? badge('triage on', 'chip-ok') : badge('triage off', 'chip'))
    if (p.triageEnabled) flags.push(p.triageRequiresApproval ? badge('approval required', 'chip-warn') : badge('no approval', 'chip-bad'))
    $('policyResult').innerHTML = `
      <div class="policy-rows">
        ${vrow('Warn below', `${num(p.warningRunwayDays)} days`)}
        ${vrow('Act below', `${num(p.actionRunwayDays)} days`)}
        ${vrow('Max auto top-up', `${p.maxAutoTopUpUSDFC} USDFC`)}
        <div class="vrow"><span class="k">Dataset priority</span><span class="v prio-chips">${(p.datasetPriority || []).map(d => `<span class="chip">${esc(d)}</span>`).join('') || '–'}</span></div>
        <div class="vrow"><span class="k">Flags</span><span class="v prio-chips">${flags.join('')}</span></div>
      </div>
    `
  }

  // ---------- data refresh & rendering ----------

  async function refresh() {
    try {
      const [statusRes, eventsRes, memRes, reqRes] = await Promise.all([
        api('/api/status'),
        api('/api/events?limit=20'),
        api('/api/memory'),
        api('/api/requests')
      ])

      if (statusRes.status === 401 || eventsRes.status === 401) return handle401()
      // Server isn't asking for a token (anymore) — never keep the overlay up.
      $('authOverlay').hidden = true
      $('authError').hidden = true

      if (statusRes.ok) {
        latestStatus = await statusRes.json()
        renderStatus(latestStatus)
      }
      if (eventsRes.ok) {
        latestEvents = await eventsRes.json()
        renderEvents()
        renderLatestVerdict()
      }
      if (memRes.ok) renderMemory(await memRes.json())
      if (reqRes.ok) renderRequests(await reqRes.json())
    } catch (err) {
      console.error('Dashboard refresh failed:', err)
    }
  }

  function renderStatus({ config, policy, latestEvent, health }) {
    // sidebar + topbar identity
    $('footNetwork').textContent = config.network === 'calibration' ? 'Calibration' : 'Mainnet'
    $('chipNetwork').textContent = config.network === 'calibration' ? 'Calibration' : 'Mainnet'
    $('footProvider').textContent = config.model.provider
    const mode = latestEvent?.mode || 'live'
    $('footMode').textContent = mode
    $('chipMode').textContent = mode.toUpperCase()

    const stale = health?.watcher === 'stale'
    $('footDot').className = `dot ${stale ? 'dot-stale' : 'dot-live'}`

    // KPIs
    const state = latestEvent?.state
    if (state) {
      $('kpiRunway').textContent = num(state.runwayDays)
      $('kpiAvailable').textContent = num(state.availableUSDFC, 2)
      $('kpiLocked').textContent = num(state.lockedUSDFC, 2)
      $('kpiSpend').textContent = state.spendRateUSDFCPerDay !== null ? num(state.spendRateUSDFCPerDay, 2) : '–'
      $('kpiSpendNote').textContent = state.spendRateUSDFCPerDay !== null ? 'USDFC per day' : 'no active storage spend'

      // deltas vs previous event
      const prev = latestEvents.find(e => e.id !== latestEvent.id)
      renderDelta('kpiRunwayDelta', prev?.state?.runwayDays, state.runwayDays, 'd', true)
      renderDelta('kpiAvailableDelta', prev?.state?.availableUSDFC, state.availableUSDFC, '', false)

      // runway health chip
      const stateEl = $('kpiRunwayState')
      if (state.runwayDays <= policy.actionRunwayDays) {
        stateEl.textContent = 'below action threshold'
        stateEl.className = 'chip chip-bad'
      } else if (state.runwayDays <= policy.warningRunwayDays) {
        stateEl.textContent = 'below warning threshold'
        stateEl.className = 'chip chip-warn'
      } else {
        stateEl.textContent = 'healthy'
        stateEl.className = 'chip chip-ok'
      }

      renderChart(policy)
      renderLatestIntoVerdict(latestEvent)
    }

    // delegation page stats
    $('delRole').textContent = config.role
    $('delTreasury').textContent = config.role === 'standalone' ? '—' : (config.treasuryAgentId || 'treasury-main')
    $('delCoord').textContent = health?.delegation?.coordination === 'remote' ? 'remote coordination' : 'local queue'
    $('delPoll').textContent = `polled every ${config.delegationPollMinutes || 5} min`
  }

  function renderDelta(id, before, after, unit, downIsGood) {
    const el = $(id)
    if (typeof before !== 'number' || typeof after !== 'number' || before === after) {
      el.textContent = ''
      return
    }
    const diff = after - before
    const up = diff > 0
    const good = downIsGood ? !up : up
    el.textContent = `${up ? '▲' : '▼'} ${Math.abs(diff).toFixed(1)}${unit}`
    el.className = `delta ${good ? 'delta-up' : 'delta-down'}`
  }

  // Signature element: runway bars aligned against policy thresholds.
  function renderChart(policy) {
    const chart = $('runwayChart')
    const events = [...latestEvents].slice(-7)
    if (events.length === 0) {
      chart.innerHTML = '<div class="verdict-empty">No checks recorded yet.</div>'
      $('chartAux').textContent = 'no data'
      return
    }

    const values = events.map(e => e.state?.runwayDays ?? 0)
    const max = Math.max(...values, policy.warningRunwayDays, policy.actionRunwayDays, 1) * 1.15
    const yPct = d => `${Math.min(96, (d / max) * 100)}%`

    const thresholds =
      `<div class="chart-grid"></div>` +
      `<div class="chart-thresh" style="bottom:${yPct(policy.warningRunwayDays)}"><span>warn ${policy.warningRunwayDays}d</span></div>` +
      `<div class="chart-thresh" style="bottom:${yPct(policy.actionRunwayDays)}"><span>act ${policy.actionRunwayDays}d</span></div>`

    const bars = events.map((e, i) => {
      const v = e.state?.runwayDays ?? 0
      const sim = e.mode === 'simulate' ? ' bar-sim' : ''
      const label = i === events.length - 1 ? 'now' : `-${events.length - 1 - i}`
      return `
        <div class="bar-col">
          <div class="bar-tip">${num(v)} d · ${esc(e.mode)}</div>
          <div class="bar${sim}" style="height:${Math.max(2, (v / max) * 100)}%"></div>
          <span class="bar-label">${esc(label)}</span>
        </div>`
    }).join('')

    chart.innerHTML = thresholds + bars
    $('chartAux').textContent = `last ${events.length} check${events.length > 1 ? 's' : ''}`
  }

  function renderLatestIntoVerdict(event) {
    const decision = event.decision || {}
    const guardrail = event.guardrail || {}
    const execution = event.execution || {}
    const state = event.state || {}

    let title = decision.action || 'HOLD'
    if (title === 'TOP_UP') title = `Top up ${decision.amountUSDFC} USDFC`
    if (title === 'TRIAGE') title = 'Triage (approval gated)'
    if (title === 'HOLD') title = 'Hold'

    const chip = guardrail.status === 'approval_required'
      ? badge('approval required', 'chip-warn')
      : guardrail.status === 'hold'
      ? badge('blocked', 'chip-bad')
      : badge('allowed', 'chip-ok')

    const tx = execution.transactionId
      ? `<code>${esc(String(execution.transactionId).slice(0, 14))}…</code>`
      : (execution.status === 'simulated' ? 'none — simulated' : '—')

    $('latestVerdict').innerHTML = `
      <div class="verdict-action">${chip}<span class="verdict-title">${esc(title)}</span></div>
      ${decision.reasoning ? `<div class="verdict-reason">${esc(decision.reasoning)}</div>` : ''}
      <div class="verdict-rows">
        ${vrow('Runway at decision', `${num(state.runwayDays)} days`)}
        ${vrow('Guardrail', esc(guardrail.status || 'allow') + (guardrail.clamped ? ' · clamped' : ''))}
        ${vrow('Execution', `${esc(execution.status || '—')} · ${tx}`)}
        ${vrow('Checked', time(event.recordedAt))}
      </div>
    `
  }

  function renderLatestVerdict() {
    if (latestEvents.length > 0 && latestStatus) {
      renderLatestIntoVerdict(latestEvents[latestEvents.length - 1])
    }
  }

  function renderEvents() {
    const tbody = $('eventsTableBody')
    const q = ($('eventSearch').value || '').toLowerCase()
    const modeFilter = $('eventModeFilter').value

    const filtered = [...latestEvents]
      .reverse()
      .filter(e => (modeFilter ? e.mode === modeFilter : true))
      .filter(e => {
        if (!q) return true
        const hay = `${e.decision?.action ?? ''} ${e.proposal?.action ?? ''} ${e.execution?.summary ?? ''} ${e.state?.source ?? ''}`.toLowerCase()
        return hay.includes(q)
      })

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No decisions match. Run a simulation or wait for the next scheduled check.</td></tr>'
      return
    }

    tbody.innerHTML = filtered.map(e => {
      const chip = e.guardrail?.status === 'allow'
        ? badge(e.guardrail.status, 'chip-ok')
        : e.guardrail?.status === 'approval_required'
        ? badge(e.guardrail.status, 'chip-warn')
        : badge(e.guardrail?.status ?? '—', 'chip')
      const src = e.state?.source === 'live' ? '' : ' · ' + (e.state?.source === 'scenario' ? 'scenario' : 'fixture')
      return `
        <tr>
          <td class="dim">${esc(time(e.recordedAt))}</td>
          <td>${badge(e.mode === 'live' ? 'live' : 'sim', e.mode === 'live' ? 'chip-accent' : 'chip')}${src ? `<span class="dim" style="font-size:11px">${esc(src)}</span>` : ''}</td>
          <td class="num">${esc(num(e.state?.runwayDays))} d</td>
          <td><code>${esc(e.proposal?.action ?? 'HOLD')}</code></td>
          <td>${chip}</td>
          <td class="dim">${esc(e.execution?.summary ?? '—')}</td>
        </tr>`
    }).join('')
  }

  $('eventSearch').addEventListener('input', renderEvents)
  $('eventModeFilter').addEventListener('change', renderEvents)

  function renderMemory(records) {
    const tbody = $('memoryTableBody')

    // derived insight — factual, from outcomes only
    const graded = records.filter(r => r.outcome)
    const ok = graded.filter(r => r.outcome.includes('SUCCESS') || r.outcome.includes('STABILIZED')).length
    const failed = graded.filter(r => r.outcome.includes('FAILED')).length
    const insight = $('memoryInsight')
    if (graded.length === 0) {
      insight.textContent = 'No outcomes evaluated yet. The agent grades each past decision against the next observation and adapts.'
    } else {
      const last = graded[graded.length - 1]
      insight.textContent =
        `${ok} of ${graded.length} graded decisions landed well` +
        (failed ? `, ${failed} backfired` : '') +
        `. Most recent: ${last.action} at ${num(last.runway_days_at_decision)}d runway → ${last.outcome}. The next prompt carries these outcomes so the agent adjusts.`
    }

    if (!records || records.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No memory records yet — decisions land here after the first check.</td></tr>'
      return
    }

    tbody.innerHTML = [...records].reverse().map(r => {
      const isSuccess = r.outcome?.includes('SUCCESS') || r.outcome?.includes('STABILIZED')
      const isFail = r.outcome?.includes('FAILED')
      const chip = !r.outcome
        ? badge('pending', 'chip')
        : isFail ? badge(r.outcome, 'chip-bad')
        : badge(r.outcome, 'chip-ok')
      return `
        <tr>
          <td class="dim">${esc(time(r.created_at))}</td>
          <td><code>${esc(r.agent_id)}</code></td>
          <td><strong>${esc(r.action)}</strong></td>
          <td class="num">${esc(num(r.runway_days_at_decision))} d</td>
          <td class="num">${r.amount_if_topup ? esc(r.amount_if_topup) + ' USDFC' : '—'}</td>
          <td>${chip}</td>
        </tr>`
    }).join('')
  }

  function renderRequests(requests) {
    const tbody = $('delegationTableBody')
    $('delPending').textContent = requests.filter(r => r.status === 'pending').length

    if (!requests || requests.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No funding requests. A child agent posts here when its runway drops below the action threshold.</td></tr>'
      return
    }

    tbody.innerHTML = [...requests].reverse().map(r => {
      const chip = r.status === 'approved'
        ? badge('approved', 'chip-ok')
        : r.status === 'rejected'
        ? badge('rejected', 'chip-bad')
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

  // initial load + polling
  refresh()
  setInterval(refresh, 5000)
})
