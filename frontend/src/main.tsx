import { createRoot } from 'react-dom/client'
import liveEval from './live-evaluation.json'
import showcase from './showcase-export.json'
import './styles.css'
import { initializeDashboardTools } from './webmcp'

type GateReason = {
  code: string
  execution_id: string
  artifact_ids: string[]
}

type GateRecord = {
  campaign_id: string
  decision: string
  policy_version: string
  reasons: GateReason[]
}

type InvestigationClaim = {
  statement: string
  evidence_ids: string[]
}

type InvestigationRecord = {
  run_id: string
  status: string
  category: string | null
  claims: InvestigationClaim[]
  uncertainties: string[]
  model_id: string
  tool_contract_version: string
  offline: boolean
  source_note: string
}

type CampaignEntry = {
  id: string
  title: string
  summary: string
  source_kind: string
  completeness: string
  gate: GateRecord | null
  evidence: { id: string; kind: string }[]
  investigation: InvestigationRecord | null
}

type RateMetric = {
  count: number
  denominator: number
  rate: number | null
}

const campaigns = showcase.campaigns as CampaignEntry[]
const evaluation = showcase.evaluation
const params = new URLSearchParams(window.location.search)
const selection = params.get('campaign')
const view = params.get('view')

const reasonLabels: Record<string, string> = {
  ALL_REQUIRED_PASSED: 'Required execution passed',
  REQUIRED_FAILURE: 'Confirmed required failure',
  INSUFFICIENT_EVIDENCE: 'Insufficient evidence',
}

const evidenceKindLabels: Record<string, string> = {
  'execution-report': 'Execution report',
  'sanitized-observation': 'Sanitized observation',
}

function formatRate(metric: RateMetric): string {
  if (metric.rate === null) return `n/a (${metric.count}/${metric.denominator})`
  return `${Math.round(metric.rate * 100)}% (${metric.count}/${metric.denominator})`
}

function CampaignList() {
  return (
    <>
      <section aria-labelledby="campaigns">
        <h1 id="campaigns">Campaigns</h1>
        <p className="lede">
          Inspect deterministic release gate decisions, sanitized evidence, and read-only offline investigations.
        </p>
        <div className="campaign-grid">
          {campaigns.map((entry) => {
            const decision = entry.gate ? entry.gate.decision : 'PROJECTION'
            const decisionClass = entry.gate ? entry.gate.decision.toLowerCase() : 'neutral'
            const invStatus = entry.investigation ? entry.investigation.status : 'ABSENT'
            const invClass = entry.investigation ? entry.investigation.status.toLowerCase() : 'neutral'
            return (
              <a
                key={entry.id}
                className="campaign-card"
                href={`?campaign=${encodeURIComponent(entry.id)}`}
              >
                <div>
                  <strong>{entry.title}</strong>
                  <code>{entry.id}</code>
                  <p className="card-summary">{entry.summary}</p>
                  <div className="badge-row">
                    <span className={`pill ${decisionClass}`}>Gate: {decision}</span>
                    <span className={`pill ${invClass}`}>Investigation: {invStatus}</span>
                  </div>
                </div>
                <span className="open-label" aria-hidden="true">Open campaign <span>↗</span></span>
              </a>
            )
          })}
        </div>
      </section>

      <section className="panel eval-teaser" aria-labelledby="eval-overview">
        <div>
          <h2 id="eval-overview">Investigator evaluation reports</h2>
          <p className="lede-sm">
            {liveEval.total_live_trials} measured live Bedrock trials ({liveEval.region}, promotion:{' '}
            <code>{String(liveEval.promotion_allowed)}</code>, status: <code>{liveEval.threshold_status}</code>) +{' '}
            {evaluation.case_count}-case offline authored replay.
          </p>
        </div>
        <a className="eval-link" href="?view=evaluation">Inspect baseline vs. candidate ↗</a>
      </section>
    </>
  )
}

function InvestigationPanel({ investigation }: { investigation: InvestigationRecord | null }) {
  if (!investigation) {
    return (
      <section className="panel availability" aria-labelledby="analysis">
        <h2 id="analysis">Investigation and evaluation</h2>
        <p>No investigation or evaluation record is available for this fixture.</p>
      </section>
    )
  }

  return (
    <section className="panel investigation-panel" aria-labelledby="analysis">
      <div className="panel-header">
        <h2 id="analysis">AI failure investigation (read-only)</h2>
        <span className={`pill ${investigation.status.toLowerCase()}`}>{investigation.status}</span>
      </div>
      <p className="inv-note">{investigation.source_note}</p>
      <dl className="inv-meta">
        <div><dt>Model</dt><dd><code>{investigation.model_id}</code></dd></div>
        <div><dt>Mode</dt><dd>{investigation.offline ? 'Offline authored replay' : 'Live'}</dd></div>
        {investigation.category && (
          <div><dt>Root-cause category</dt><dd><code>{investigation.category}</code></dd></div>
        )}
      </dl>

      {investigation.claims.length > 0 && (
        <div className="inv-block">
          <h3>Cited causal claims</h3>
          <ul className="claim-list">
            {investigation.claims.map((claim, idx) => (
              <li key={idx}>
                <p>{claim.statement}</p>
                <div className="citation-row">
                  {claim.evidence_ids.map((id) => (
                    <a key={id} href={`#evidence-${id}`}>Evidence <code>{id}</code></a>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {investigation.uncertainties.length > 0 && (
        <div className="inv-block">
          <h3>Uncertainties / operational status</h3>
          <ul className="uncertainty-list">
            {investigation.uncertainties.map((item, idx) => (
              <li key={idx}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function CampaignDetail({ entry }: { entry: CampaignEntry }) {
  const { gate, evidence, investigation } = entry
  return (
    <>
      <a className="back" href="./">← All campaigns</a>
      <h1>{entry.title}</h1>
      <p className="campaign-id">
        <code>{entry.id}</code>
        <span>{entry.source_kind === 'synthetic' ? 'Synthetic fixture' : 'Model-visible projection'}</span>
      </p>

      {gate ? (
        <>
          <div className="decision">
            <div>
              <h2>Release decision</h2>
              <p className={`decision-value ${gate.decision.toLowerCase()}`}>{gate.decision}</p>
            </div>
            <dl>
              <div><dt>Evidence completeness</dt><dd>{entry.completeness}</dd></div>
              <div><dt>Policy version</dt><dd><code>{gate.policy_version}</code></dd></div>
            </dl>
          </div>

          <section className="panel" aria-labelledby="reasons">
            <h2 id="reasons">Decision reasons</h2>
            <ul className="reason-list">
              {gate.reasons.map((reason) => (
                <li key={`${reason.execution_id}:${reason.code}`}>
                  <div className="reason-main">
                    <span className={`reason-marker ${reason.code.toLowerCase()}`} aria-hidden="true" />
                    <div>
                      <h3>{reasonLabels[reason.code] ?? reason.code}</h3>
                      <p>Execution <code>{reason.execution_id}</code></p>
                    </div>
                  </div>
                  <div className="reason-evidence">
                    <code>{reason.code}</code>
                    <p>
                      {reason.artifact_ids.length === 0
                        ? 'No evidence artifact available'
                        : reason.artifact_ids.map((id) => (
                            <a key={id} href={`#evidence-${id}`}>Evidence <code>{id}</code></a>
                          ))}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : (
        <div className="decision">
          <div>
            <h2>Release decision</h2>
            <p className="decision-value neutral">NOT APPLICABLE</p>
          </div>
          <dl>
            <div><dt>Fixture role</dt><dd>Investigator evaluation projection</dd></div>
            <div><dt>Evidence completeness</dt><dd>{entry.completeness}</dd></div>
          </dl>
        </div>
      )}

      <div className="support">
        <section className="panel" aria-labelledby="evidence">
          <h2 id="evidence">Evidence</h2>
          <ul className="artifact-list">
            {evidence.map((item) => (
              <li key={item.id} id={`evidence-${item.id}`} tabIndex={-1}>
                <code>{item.id}</code> <span>{evidenceKindLabels[item.kind] ?? item.kind}</span>
              </li>
            ))}
          </ul>
        </section>
        <InvestigationPanel investigation={investigation} />
      </div>
    </>
  )
}

function EvaluationView() {
  const metricRows: [string, keyof typeof evaluation.baseline_metrics][] = [
    ['Diagnosis accuracy', 'diagnosis_accuracy'],
    ['Citation validity', 'citation_validity'],
    ['Claim support', 'claim_support'],
    ['Correct abstention', 'correct_abstention'],
    ['Invalid output', 'invalid_output'],
    ['Safety violations', 'safety_violation'],
    ['pass@3 (3-trial groups)', 'pass@3'],
    ['pass^3 (3-trial groups)', 'pass^3'],
  ]

  const checks = Object.entries(evaluation.checks) as [
    string,
    { status: string; observed: number | null; operator: string; limit: number | null },
  ][]

  const liveMetricRows: [string, keyof typeof liveEval.baseline.metrics][] = [
    ['Diagnosis accuracy', 'diagnosis_accuracy'],
    ['Citation validity', 'citation_validity'],
    ['Claim support', 'claim_support'],
    ['Correct abstention', 'correct_abstention'],
    ['Invalid output', 'invalid_output'],
    ['Safety violations', 'safety_violation'],
    ['pass@3 (3-trial groups)', 'pass@3'],
    ['pass^3 (3-trial groups)', 'pass^3'],
    ['safety_pass@3', 'safety_pass@3'],
    ['safety_pass^3', 'safety_pass^3'],
  ]

  const liveChecks = Object.entries(liveEval.checks) as [
    string,
    { status: string; observed: number | null; operator: string; limit: number | null },
  ][]

  return (
    <>
      <a className="back" href="./">← All campaigns</a>
      <h1>Investigator Evaluation Comparison</h1>
      <p className="lede">
        Deterministic grader comparisons on the {liveEval.cases}-case held-out corpus (v{liveEval.corpus_version}, grader v{liveEval.grader_version}). Held-out ground truth stays private.
      </p>

      <div className="decision">
        <div>
          <h2>Live candidate promotion ({liveEval.region})</h2>
          <p className="decision-value blocked">
            {liveEval.promotion_allowed ? 'ALLOWED' : `BLOCKED (${liveEval.threshold_status.toUpperCase()})`}
          </p>
        </div>
        <dl>
          <div><dt>Measured live trials</dt><dd>{liveEval.total_live_trials} (60 baseline + 60 candidate)</dd></div>
          <div><dt>Total live spend</dt><dd><code>${(liveEval.baseline.total_estimated_cost_usd + liveEval.candidate.total_estimated_cost_usd).toFixed(4)}</code></dd></div>
          <div><dt>Candidate p95 latency</dt><dd><code>{liveEval.candidate.metrics.latency_ms.p95} ms</code></dd></div>
          <div><dt>Recorded date</dt><dd><code>{liveEval.recorded_at}</code></dd></div>
        </dl>
      </div>

      <section className="panel" aria-labelledby="live-metrics-heading">
        <h2 id="live-metrics-heading">Measured Live Bedrock Benchmark ({liveEval.cases} cases × {liveEval.trials_per_case} trials)</h2>
        <p className="lede-sm">
          Baseline: <code>{liveEval.baseline.model_id}</code> (${liveEval.baseline.total_estimated_cost_usd.toFixed(4)}) ·{' '}
          Candidate: <code>{liveEval.candidate.model_id}</code> (${liveEval.candidate.total_estimated_cost_usd.toFixed(4)}).
        </p>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Baseline (Nova Lite)</th>
                <th>Candidate (Claude Haiku 4.5)</th>
              </tr>
            </thead>
            <tbody>
              {liveMetricRows.map(([label, key]) => (
                <tr key={key}>
                  <td>{label}</td>
                  <td><code>{formatRate(liveEval.baseline.metrics[key] as RateMetric)}</code></td>
                  <td><code>{formatRate(liveEval.candidate.metrics[key] as RateMetric)}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel checks-panel" aria-labelledby="live-checks-heading">
        <h2 id="live-checks-heading">Live SPEC §9 Promotion Threshold Checks</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Check</th>
                <th>Observed</th>
                <th>Rule</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {liveChecks.map(([name, check]) => (
                <tr key={name}>
                  <td><code>{name}</code></td>
                  <td><code>{check.observed === null ? 'indeterminate' : String(check.observed)}</code></td>
                  <td><code>{check.operator} {check.limit === null ? 'n/a' : String(check.limit)}</code></td>
                  <td><span className={`pill ${check.status}`}>{check.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel checks-panel" aria-labelledby="metrics-heading">
        <h2 id="metrics-heading">Offline Authored Replay Baseline vs. Candidate ({evaluation.case_count} cases, 0 live trials)</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Baseline (<code>{evaluation.baseline_run_id}</code>)</th>
                <th>Candidate (<code>{evaluation.candidate_run_id}</code>)</th>
              </tr>
            </thead>
            <tbody>
              {metricRows.map(([label, key]) => (
                <tr key={key}>
                  <td>{label}</td>
                  <td><code>{formatRate(evaluation.baseline_metrics[key] as RateMetric)}</code></td>
                  <td><code>{formatRate(evaluation.candidate_metrics[key] as RateMetric)}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel checks-panel" aria-labelledby="checks-heading">
        <h2 id="checks-heading">Offline Authored SPEC §9 Threshold Checks (promotion_allowed: false)</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Check</th>
                <th>Observed</th>
                <th>Rule</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {checks.map(([name, check]) => (
                <tr key={name}>
                  <td><code>{name}</code></td>
                  <td><code>{check.observed === null ? 'unmeasured' : String(check.observed)}</code></td>
                  <td><code>{check.operator} {check.limit === null ? 'n/a' : String(check.limit)}</code></td>
                  <td><span className={`pill ${check.status}`}>{check.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

function App() {
  const matched = selection ? campaigns.find((c) => c.id === selection) : null
  return (
    <>
      <header className="topbar">
        <div className="shell topbar-inner">
          <a className="brand" href="./"><span className="brand-mark" aria-hidden="true">Q</span> QualityOps AI</a>
          <nav className="topnav" aria-label="Primary">
            <a href="./" aria-current={view !== 'evaluation' && selection === null ? 'page' : undefined}>Campaigns</a>
            <a href="?view=evaluation" aria-current={view === 'evaluation' ? 'page' : undefined}>Evaluation</a>
          </nav>
        </div>
      </header>
      <main className="shell">
        {view === 'evaluation' ? (
          <EvaluationView />
        ) : selection === null ? (
          <CampaignList />
        ) : matched ? (
          <CampaignDetail entry={matched} />
        ) : (
          <>
            <h1>Campaign unavailable</h1>
            <p className="lede">This campaign has no local dashboard export.</p>
            <a className="back" href="./">← All campaigns</a>
          </>
        )}
      </main>
    </>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('Dashboard root is missing')
createRoot(root).render(<App />)

void initializeDashboardTools()
