import { createRoot } from 'react-dom/client'
import campaign from './mixed-campaign.json'
import './styles.css'

const { gate, evidence } = campaign
const campaignLink = `?campaign=${encodeURIComponent(gate.campaign_id)}`
const selection = new URLSearchParams(window.location.search).get('campaign')

const reasonLabels: Record<string, string> = {
  ALL_REQUIRED_PASSED: 'Required execution passed',
  REQUIRED_FAILURE: 'Confirmed required failure',
  INSUFFICIENT_EVIDENCE: 'Insufficient evidence',
}

function CampaignList() {
  return (
    <section aria-labelledby="campaigns">
      <h1 id="campaigns">Campaigns</h1>
      <p className="lede">Inspect a campaign’s recorded release decision and the evidence behind it.</p>
      <a className="campaign-card" href={campaignLink}>
        <span>
          <strong>Mixed campaign</strong>
          <code>{gate.campaign_id}</code>
        </span>
        <span className="open-label" aria-hidden="true">Open campaign <span>↗</span></span>
      </a>
    </section>
  )
}

function CampaignDetail() {
  return (
    <>
      <a className="back" href="./">← All campaigns</a>
      <h1>Mixed campaign</h1>
      <p className="campaign-id"><code>{gate.campaign_id}</code><span>Synthetic fixture</span></p>

      <div className="decision">
        <div>
          <h2>Release decision</h2>
          <p className={`decision-value ${gate.decision.toLowerCase()}`}>{gate.decision}</p>
        </div>
        <dl>
          <div><dt>Evidence completeness</dt><dd>{campaign.completeness}</dd></div>
          <div><dt>Policy version</dt><dd><code>{gate.policy_version}</code></dd></div>
        </dl>
      </div>

      <section className="panel" aria-labelledby="reasons">
        <h2 id="reasons">Decision reasons</h2>
        <ul className="reason-list">
          {gate.reasons.map(reason => (
            <li key={`${reason.execution_id}:${reason.code}`}>
              <div className="reason-main">
                <span className={`reason-marker ${reason.code.toLowerCase()}`} aria-hidden="true" />
                <div>
                  <h3>{reasonLabels[reason.code]}</h3>
                  <p>Execution <code>{reason.execution_id}</code></p>
                </div>
              </div>
              <div className="reason-evidence">
                <code>{reason.code}</code>
                <p>
                  {reason.artifact_ids.length === 0
                    ? 'No evidence artifact available'
                    : reason.artifact_ids.map(id => (
                        <a key={id} href={`#evidence-${id}`}>Evidence <code>{id}</code></a>
                      ))}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <div className="support">
        <section className="panel" aria-labelledby="evidence">
          <h2 id="evidence">Evidence</h2>
          <ul className="artifact-list">
            {evidence.map(item => (
              <li key={item.id} id={`evidence-${item.id}`} tabIndex={-1}>
                <code>{item.id}</code> <span>{item.kind === 'execution-report' ? 'Execution report' : item.kind}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="panel availability" aria-labelledby="analysis">
          <h2 id="analysis">Investigation and evaluation</h2>
          <p>No investigation or evaluation record is available for this fixture.</p>
        </section>
      </div>
    </>
  )
}

function App() {
  return (
    <>
      <header className="topbar">
        <div className="shell topbar-inner">
          <a className="brand" href="./"><span className="brand-mark" aria-hidden="true">Q</span> QualityOps AI</a>
          <span>Release review</span>
        </div>
      </header>
      <main className="shell">
        {selection === null ? <CampaignList /> : selection === gate.campaign_id ? <CampaignDetail /> : (
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
