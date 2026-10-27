import Link from "next/link";
import Nav from "../nav";
import { confirm, draft, removeKey, saveKey, setModel } from "./actions";
import { db, WORKSPACE_ID } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getProfile } from "@/lib/thesis/fit-run";
import { DEFAULT_MODEL, listModels } from "@/lib/thesis/openrouter";
import { GEOGRAPHIES, LP_TYPES, SECTORS, STAGES } from "@/lib/thesis/taxonomy";

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
    <div className="shell">
      <Nav />
      <div className="hud-kicker">LP Commons // Fund profile</div>
      <h1>Your fund profile</h1>
      <p className="muted" style={{ maxWidth: 760 }}>
        Your thesis decides which funds of funds and peer funds LP Commons ranks first. Draft it from your website or
        deck, then check every field: matching uses what you confirm here, not the raw draft.
      </p>
      {ok && <p className="notice" style={{ borderLeftColor: "var(--hud-green)" }}>{ok}</p>}
      {error && <p className="notice" style={{ borderLeftColor: "var(--hud-target)" }}>{error}</p>}

      <section className="hud-panel org-section stack">
        <h2 className="hud-title">1 · AI model (optional)</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Bring your own <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">OpenRouter key</a> to use any
          model (Claude, GPT, Gemini, Llama…). It drafts your profile and explains the top 50 matches; you pay OpenRouter
          directly. The key is encrypted at rest and never shown again. Only your profile and public fund data are sent to
          the model, never your contacts. If your model can&apos;t be served, the free NVIDIA Nemotron 3 Nano Omni is tried
          once. Without a key, drafting uses keyword detection.
        </p>
        {keyRow ? (
          <div className="stack">
            <p style={{ margin: 0 }}><span className="badge ok">Key saved</span> <span className="muted small">model {keyRow.scopes || DEFAULT_MODEL}</span></p>
            <form action={setModel} className="filter-bar" style={{ border: 0, padding: 0, background: "none" }}>
              <label><span>Model</span><input type="text" name="model" list="or-models" defaultValue={keyRow.scopes || DEFAULT_MODEL} style={{ minWidth: 280 }} /></label>
              <button className="secondary" type="submit">Change model</button>
            </form>
            <form action={removeKey}><button className="secondary" type="submit">Remove key</button></form>
          </div>
        ) : (
          <form action={saveKey} className="filter-bar" style={{ border: 0, padding: 0, background: "none" }}>
            <label style={{ flex: "1 1 280px" }}><span>OpenRouter API key</span>
              <input type="password" name="key" placeholder="sk-or-…" autoComplete="off" required />
            </label>
            <label><span>Model</span><input type="text" name="model" list="or-models" defaultValue={DEFAULT_MODEL} style={{ minWidth: 240 }} /></label>
            <button type="submit">Save &amp; verify</button>
          </form>
        )}
        <datalist id="or-models">{models.slice(0, 400).map((m) => <option key={m} value={m} />)}</datalist>
      </section>

      <section className="hud-panel org-section stack">
        <h2 className="hud-title">2 · Draft from your website or deck</h2>
        <form action={draft} className="filter-bar" style={{ border: 0, padding: 0, background: "none" }}>
          <label style={{ flex: "1 1 260px" }}><span>Website</span>
            <input type="text" name="website" placeholder="yourfund.vc" defaultValue={p?.website ?? ""} />
          </label>
          <label><span>Pitch deck (PDF, optional)</span><input type="file" name="deck" accept="application/pdf,.pdf" /></label>
          <button type="submit">{keyRow ? "Draft with AI" : "Detect from text"}</button>
        </form>
        <p className="muted small" style={{ margin: 0 }}>
          We read your homepage plus up to three About/Thesis/Team pages. The deck is read for this draft only and not stored.
        </p>
      </section>

      <section className="hud-panel org-section">
        <h2 className="hud-title">3 · Review &amp; confirm {p?.confirmed_at && <span className="badge ok">confirmed</span>}
          {p && !p.confirmed_at && <span className="badge warn">draft{p.draft_source === "llm" ? " · AI" : p.draft_source === "keywords" ? " · keywords" : ""}</span>}
        </h2>
        <form action={confirm} className="profile-form">
          <input type="hidden" name="website" value={p?.website ?? ""} />
          <label><span>Fund name</span><input type="text" name="fund_name" defaultValue={p?.fund_name ?? ""} required /></label>
          <label className="wide"><span>Thesis (2–3 sentences)</span>
            <textarea name="summary" rows={3} defaultValue={p?.summary ?? ""} />
          </label>
          <fieldset className="wide"><legend>Sectors</legend><Chips name="sectors" options={SECTORS} selected={p?.sectors ?? []} /></fieldset>
          <fieldset><legend>Stage</legend><Chips name="stages" options={STAGES} selected={p?.stages ?? []} /></fieldset>
          <fieldset><legend>Geography</legend><Chips name="geographies" options={GEOGRAPHIES} selected={p?.geographies ?? []} /></fieldset>
          <label><span>Fund number</span><input type="number" name="fund_number" min={1} max={20} defaultValue={p?.fund_number ?? ""} /></label>
          <label><span>Target fund size</span><input type="text" name="target_size" placeholder="e.g. 40M" defaultValue={usd(p?.target_size ?? null)} /></label>
          <label><span>Check size from</span><input type="text" name="check_min" placeholder="e.g. 500K" defaultValue={usd(p?.check_min ?? null)} /></label>
          <label><span>Check size to</span><input type="text" name="check_max" placeholder="e.g. 2M" defaultValue={usd(p?.check_max ?? null)} /></label>
          <fieldset className="wide"><legend>LPs you want to reach</legend><Chips name="lp_types" options={LP_TYPES} selected={p?.lp_types ?? ["fof", "family_office", "hnw"]} /></fieldset>
          <label className="wide"><span>Themes (comma-separated)</span><input type="text" name="keywords" defaultValue={(p?.keywords ?? []).join(", ")} /></label>
          {ownCandidates.length > 0 && (
            <label className="wide"><span>Is one of these your fund&apos;s Form D filing?</span>
              <select name="own_entity_id" defaultValue={p?.own_entity_id ? String(p.own_entity_id) : ""}>
                <option value="">None of these</option>
                {ownCandidates.map((c) => <option key={c.entity_id} value={c.entity_id}>{c.name}{c.vintage ? ` · ${c.vintage}` : ""}</option>)}
              </select>
            </label>
          )}
          <div className="wide" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button type="submit">Confirm profile &amp; score funds</button>
            {p?.confirmed_at && <Link href="/matches">See matches</Link>}
          </div>
        </form>
      </section>
    </div>
  );
}
