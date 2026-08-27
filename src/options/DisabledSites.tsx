// The Options-page list of sites where the eligibility badge is turned off, plus
// each row's "Turn back on" button. Kept in its own module so it can be
// unit-tested without pulling in the rest of Options.tsx, which transitively
// imports pdfjs-dist and therefore needs browser globals unavailable in the
// node test env.

export function DisabledSites({
  hosts,
  onEnable,
}: {
  hosts: string[];
  onEnable: (host: string) => void;
}) {
  // Storage order is insertion order (most-recently-turned-off last); sort for
  // a stable, scannable list instead.
  const sorted = [...hosts].sort((a, b) => a.localeCompare(b));

  return (
    <section className="card">
      <h2>Sites where the badge is turned off</h2>
      <p className="help">
        Add a site with "⚙ Turn off on this site only" on the badge itself. An entry also
        covers that site's subdomains — the page path doesn't matter.
      </p>
      {sorted.length === 0 ? (
        <p className="help">No sites turned off — the badge shows wherever scanning is on.</p>
      ) : (
        <div style={{ margin: '10px 0' }}>
          {sorted.map((host) => (
            <div key={host} className="list-item" style={{ display: 'flex', alignItems: 'center' }}>
              <span style={{ flex: 1 }}>🚫 {host}</span>
              <button onClick={() => onEnable(host)} aria-label={`Turn the badge back on for ${host}`}>
                Turn back on
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
