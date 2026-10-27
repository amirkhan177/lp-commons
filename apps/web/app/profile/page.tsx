import Link from "next/link";
import Shell, { Flash, PageHead } from "../ui/shell";
import { Icon } from "../ui/icons";
import { confirm, draft, removeKey, saveKey, setModel } from "./actions";
import { db, WORKSPACE_ID } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getProfile } from "@/lib/thesis/fit-run";
import { DEFAULT_MODEL, listModels } from "@/lib/thesis/openrouter";
import { GEOGRAPHIES, LP_TYPES, SECTORS, STAGES } from "@/lib/thesis/taxonomy";
import { ConfirmButton, SubmitButton } from "../ui/forms";

const usd = (n: number | null) => (n == null ? "" : n >= 1e6 ? `${+(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}K` : String(n));

function Chips({ name, options, selected }: { name: string; options: readonly { id: string; label: string }[]; selected: string[] }) {
  return (
    <div className="chips">
      {options.map((o) => (
        <label key={o.id} className="chip-opt">
          <input type="checkbox" name={name} value={o.id} defaultChecked={selected.includes(o.id)} />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requireSession();
  const { ok, error } = await searchParams;
  const pool = db();
  const p = await getProfile();
  const keyRow = (await pool.query<{ scopes: string }>(
    "SELECT scopes FROM integrations WHERE workspace_id = $1 AND provider = 'openrouter'", [WORKSPACE_ID])).rows[0];
  const models = await listModels();
  // Your own fund in the Form D data, to prefill size/vintage and exclude it from matches.
  const ownCandidates = p?.fund_name
    ? (await pool.query<{ entity_id: number; name: string; vintage: number | null }>(
        `SELECT fp.entity_id, fp.name, fp.vintage FROM fund_profiles fp JOIN entities e ON e.id = fp.entity_id
         WHERE e.name_normalized % lower($1) ORDER BY similarity(e.name_normalized, lower($1)) DESC LIMIT 5`,
        [p.fund_name])).rows
    : [];

  return (
    <Shell>
      <PageHead
        title="Fund profile"
        sub="Your thesis decides which funds of funds and peer funds rank first. Draft it from your website or deck, then check every field: matching uses what you confirm, not the raw draft."
        actions={p?.confirmed_at ? <Link className="btn secondary" href="/matches">See matches <Icon name="arrow" size={16} /></Link> : undefined}
      />
      <Flash ok={ok} error={error} />

      <div className="grid-2">
        <section className="card stack">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>1. AI model <span className="muted" style={{ fontWeight: 500, fontSize: 14 }}>(optional)</span></h2>
            {keyRow ? <span className="badge ok"><Icon name="check" size={14} />Key saved</span> : <span className="badge neutral">No key</span>}
          </div>
          <p className="muted small">
            Bring your own <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">OpenRouter key</a> to use any
            model (Claude, GPT, Gemini, Llama…). It drafts your profile and explains the top 50 matches; you pay OpenRouter
            directly. The key is encrypted at rest and never shown again. Only your profile and public fund data go to the
            model, never your contacts. If your model can&apos;t be served, the free NVIDIA Nemotron 3 Nano Omni is tried once.
          </p>
          {keyRow ? (
            <>
              <form action={setModel} className="key-row">
                <label className="field"><span>Model</span>
                  <input type="text" name="model" list="or-models" defaultValue={keyRow.scopes || DEFAULT_MODEL} />
                </label>
                <SubmitButton className="secondary" pending="Saving…">Change model</SubmitButton>
              </form>
              <ConfirmButton action={removeKey} label="Remove key" className="danger sm" icon="trash" title="Remove your OpenRouter key?" confirmLabel="Remove key" pendingLabel="Removing…">
                <p>The encrypted key is deleted from this server. Drafts fall back to keyword detection and matches keep rule-based scores until you add a key again.</p>
              </ConfirmButton>
            </>
          ) : (
            <form action={saveKey} className="stack">
              <label className="field"><span>OpenRouter API key</span>
                <input type="password" name="key" placeholder="sk-or-…" autoComplete="off" required />
              </label>
              <div className="key-row">
                <label className="field"><span>Model</span><input type="text" name="model" list="or-models" defaultValue={DEFAULT_MODEL} /></label>
                <SubmitButton icon="key" pending="Verifying with OpenRouter…">Save &amp; verify</SubmitButton>
              </div>
            </form>
          )}
          <datalist id="or-models">{models.slice(0, 400).map((m) => <option key={m} value={m} />)}</datalist>
        </section>

        <section className="card stack">
          <h2>2. Draft from your website or deck</h2>
          <p className="muted small">
            We read your homepage plus up to three About, Thesis or Team pages. The deck is read for this draft only and
            not stored. AI drafts can take up to a minute.
          </p>
          <form action={draft} className="stack">
            <label className="field"><span>Website</span>
              <input type="text" name="website" placeholder="yourfund.vc" defaultValue={p?.website ?? ""} />
            </label>
            <label className="field"><span>Pitch deck <span className="hint">PDF, optional, up to 15 MB</span></span>
              <input type="file" name="deck" accept="application/pdf,.pdf" />
            </label>
            <SubmitButton icon="sparkle" pending={keyRow ? "Reading your site and drafting… (up to a minute)" : "Reading your site…"}>{keyRow ? "Draft with AI" : "Detect from text"}</SubmitButton>
          </form>
        </section>
      </div>

      <section className="card section">
        <div className="card-head">
          <div>
            <h2>3. Review &amp; confirm</h2>
            <p>Check each field. Confirming re-scores every fund against this profile.</p>
          </div>
          {p?.confirmed_at ? <span className="badge ok"><Icon name="check" size={14} />Confirmed</span>
            : p ? <span className="badge warn">Draft{p.draft_source === "llm" ? " · AI" : p.draft_source === "keywords" ? " · keywords" : ""}</span> : null}
        </div>
        <form action={confirm} className="profile-form">
          <input type="hidden" name="website" value={p?.website ?? ""} />
          <label className="field"><span>Fund name</span><input type="text" name="fund_name" defaultValue={p?.fund_name ?? ""} required /></label>
          <label className="field"><span>Fund number</span><input type="number" name="fund_number" min={1} max={20} placeholder="e.g. 2 for Fund II" defaultValue={p?.fund_number ?? ""} /></label>
          <label className="field wide"><span>Thesis <span className="hint">2–3 sentences</span></span>
            <textarea name="summary" rows={3} defaultValue={p?.summary ?? ""} />
          </label>
          <fieldset className="wide"><legend>Sectors</legend><Chips name="sectors" options={SECTORS} selected={p?.sectors ?? []} /></fieldset>
          <fieldset><legend>Stage</legend><Chips name="stages" options={STAGES} selected={p?.stages ?? []} /></fieldset>
          <fieldset><legend>Geography</legend><Chips name="geographies" options={GEOGRAPHIES} selected={p?.geographies ?? []} /></fieldset>
          <label className="field"><span>Target fund size</span><input type="text" name="target_size" placeholder="e.g. 40M" defaultValue={usd(p?.target_size ?? null)} /></label>
          <div className="grid-2" style={{ gap: 12 }}>
            <label className="field"><span>Check from</span><input type="text" name="check_min" placeholder="e.g. 500K" defaultValue={usd(p?.check_min ?? null)} /></label>
            <label className="field"><span>Check to</span><input type="text" name="check_max" placeholder="e.g. 2M" defaultValue={usd(p?.check_max ?? null)} /></label>
          </div>
          <fieldset className="wide"><legend>LPs you want to reach</legend><Chips name="lp_types" options={LP_TYPES} selected={p?.lp_types ?? ["fof", "family_office", "hnw"]} /></fieldset>
          <label className="field wide"><span>Themes <span className="hint">comma-separated</span></span><input type="text" name="keywords" defaultValue={(p?.keywords ?? []).join(", ")} /></label>
          {ownCandidates.length > 0 && (
            <label className="field wide"><span>Is one of these your fund&apos;s Form D filing? <span className="hint">It&apos;s left out of your matches</span></span>
              <select name="own_entity_id" defaultValue={p?.own_entity_id ? String(p.own_entity_id) : ""}>
                <option value="">None of these</option>
                {ownCandidates.map((c) => <option key={c.entity_id} value={c.entity_id}>{c.name}{c.vintage ? ` · ${c.vintage}` : ""}</option>)}
              </select>
            </label>
          )}
          <div className="wide row" style={{ borderTop: "1px solid var(--border)", paddingTop: 18 }}>
            <SubmitButton pending="Saving…">Confirm profile &amp; score funds</SubmitButton>
            {p?.confirmed_at && <Link href="/matches">See matches</Link>}
          </div>
        </form>
      </section>
    </Shell>
  );
}
