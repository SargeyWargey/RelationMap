"use client";

import { useMemo, useState } from "react";

import { TierGlyph } from "@/components/OrreryAtlas";
import type { GraphData } from "@/lib/types";
import type { OrreryConfig, RingDatabaseMapping, RingSubType, TierMapping } from "@/lib/orreryTypes";
import { analyzeMapping, linkCoverage, suggestMapping } from "@/lib/orreryUniverse";

type Props = {
  graphData: GraphData | null;
  initialConfig: OrreryConfig | null;
  onLaunch: (config: OrreryConfig) => void;
  /** Only supplied when there is already a saved config (allows closing without re-saving) */
  onClose?: () => void;
};

type DbInfo = { id: string; name: string; color: string; count: number };
type TierKey = "galaxy" | "star" | "planet" | "moon";

const TIERS: Array<{ key: TierKey; field: keyof Omit<TierMapping, "ringDatabases">; title: string; one: string; blurb: string; optional: boolean }> = [
  { key: "galaxy", field: "galaxyDatabaseId", title: "Galaxies", one: "galaxy", blurb: "The broadest grouping — each record becomes a galaxy.", optional: false },
  { key: "star", field: "starDatabaseId", title: "Stars", one: "star", blurb: "Each record becomes a star system inside the galaxy it relates to.", optional: false },
  { key: "planet", field: "planetDatabaseId", title: "Planets", one: "planet", blurb: "Each record orbits the star it relates to.", optional: true },
  { key: "moon", field: "moonDatabaseId", title: "Moons", one: "moon", blurb: "Each record orbits the planet it relates to.", optional: true },
];

const MONO: React.CSSProperties = { fontFamily: "'DM Mono', monospace" };
const GEIST: React.CSSProperties = { fontFamily: "'Geist', sans-serif" };

function pct(n: number, d: number) {
  return d === 0 ? 0 : Math.round((n / d) * 100);
}

function healthColor(ratio: number) {
  if (ratio >= 0.6) return "var(--accent-sage)";
  if (ratio >= 0.25) return "var(--accent-gold)";
  return "var(--accent-rust)";
}

function HealthBar({ placed, count, label }: { placed: number; count: number; label: string }) {
  const ratio = count ? placed / count : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "2px 0 2px 15px", padding: "8px 0 8px 22px", borderLeft: "1px dashed var(--border-strong)" }}>
      <div style={{ width: 80, height: 4, borderRadius: 2, background: "var(--bg-overlay)", overflow: "hidden", flexShrink: 0 }}>
        <div style={{ width: `${Math.max(2, ratio * 100)}%`, height: "100%", background: healthColor(ratio), transition: "width 0.3s ease" }} />
      </div>
      <span style={{ ...MONO, fontSize: 10.5, color: "var(--text-muted)" }}>
        <span style={{ color: healthColor(ratio), fontWeight: 500 }}>{placed.toLocaleString()}</span> of {count.toLocaleString()} {label}
        {count - placed > 0 && <span style={{ color: "var(--text-faint)" }}> · {(count - placed).toLocaleString()} drift to deep space</span>}
      </span>
    </div>
  );
}

export function OrreryUniverseBuilder({ graphData, initialConfig, onLaunch, onClose }: Props) {
  const databases = useMemo<DbInfo[]>(() => {
    if (!graphData) return [];
    const map = new Map<string, DbInfo>();
    for (const node of graphData.nodes) {
      const existing = map.get(node.databaseId);
      if (existing) existing.count++;
      else map.set(node.databaseId, { id: node.databaseId, name: node.databaseName, color: node.color, count: 1 });
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [graphData]);
  const dbById = useMemo(() => new Map(databases.map((d) => [d.id, d])), [databases]);
  const coverage = useMemo(() => (graphData ? linkCoverage(graphData) : () => 0), [graphData]);
  const suggestion = useMemo(() => (graphData ? suggestMapping(graphData) : null), [graphData]);

  const [mapping, setMapping] = useState<TierMapping>(() => initialConfig?.tierMapping ?? suggestion ?? {
    galaxyDatabaseId: "", starDatabaseId: "", planetDatabaseId: "", moonDatabaseId: "", ringDatabases: [],
  });
  const [ringsOpen, setRingsOpen] = useState(() => (initialConfig?.tierMapping.ringDatabases.length ?? 0) > 0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const health = useMemo(() => (graphData ? analyzeMapping(graphData, mapping) : null), [graphData, mapping]);

  const used = [mapping.galaxyDatabaseId, mapping.starDatabaseId, mapping.planetDatabaseId, mapping.moonDatabaseId].filter(Boolean);
  const duplicate = new Set(used).size !== used.length;
  const isValid = !!mapping.galaxyDatabaseId && !!mapping.starDatabaseId && !duplicate && (!mapping.moonDatabaseId || !!mapping.planetDatabaseId);
  const isSuggested = !!suggestion && (["galaxyDatabaseId", "starDatabaseId", "planetDatabaseId", "moonDatabaseId"] as const)
    .every((k) => suggestion[k] === mapping[k]);

  function setTier(field: keyof Omit<TierMapping, "ringDatabases">, value: string) {
    setMapping((prev) => {
      const next = { ...prev, [field]: value };
      if (field === "planetDatabaseId" && !value) next.moonDatabaseId = "";
      return next;
    });
  }

  function updateRing(index: number, next: RingDatabaseMapping) {
    setMapping((prev) => ({ ...prev, ringDatabases: prev.ringDatabases.map((r, i) => (i === index ? next : r)) }));
  }

  async function handleSubmit() {
    if (!isValid) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const resp = await fetch("/api/orrery-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tierMapping: { ...mapping, ringDatabases: mapping.ringDatabases.filter((r) => r.databaseId) } }),
      });
      const data = await resp.json() as { ok?: boolean; orreryConfig?: OrreryConfig; error?: string };
      if (!resp.ok || !data.orreryConfig) {
        setSubmitError(data.error ?? "Failed to save configuration.");
        return;
      }
      onLaunch(data.orreryConfig);
    } catch (e) {
      setSubmitError(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  // Parent tier for coverage ranking
  const parentOf: Record<TierKey, string> = {
    galaxy: "",
    star: mapping.galaxyDatabaseId,
    planet: mapping.starDatabaseId,
    moon: mapping.planetDatabaseId,
  };

  function optionsFor(key: TierKey) {
    const parent = parentOf[key];
    const list = databases.map((d) => ({ ...d, cov: parent ? coverage(d.id, parent) : 0 }));
    if (parent) list.sort((a, b) => b.cov / b.count - a.cov / a.count || b.cov - a.cov || a.name.localeCompare(b.name));
    return { list, parent };
  }

  const placedTotal = health
    ? health.galaxy.count + (health.star?.placed ?? 0) + (health.planet?.placed ?? 0) + (health.moon?.placed ?? 0)
    : 0;
  const recordTotal = health
    ? health.galaxy.count + (health.star?.count ?? 0) + (health.planet?.count ?? 0) + (health.moon?.count ?? 0)
    : 0;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
        background: "radial-gradient(ellipse at 50% 40%, rgba(40,30,70,0.55), rgba(5,6,13,0.9) 70%)",
        backdropFilter: "blur(6px)", padding: 24,
      }}
      onKeyDown={(e) => { if (e.key === "Escape" && onClose) onClose(); }}
    >
      <div
        className="animate-fade-up"
        style={{
          position: "relative", width: "100%", maxWidth: 660, maxHeight: "92vh", overflowY: "auto",
          background: "var(--bg-raised)", border: "1px solid var(--border-default)", borderRadius: 16,
          boxShadow: "var(--shadow-panel)", display: "flex", flexDirection: "column",
        }}
      >
        {/* Header */}
        <div style={{ padding: "26px 30px 18px", borderBottom: "1px solid var(--border-subtle)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div>
              <h2 style={{ fontFamily: "'Lora', Georgia, serif", margin: 0, fontSize: 22, fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
                Build your universe
              </h2>
              <p style={{ ...GEIST, margin: "6px 0 0", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5, maxWidth: 480 }}>
                Each tier is one of your Notion databases. Records orbit whatever they&apos;re related to one tier up —
                anything without a link drifts into Deep Space so nothing is lost.
              </p>
            </div>
            {onClose && (
              <button
                type="button" onClick={onClose} title="Close"
                style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-faint)", cursor: "pointer", fontSize: 16, flexShrink: 0 }}
              >
                ×
              </button>
            )}
          </div>

          {suggestion && (
            <div style={{
              marginTop: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
              padding: "10px 12px", borderRadius: 10, background: "var(--bg-overlay)", border: "1px solid var(--border-subtle)",
            }}>
              <div style={{ ...MONO, fontSize: 10.5, color: "var(--text-muted)", lineHeight: 1.5, minWidth: 0 }}>
                <span style={{ color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Best fit from your relations</span>
                <div style={{ color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {[suggestion.galaxyDatabaseId, suggestion.starDatabaseId, suggestion.planetDatabaseId, suggestion.moonDatabaseId]
                    .filter(Boolean).map((id) => dbById.get(id)?.name ?? "?").join("  →  ")}
                </div>
              </div>
              <button
                type="button"
                disabled={isSuggested}
                onClick={() => setMapping((prev) => ({ ...suggestion, ringDatabases: prev.ringDatabases }))}
                style={{
                  ...GEIST, height: 30, padding: "0 12px", borderRadius: 8, flexShrink: 0,
                  border: `1px solid ${isSuggested ? "var(--border-subtle)" : "var(--accent-warm)"}`,
                  background: isSuggested ? "transparent" : "color-mix(in srgb, var(--accent-warm) 12%, transparent)",
                  color: isSuggested ? "var(--text-faint)" : "var(--accent-warm)",
                  fontSize: 12, fontWeight: 500, cursor: isSuggested ? "default" : "pointer",
                }}
              >
                {isSuggested ? "✓ In use" : "✦ Use this"}
              </button>
            </div>
          )}
        </div>

        {/* Tier chain */}
        <div style={{ padding: "20px 30px 8px" }}>
          {TIERS.map((tier, idx) => {
            const value = mapping[tier.field];
            const { list, parent } = optionsFor(tier.key);
            const disabled = tier.key === "moon" && !mapping.planetDatabaseId;
            const h = health?.[tier.key];
            const db = value ? dbById.get(value) : undefined;
            const conflict = !!value && used.filter((u) => u === value).length > 1;
            return (
              <div key={tier.key}>
                {idx > 0 && h && value && parent && (
                  <HealthBar placed={h.placed} count={h.count} label={`${tier.title.toLowerCase()} link to a ${TIERS[idx - 1].one}`} />
                )}
                {idx > 0 && (!value || !parent) && <div style={{ height: 14, marginLeft: 15, borderLeft: "1px dashed var(--border-default)" }} />}
                <div style={{ display: "flex", alignItems: "center", gap: 14, opacity: disabled ? 0.45 : 1 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 10, flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: value ? "color-mix(in srgb, var(--accent-warm) 14%, transparent)" : "var(--bg-overlay)",
                    border: `1px solid ${value ? "color-mix(in srgb, var(--accent-warm) 45%, transparent)" : "var(--border-default)"}`,
                    color: value ? "var(--accent-warm)" : "var(--text-faint)",
                  }}>
                    <TierGlyph tier={tier.key} size={16} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ ...GEIST, fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{tier.title}</span>
                      <span style={{ ...MONO, fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", color: tier.optional ? "var(--text-faint)" : "var(--accent-warm)" }}>
                        {tier.optional ? "optional" : "required"}
                      </span>
                    </div>
                    <div style={{ ...GEIST, fontSize: 11.5, color: "var(--text-faint)", marginTop: 2 }}>{tier.blurb}</div>
                  </div>
                  <div style={{ width: 268, flexShrink: 0 }}>
                    <select
                      value={value}
                      disabled={disabled}
                      onChange={(e) => setTier(tier.field, e.target.value)}
                      style={{
                        ...MONO, width: "100%", height: 34, padding: "0 8px", borderRadius: 8, fontSize: 11.5,
                        background: "var(--bg-overlay)", color: value ? "var(--text-primary)" : "var(--text-muted)",
                        border: `1px solid ${conflict ? "var(--accent-rust)" : value ? "var(--border-strong)" : "var(--border-default)"}`,
                        cursor: disabled ? "not-allowed" : "pointer", outline: "none",
                      }}
                    >
                      <option value="">{tier.optional ? "— none —" : "— choose a database —"}</option>
                      {list.map((d) => (
                        <option key={d.id} value={d.id}>
                          {parent ? `${pct(d.cov, d.count)}% · ` : ""}{d.name} ({d.count.toLocaleString()})
                        </option>
                      ))}
                    </select>
                    {db && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5 }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: db.color }} />
                        <span style={{ ...MONO, fontSize: 10, color: conflict ? "var(--accent-rust)" : "var(--text-faint)" }}>
                          {conflict ? "already used by another tier" : `${db.count.toLocaleString()} ${tier.title.toLowerCase()}`}
                          {!conflict && tier.key === "galaxy" && health ? ` · ${health.galaxy.withStars} hold stars` : ""}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Rings */}
        <div style={{ padding: "12px 30px 20px" }}>
          <button
            type="button"
            onClick={() => setRingsOpen((v) => !v)}
            style={{ ...MONO, display: "flex", alignItems: "center", gap: 8, padding: 0, border: "none", background: "transparent", cursor: "pointer", fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-faint)" }}
          >
            <svg width="8" height="8" viewBox="0 0 8 8" style={{ transform: ringsOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
              <path d="M2.5 1 5.5 4 2.5 7" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
            </svg>
            Rings &amp; asteroid belts · optional
            {mapping.ringDatabases.filter((r) => r.databaseId).length > 0 && (
              <span style={{ color: "var(--accent-warm)" }}>{mapping.ringDatabases.filter((r) => r.databaseId).length}</span>
            )}
          </button>
          {ringsOpen && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
              <p style={{ ...GEIST, margin: 0, fontSize: 11.5, color: "var(--text-faint)", lineHeight: 1.5 }}>
                Records from these databases become particles — rings around the planet they relate to, or a belt around their star.
              </p>
              {mapping.ringDatabases.map((r, i) => {
                const rh = health?.ring.find((x) => x.dbId === r.databaseId && x.subType === r.subType);
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 9, background: "var(--bg-overlay)", border: "1px solid var(--border-subtle)" }}>
                    <select
                      value={r.databaseId}
                      onChange={(e) => updateRing(i, { ...r, databaseId: e.target.value })}
                      style={{ ...MONO, flex: 1, minWidth: 0, height: 28, padding: "0 8px", borderRadius: 6, fontSize: 11.5, background: "var(--bg-base)", color: "var(--text-primary)", border: "1px solid var(--border-default)", outline: "none" }}
                    >
                      <option value="">— database —</option>
                      {databases.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.count}</option>)}
                    </select>
                    <div style={{ display: "flex", borderRadius: 6, border: "1px solid var(--border-default)", overflow: "hidden", flexShrink: 0 }}>
                      {(["planet-rings", "star-belt"] as RingSubType[]).map((type) => (
                        <button
                          key={type} type="button" onClick={() => updateRing(i, { ...r, subType: type })}
                          style={{ ...MONO, padding: "4px 9px", fontSize: 10, border: "none", cursor: "pointer", background: r.subType === type ? "var(--accent-warm)" : "transparent", color: r.subType === type ? "#fff" : "var(--text-muted)" }}
                        >
                          {type === "planet-rings" ? "planet rings" : "star belt"}
                        </button>
                      ))}
                    </div>
                    <span style={{ ...MONO, fontSize: 10, color: "var(--text-faint)", width: 74, textAlign: "right", flexShrink: 0 }}>
                      {rh ? `${rh.placed} attach` : ""}
                    </span>
                    <button
                      type="button" title="Remove"
                      onClick={() => setMapping((prev) => ({ ...prev, ringDatabases: prev.ringDatabases.filter((_, k) => k !== i) }))}
                      style={{ width: 24, height: 24, borderRadius: 6, border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-faint)", cursor: "pointer", flexShrink: 0 }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
              <button
                type="button"
                onClick={() => setMapping((prev) => ({ ...prev, ringDatabases: [...prev.ringDatabases, { databaseId: "", subType: "planet-rings" }] }))}
                style={{ ...GEIST, alignSelf: "flex-start", height: 28, padding: "0 12px", borderRadius: 7, border: "1px dashed var(--border-strong)", background: "transparent", color: "var(--text-muted)", fontSize: 11.5, cursor: "pointer" }}
              >
                + Add ring database
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "14px 30px 22px", borderTop: "1px solid var(--border-subtle)",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
          position: "sticky", bottom: 0, background: "var(--bg-raised)",
        }}>
          <div style={{ ...MONO, fontSize: 10.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
            {submitError ? (
              <span style={{ color: "var(--accent-rust)" }}>{submitError}</span>
            ) : !isValid ? (
              <span style={{ color: "var(--accent-rust)" }}>
                {duplicate ? "Each tier needs a different database." : "Choose a Galaxy and a Star database to begin."}
              </span>
            ) : (
              <>
                <span style={{ color: "var(--text-primary)" }}>{placedTotal.toLocaleString()}</span> of {recordTotal.toLocaleString()} records find an orbit
                <br />
                <span style={{ color: "var(--text-faint)" }}>{(recordTotal - placedTotal).toLocaleString()} will drift in Deep Space</span>
              </>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            {onClose && (
              <button type="button" onClick={onClose} style={{ ...GEIST, height: 38, padding: "0 16px", borderRadius: 8, border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-muted)", fontSize: 12.5, cursor: "pointer" }}>
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!isValid || submitting}
              style={{
                ...GEIST, height: 38, padding: "0 22px", borderRadius: 8, border: "none", fontSize: 13.5, fontWeight: 600,
                background: !isValid || submitting ? "var(--bg-overlay)" : "var(--accent-warm)",
                color: !isValid || submitting ? "var(--text-faint)" : "#fff",
                cursor: !isValid || submitting ? "not-allowed" : "pointer",
              }}
            >
              {submitting ? "Saving…" : initialConfig ? "Rebuild universe" : "Launch universe"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
