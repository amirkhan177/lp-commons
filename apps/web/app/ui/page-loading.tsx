import { ShellFrame } from "./shell";

/** Skeleton shown inside the app frame while a page renders on the server. */
export default function PageLoading() {
  return (
    <ShellFrame>
      <div aria-busy="true" aria-label="Loading">
        <div className="skeleton" style={{ width: 280, height: 30 }} />
        <div className="skeleton" style={{ width: "min(560px, 90%)", height: 16, marginTop: 12 }} />
        <div className="card" style={{ marginTop: 28 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="row" style={{ padding: "14px 0", borderBottom: i < 4 ? "1px solid var(--border)" : 0, flexWrap: "nowrap" }}>
              <div className="skeleton" style={{ width: 40, height: 40, borderRadius: 999, flex: "none" }} />
              <div style={{ flex: 1 }}>
                <div className="skeleton" style={{ width: "45%", height: 14 }} />
                <div className="skeleton" style={{ width: "70%", height: 12, marginTop: 8 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </ShellFrame>
  );
}
