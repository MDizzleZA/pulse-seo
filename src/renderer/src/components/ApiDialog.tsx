import { useEffect, useState } from 'react';
import type { ApiConfig, ApiProgress, ApiRunSummary, IntegrationStatus } from '../../../shared/types';

interface Props {
  onClose: () => void;
  /** Bump grids/overview after an import writes rows. */
  onDataChanged: () => void;
}

const SECTIONS = ['Google', 'PageSpeed', 'Backlinks'] as const;
type Section = (typeof SECTIONS)[number];

export default function ApiDialog(props: Props): React.JSX.Element {
  const [section, setSection] = useState<Section>('Google');
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [cfg, setCfg] = useState<ApiConfig | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [psiKey, setPsiKey] = useState('');
  const [sites, setSites] = useState<{ siteUrl: string; permissionLevel: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<ApiProgress | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refreshStatus = async (): Promise<void> => {
    setStatus(await window.pulse.apiStatus());
  };

  useEffect(() => {
    refreshStatus().catch(() => undefined);
    window.pulse
      .getApiConfig()
      .then(setCfg)
      .catch(() => undefined);
    return window.pulse.onApiProgress(setProgress);
  }, []);

  const set = <K extends keyof ApiConfig>(key: K, value: ApiConfig[K]): void =>
    setCfg((c) => (c ? { ...c, [key]: value } : c));

  const saveConfig = async (next: ApiConfig): Promise<void> => {
    setCfg(next);
    await window.pulse.setApiConfig(next);
  };

  const report = (label: string, r: ApiRunSummary): void => {
    if (r.ok) {
      const extra =
        r.unmatched !== undefined && r.unmatched > 0 ? ` (${r.unmatched} unmatched)` : '';
      const failed = r.failed ? `, ${r.failed} failed` : '';
      setMessage(`${label}: ${r.written} rows written${extra}${failed}`);
      props.onDataChanged();
    } else if (r.error) {
      setMessage(`${label} failed: ${r.error}`);
    } else {
      setMessage(null); // cancelled dialog etc.
    }
  };

  const run = async (label: string, fn: () => Promise<ApiRunSummary>): Promise<void> => {
    if (!cfg) return;
    setBusy(label);
    setMessage(null);
    setProgress(null);
    try {
      await window.pulse.setApiConfig(cfg); // persist settings alongside the run
      report(label, await fn());
    } catch (err) {
      setMessage(`${label} failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const row = (label: string, control: React.JSX.Element, hint?: string): React.JSX.Element => (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-56 shrink-0 text-slate-300 text-sm">{label}</span>
      {control}
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
    </div>
  );

  const num = (v: string, fallback: number): number => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-900 border border-slate-700 rounded-lg w-[820px] max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700">
          <span className="font-semibold text-slate-100">API Integrations</span>
          <button className="text-slate-400 hover:text-slate-100 cursor-pointer" onClick={props.onClose}>
            ✕
          </button>
        </div>
        <div className="flex flex-1 min-h-0">
          <div className="w-40 border-r border-slate-800 py-2">
            {SECTIONS.map((s) => (
              <button
                key={s}
                className={
                  'w-full text-left px-4 py-1.5 text-sm cursor-pointer ' +
                  (s === section ? 'bg-slate-800 text-emerald-300' : 'text-slate-400 hover:text-slate-200')
                }
                onClick={() => setSection(s)}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {section === 'Google' && cfg && (
              <>
                <div className="text-xs text-slate-500 pb-2">
                  Search Console and GA4 share one Google sign-in. Create an OAuth desktop client
                  in Google Cloud Console; credentials are stored in the Windows keychain, never
                  in the project file.
                </div>
                {row('OAuth client ID', (
                  <input
                    className="input w-full"
                    value={clientId}
                    placeholder={status?.googleClientSet ? '(saved — enter to replace)' : 'xxxx.apps.googleusercontent.com'}
                    onChange={(e) => setClientId(e.target.value)}
                  />
                ))}
                {row('OAuth client secret', (
                  <input
                    className="input w-full"
                    type="password"
                    value={clientSecret}
                    placeholder={status?.googleClientSet ? '(saved — enter to replace)' : ''}
                    onChange={(e) => setClientSecret(e.target.value)}
                  />
                ))}
                <div className="flex items-center gap-2 py-1.5">
                  <button
                    className="btn btn-secondary"
                    disabled={!clientId.trim() || !clientSecret.trim()}
                    onClick={async () => {
                      await window.pulse.setGoogleClient(clientId.trim(), clientSecret.trim());
                      setClientId('');
                      setClientSecret('');
                      await refreshStatus();
                      setMessage('Google client saved');
                    }}
                  >
                    Save client
                  </button>
                  {status?.googleAuthed ? (
                    <>
                      <span className="text-sm text-emerald-400">
                        Connected{status.googleEmail ? ` as ${status.googleEmail}` : ''}
                      </span>
                      <button
                        className="btn btn-secondary"
                        onClick={async () => {
                          await window.pulse.googleDisconnect();
                          setSites([]);
                          await refreshStatus();
                        }}
                      >
                        Disconnect
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn btn-primary"
                      disabled={!status?.googleClientSet || busy !== null}
                      onClick={async () => {
                        setBusy('connect');
                        setMessage('Complete the sign-in in your browser…');
                        const r = await window.pulse.googleConnect();
                        setBusy(null);
                        setMessage(r.ok ? `Connected${r.email ? ` as ${r.email}` : ''}` : `Connect failed: ${r.error}`);
                        await refreshStatus();
                      }}
                    >
                      Connect Google
                    </button>
                  )}
                </div>

                <div className="border-t border-slate-800 my-3" />
                <div className="text-sm font-semibold text-slate-200 pb-1">Search Console</div>
                {row('Property', (
                  <div className="flex gap-2 w-full">
                    {sites.length > 0 ? (
                      <select
                        className="input flex-1"
                        value={cfg.gscProperty}
                        onChange={(e) => set('gscProperty', e.target.value)}
                      >
                        <option value="">Choose a property…</option>
                        {sites.map((s) => (
                          <option key={s.siteUrl} value={s.siteUrl}>
                            {s.siteUrl} ({s.permissionLevel})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="input flex-1"
                        value={cfg.gscProperty}
                        placeholder="sc-domain:example.com or https://www.example.com/"
                        onChange={(e) => set('gscProperty', e.target.value)}
                      />
                    )}
                    <button
                      className="btn btn-secondary"
                      disabled={!status?.googleAuthed || busy !== null}
                      onClick={async () => {
                        setBusy('sites');
                        try {
                          setSites(await window.pulse.gscSites());
                        } catch (err) {
                          setMessage(`Could not list properties: ${err instanceof Error ? err.message : String(err)}`);
                        } finally {
                          setBusy(null);
                        }
                      }}
                    >
                      Load properties
                    </button>
                  </div>
                ))}
                {row('Date range (days)', (
                  <input
                    className="input w-28"
                    value={cfg.gscDays}
                    onChange={(e) => set('gscDays', num(e.target.value, 90))}
                  />
                ))}
                <button
                  className="btn btn-primary"
                  disabled={!status?.googleAuthed || !cfg.gscProperty.trim() || busy !== null}
                  onClick={() => run('Search Console', () => window.pulse.runGsc(cfg.gscProperty, cfg.gscDays))}
                >
                  {busy === 'Search Console' ? 'Fetching…' : 'Fetch GSC data'}
                </button>

                <div className="border-t border-slate-800 my-3" />
                <div className="text-sm font-semibold text-slate-200 pb-1">GA4</div>
                {row('Property ID', (
                  <input
                    className="input w-56"
                    value={cfg.ga4Property}
                    placeholder="e.g. 123456789"
                    onChange={(e) => set('ga4Property', e.target.value)}
                  />
                ), 'Numeric ID from GA4 Admin → Property details')}
                {row('Date range (days)', (
                  <input
                    className="input w-28"
                    value={cfg.ga4Days}
                    onChange={(e) => set('ga4Days', num(e.target.value, 90))}
                  />
                ))}
                <button
                  className="btn btn-primary"
                  disabled={!status?.googleAuthed || !cfg.ga4Property.trim() || busy !== null}
                  onClick={() => run('GA4', () => window.pulse.runGa4(cfg.ga4Property, cfg.ga4Days))}
                >
                  {busy === 'GA4' ? 'Fetching…' : 'Fetch GA4 data'}
                </button>
              </>
            )}

            {section === 'PageSpeed' && cfg && (
              <>
                <div className="text-xs text-slate-500 pb-2">
                  Needs a (free) PageSpeed Insights API key from Google Cloud Console. Each URL is
                  one API call — keep the URL cap modest.
                </div>
                {row('API key', (
                  <input
                    className="input w-full"
                    type="password"
                    value={psiKey}
                    placeholder={status?.psiKeySet ? '(saved — enter to replace)' : 'AIza…'}
                    onChange={(e) => setPsiKey(e.target.value)}
                  />
                ))}
                <div className="py-1.5">
                  <button
                    className="btn btn-secondary"
                    disabled={!psiKey.trim()}
                    onClick={async () => {
                      await window.pulse.setPsiKey(psiKey.trim());
                      setPsiKey('');
                      await refreshStatus();
                      setMessage('PageSpeed API key saved');
                    }}
                  >
                    Save key
                  </button>
                </div>
                {row('Strategy', (
                  <select
                    className="input"
                    value={cfg.psiStrategy}
                    onChange={(e) => set('psiStrategy', e.target.value as 'mobile' | 'desktop')}
                  >
                    <option value="mobile">Mobile</option>
                    <option value="desktop">Desktop</option>
                  </select>
                ))}
                {row('Max URLs', (
                  <input
                    className="input w-28"
                    value={cfg.psiMaxUrls}
                    onChange={(e) => set('psiMaxUrls', num(e.target.value, 25))}
                  />
                ), 'Most-linked pages are tested first')}
                <button
                  className="btn btn-primary"
                  disabled={!status?.psiKeySet || busy !== null}
                  onClick={() => run('PageSpeed', () => window.pulse.runPsi(cfg.psiStrategy, cfg.psiMaxUrls))}
                >
                  {busy === 'PageSpeed' ? 'Running…' : 'Run PageSpeed'}
                </button>
                {busy === 'PageSpeed' && progress?.kind === 'psi' && (
                  <div className="text-xs text-slate-400 pt-2">
                    {progress.done}/{progress.total} — {progress.message}
                  </div>
                )}
              </>
            )}

            {section === 'Backlinks' && (
              <>
                <div className="text-xs text-slate-500 pb-2">
                  Import a CSV export from Ahrefs, Moz or Majestic (or any CSV with a URL column).
                  The provider and rating columns are detected from the header row.
                </div>
                <button
                  className="btn btn-primary"
                  disabled={busy !== null}
                  onClick={() => run('Backlinks import', () => window.pulse.importBacklinks())}
                >
                  {busy === 'Backlinks import' ? 'Importing…' : 'Import CSV…'}
                </button>
              </>
            )}

            {message && <div className="text-sm text-slate-300 pt-3">{message}</div>}
          </div>
        </div>
        <div className="flex justify-end gap-2 px-4 py-2 border-t border-slate-700">
          <button
            className="btn btn-secondary"
            onClick={async () => {
              if (cfg) await window.pulse.setApiConfig(cfg);
              props.onClose();
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
