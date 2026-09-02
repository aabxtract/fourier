// ============================================================
// Fourier Operational Dashboard Application Logic
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  // Navigation Tabs
  const tabBtns = document.querySelectorAll('.tab-btn')
  const tabPanes = document.querySelectorAll('.tab-pane')

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'))
      tabPanes.forEach(p => p.classList.remove('active'))

      btn.classList.add('active')
      const targetId = `tab-${btn.dataset.tab}`
      document.getElementById(targetId)?.classList.add('active')
    })
  })

  // State Fetching & UI Rendering
  async function refreshDashboard() {
    try {
      // 1. Fetch Status
      const statusRes = await fetch('/api/status')
      if (statusRes.ok) {
        const data = await statusRes.json()
        renderStatus(data)
      }

      // 2. Fetch Events
      const eventsRes = await fetch('/api/events?limit=20')
      if (eventsRes.ok) {
        const events = await eventsRes.json()
        renderEvents(events)
      }

      // 3. Fetch Memory
      const memRes = await fetch('/api/memory')
      if (memRes.ok) {
        const memory = await memRes.json()
        renderMemory(memory)
      }

      // 4. Fetch Delegation Requests
      const reqRes = await fetch('/api/requests')
      if (reqRes.ok) {
        const requests = await reqRes.json()
        renderRequests(requests)
      }
    } catch (err) {
      console.error('Failed to refresh dashboard telemetry:', err)
    }
  }

  // HTML-escape any store-derived string before it enters the DOM
  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function dotClass(state) {
    return state === 'healthy' || state === 'configured' ? 'dot-green' : 'dot-red'
  }

  function renderHealth(health) {
    const grid = document.getElementById('subsystemsGrid')
    if (!grid || !health) return

    const sourceLabel = health.lastEventSource === 'live'
      ? 'Live (Synapse SDK)'
      : health.lastEventSource === 'scenario'
      ? 'Scenario fixture'
      : 'Demo fixture (no wallet configured)'

    const items = [
      { label: 'Watcher / Filecoin Read', state: health.watcher, detail: health.lastEventAt ? `Last event ${new Date(health.lastEventAt).toLocaleTimeString()}` : 'No events yet' },
      { label: 'Data Source', state: health.lastEventSource === 'live' ? 'healthy' : 'stale', detail: sourceLabel },
      { label: 'AI Provider', state: 'healthy', detail: String(health.aiProvider || '--').toUpperCase() },
      { label: 'Guardrails', state: 'healthy', detail: health.guardrails === 'active' ? 'Armed' : health.guardrails },
      { label: 'Telegram', state: health.channels?.telegram === 'configured' ? 'configured' : 'not configured', detail: health.channels?.telegram === 'configured' ? 'Configured' : 'Not configured' },
      { label: 'Discord', state: health.channels?.discord === 'configured' ? 'configured' : 'not configured', detail: health.channels?.discord === 'configured' ? 'Webhook configured' : 'Not configured' },
      { label: 'Event Sync', state: 'healthy', detail: health.sync?.mode === 'remote-mirror' ? `Remote mirror (${health.sync.pending} pending)` : 'Local-only (self-hosted)' },
      { label: 'Delegation', state: 'healthy', detail: `${health.delegation?.role || 'standalone'} · ${health.delegation?.coordination || 'local'} · ${health.delegation?.pendingRequests ?? 0} pending` }
    ]

    grid.innerHTML = items.map(item => `
      <div class="subsystem-item"><span class="${dotClass(item.state)}"></span> <strong>${esc(item.label)}:</strong> ${esc(item.detail)}</div>
    `).join('')
  }

  function renderStatus(data) {
    const { config, policy, latestEvent, health } = data

    document.getElementById('netLabel').textContent = config.network === 'calibration' ? 'Calibration' : 'Mainnet'
    document.getElementById('roleLabel').textContent = config.role ? config.role.toUpperCase() : 'STANDALONE'
    document.getElementById('providerLabel').textContent = config.model.provider.toUpperCase()
    document.getElementById('delRole').textContent = config.role.toUpperCase()
    document.getElementById('delTreasury').textContent = config.treasuryAgentId || 'treasury-main'

    if (latestEvent) {
      const state = latestEvent.state
      document.getElementById('metricRunway').textContent = state.runwayDays.toFixed(1)
      document.getElementById('metricAvailable').textContent = state.availableUSDFC.toFixed(2)
      document.getElementById('metricLocked').textContent = state.lockedUSDFC.toFixed(2)

      const rate = state.spendRateUSDFCPerDay !== null ? state.spendRateUSDFCPerDay.toFixed(2) : '--'
      document.getElementById('metricSpendRate').textContent = rate

      // Runway status
      const runwayBadge = document.getElementById('runwayStatusBadge')
      const runwayBar = document.getElementById('runwayBarFill')
      if (state.runwayDays <= policy.actionRunwayDays) {
        runwayBadge.textContent = 'CRITICAL'
        runwayBadge.className = 'metric-sub badge-danger'
        runwayBar.style.width = '20%'
      } else if (state.runwayDays <= policy.warningRunwayDays) {
        runwayBadge.textContent = 'WARNING'
        runwayBadge.className = 'metric-sub badge-warning'
        runwayBar.style.width = '45%'
      } else {
        runwayBadge.textContent = 'HEALTHY'
        runwayBadge.className = 'metric-sub'
        runwayBar.style.width = '85%'
      }

      // Latest decision diff
      document.getElementById('latestActionBadge').textContent = latestEvent.decision.action
      document.getElementById('diffProposal').textContent = JSON.stringify(latestEvent.proposal, null, 2)
      document.getElementById('diffExecution').textContent = JSON.stringify(latestEvent.execution, null, 2)
      document.getElementById('lastObservedTime').textContent = `Last check: ${new Date(latestEvent.recordedAt).toLocaleTimeString()} · ${latestEvent.state?.source === 'live' ? 'live' : latestEvent.state?.source === 'scenario' ? 'scenario' : 'demo fixture'}`
    }

    // Render honest subsystem health + policy-derived invariants
    renderHealth(health)
    const invClamp = document.getElementById('invTopUpClamp')
    if (invClamp) invClamp.textContent = policy.topUpEnabled ? `Active (${policy.maxAutoTopUpUSDFC} USDFC max)` : 'Disabled'
  }

  function renderEvents(events) {
    const tbody = document.getElementById('eventsTableBody')
    if (!events || events.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);">No audit events recorded yet.</td></tr>'
      return
    }

    tbody.innerHTML = events.map(e => `
      <tr>
        <td>${esc(new Date(e.recordedAt).toLocaleTimeString())}</td>
        <td><span class="badge ${e.mode === 'live' ? 'badge-success' : 'badge-sim'}">${esc((e.mode || '').toUpperCase())}</span></td>
        <td><strong>${esc(e.state?.runwayDays?.toFixed(1) ?? '--')}d</strong></td>
        <td>${esc(e.state?.availableUSDFC?.toFixed(2) ?? '--')} USDFC</td>
        <td><code>${esc(e.proposal?.action ?? 'HOLD')}</code></td>
        <td><span class="badge ${e.guardrail?.status === 'allow' ? 'badge-success' : e.guardrail?.status === 'approval_required' ? 'badge-warning' : 'badge-outline'}">${esc(e.guardrail?.status ?? 'allow')}</span></td>
        <td><span style="font-size:0.8rem;">${esc(e.execution?.summary ?? 'No action')}</span></td>
      </tr>
    `).join('')

    // Render trend chart bars
    const chartBars = document.getElementById('overviewChartBars')
    if (chartBars && events.length > 0) {
      const recentEvents = [...events].reverse().slice(-7)
      chartBars.innerHTML = recentEvents.map((e, idx) => {
        const heightPct = Math.min(100, Math.max(15, (e.state?.runwayDays || 5) * 10))
        return `
          <div class="chart-bar-group">
            <div class="chart-bar" style="height: ${heightPct}%;" title="${e.state?.runwayDays?.toFixed(1)} days"></div>
            <span class="chart-label">C${idx + 1}</span>
          </div>
        `
      }).join('')
    }
  }

  function renderMemory(records) {
    const tbody = document.getElementById('memoryTableBody')
    if (!records || records.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);">No memory records stored yet.</td></tr>'
      return
    }

    tbody.innerHTML = records.map(r => {
      const isSuccess = r.outcome?.includes('SUCCESS')
      const isFail = r.outcome?.includes('FAILED')
      const badgeClass = isSuccess ? 'badge-success' : isFail ? 'badge-danger' : 'badge-outline'
      return `
        <tr>
          <td>${esc(new Date(r.created_at).toLocaleTimeString())}</td>
          <td><code>${esc(r.agent_id)}</code></td>
          <td><span class="badge ${r.action === 'TOP_UP' ? 'badge-success' : 'badge-outline'}">${esc(r.action)}</span></td>
          <td><strong>${esc(r.runway_days_at_decision?.toFixed(1) ?? '--')} days</strong></td>
          <td>${r.amount_if_topup ? `${esc(r.amount_if_topup)} USDFC` : '--'}</td>
          <td><span class="badge ${badgeClass}">${esc(r.outcome || 'PENDING EVALUATION')}</span></td>
        </tr>
      `
    }).join('')
  }

  function renderRequests(requests) {
    const tbody = document.getElementById('delegationTableBody')
    document.getElementById('delPendingCount').textContent = requests.filter(r => r.status === 'pending').length

    if (!requests || requests.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);">No delegation requests in queue.</td></tr>'
      return
    }

    tbody.innerHTML = requests.map(r => `
      <tr>
        <td><code>${esc(r.id)}</code></td>
        <td>${esc(r.requesting_agent_id)}</td>
        <td>${esc(r.treasury_agent_id)}</td>
        <td><strong>${esc(r.amount_requested)} USDFC</strong></td>
        <td>${esc(r.reason)}</td>
        <td><span class="badge ${r.status === 'approved' ? 'badge-success' : r.status === 'rejected' ? 'badge-danger' : 'badge-warning'}">${esc((r.status || '').toUpperCase())}</span></td>
        <td><code style="font-size:0.75rem;">${esc(r.tx_hash ? r.tx_hash.slice(0, 16) + '...' : '--')}</code></td>
      </tr>
    `).join('')
  }

  // --- Simulation Triggers ---
  async function runSim(payload) {
    const outputEl = document.getElementById('simRawOutput')
    outputEl.textContent = 'Running simulation through policy and deterministic guardrails...'

    try {
      const res = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const data = await res.json()

      document.getElementById('simObservedRunway').textContent = `${data.state?.runwayDays?.toFixed(1) ?? '--'} days`
      document.getElementById('simProposedAction').textContent = data.proposal?.action ?? data.decision?.action ?? 'HOLD'
      document.getElementById('simClampedVal').textContent = data.guardrail?.clamped ? 'CLAMPED TO 5.0' : 'WITHIN LIMITS'
      document.getElementById('simProjectedRunway').textContent = data.execution?.estimatedNewRunwayDays ? `~${data.execution.estimatedNewRunwayDays} days` : 'Maintained'

      outputEl.textContent = JSON.stringify(data, null, 2)
      refreshDashboard()
    } catch (err) {
      outputEl.textContent = `Simulation Error: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  document.getElementById('btnSimBurnSpike')?.addEventListener('click', () => {
    document.getElementById('scenarioExplainer').innerHTML = `
      <strong>Burn-Spike Story:</strong> Naive point-in-time calculation shows 9.8 days, but accelerating spend projects 2.1 days. Model proposes 7.5 USDFC; Guardrails clamp to 5.0 USDFC.
    `
    runSim({ scenario: 'burn-spike' })
  })

  document.getElementById('btnSimBudgetSqueeze')?.addEventListener('click', () => {
    document.getElementById('scenarioExplainer').innerHTML = `
      <strong>Budget-Squeeze Story:</strong> Low funds (0.7 USDFC) triggers dataset prioritization. Non-essential datasets ranked for TRIAGE; gated behind single-use approval token.
    `
    runSim({ scenario: 'budget-squeeze' })
  })

  document.getElementById('btnSimLiveOnchain')?.addEventListener('click', () => {
    document.getElementById('scenarioExplainer').innerHTML = `
      <strong>Live Onchain Zero-Tx Read:</strong> Reads live onchain state via Synapse SDK. Proposes and validates actions without dispatching any onchain transactions.
    `
    runSim({})
  })

  // Slider label
  const slider = document.getElementById('replayDaysSlider')
  slider?.addEventListener('input', e => {
    document.getElementById('replayDaysLabel').textContent = e.target.value
  })

  document.getElementById('btnSimReplay')?.addEventListener('click', () => {
    const days = parseInt(slider.value, 10)
    runSim({ replayDays: days })
  })

  // Policy Compiler
  document.getElementById('btnCompilePolicy')?.addEventListener('click', async () => {
    const text = document.getElementById('policyInputText').value
    const outputEl = document.getElementById('compiledPolicyOutput')
    outputEl.textContent = 'Compiling...'

    try {
      const res = await fetch('/api/policy/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      })
      const compiled = await res.json()
      outputEl.textContent = JSON.stringify(compiled, null, 2)
    } catch (err) {
      outputEl.textContent = `Compilation Error: ${err.message}`
    }
  })

  // Refresh Button
  document.getElementById('refreshBtn')?.addEventListener('click', refreshDashboard)

  // Initial Load & Polling every 5s
  refreshDashboard()
  setInterval(refreshDashboard, 5000)
})
