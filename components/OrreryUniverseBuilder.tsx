"use client";

import { useState, useMemo } from "react";
import type { GraphData } from "@/lib/types";
import type { OrreryConfig, RingDatabaseMapping, RingSubType } from "@/lib/orreryTypes";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DbInfo = {
  id: string;
  name: string;
  color: string;
  count: number;
};

type Props = {
  graphData: GraphData | null;
  initialConfig: OrreryConfig | null;
  onLaunch: (config: OrreryConfig) => void;
  /** Only supplied when there is already a saved config (allows closing without re-saving) */
  onClose?: () => void;
};

// ---------------------------------------------------------------------------
// Styles — shared primitives
// ---------------------------------------------------------------------------

const MONO: React.CSSProperties = {
  fontFamily: "'DM Mono', monospace",
};

const GEIST: React.CSSProperties = {
  fontFamily: "'Geist', sans-serif",
};

const LORA: React.CSSProperties = {
  fontFamily: "'Lora', Georgia, serif",
};

function labelStyle(required = false): React.CSSProperties {
  return {
    ...MONO,
    fontSize: 11,
    fontWeight: 500,
    color: required ? "var(--accent-warm)" : "var(--text-muted)",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    display: "flex",
    alignItems: "center",
    gap: 4,
    marginBottom: 6,
  };
}

function selectStyle(hasValue: boolean, error = false): React.CSSProperties {
  return {
    ...MONO,
    width: "100%",
    padding: "8px 12px",
    background: "var(--bg-overlay)",
    border: `1px solid ${error ? "var(--accent-warm)" : hasValue ? "var(--border-strong)" : "var(--border-default)"}`,
    borderRadius: 8,
    color: hasValue ? "var(--text-primary)" : "var(--text-muted)",
    fontSize: 13,
    cursor: "pointer",
    outline: "none",
    appearance: "auto",
    transition: "border-color 0.15s",
  };
}

function btnPrimary(disabled: boolean): React.CSSProperties {
  return {
    ...GEIST,
    height: 40,
    padding: "0 24px",
    borderRadius: 8,
    border: "none",
    background: disabled ? "var(--bg-overlay)" : "var(--accent-warm)",
    color: disabled ? "var(--text-faint)" : "#fff",
    fontSize: 14,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    letterSpacing: "-0.01em",
    transition: "background 0.15s, color 0.15s",
    flexShrink: 0,
  };
}

function btnSecondary(): React.CSSProperties {
  return {
    ...GEIST,
    height: 36,
    padding: "0 16px",
    borderRadius: 8,
    border: "1px solid var(--border-default)",
    background: "transparent",
    color: "var(--text-muted)",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
    transition: "border-color 0.15s, color 0.15s",
    flexShrink: 0,
  };
}

// ---------------------------------------------------------------------------
// TierRow — one mandatory tier selector
// ---------------------------------------------------------------------------

function TierRow({
  index,
  label,
  description,
  value,
  databases,
  usedIds,
  error,
  onChange,
}: {
  index: number;
  label: string;
  description: string;
  value: string;
  databases: DbInfo[];
  usedIds: Set<string>;
  error: boolean;
  onChange: (id: string) => void;
}) {
  const selected = databases.find((d) => d.id === value);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <div style={labelStyle(true)}>
        <span style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 18,
          height: 18,
          borderRadius: 4,
          background: "var(--accent-warm)",
          color: "#fff",
          fontSize: 10,
          fontWeight: 700,
          flexShrink: 0,
        }}>
          {index}
        </span>
        {label}
        <span style={{ color: "var(--text-faint)", fontWeight: 300, textTransform: "none", fontSize: 10 }}>
          — {description}
        </span>
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={selectStyle(!!value, error)}
      >
        <option value="">— select a database —</option>
        {databases.map((db) => (
          <option
            key={db.id}
            value={db.id}
            disabled={usedIds.has(db.id) && db.id !== value}
          >
            {db.name} ({db.count} record{db.count !== 1 ? "s" : ""})
            {usedIds.has(db.id) && db.id !== value ? " [in use]" : ""}
          </option>
        ))}
      </select>
      {error && (
        <span style={{ ...MONO, fontSize: 10, color: "var(--accent-warm)", marginTop: 4 }}>
          Required — select a database to continue.
        </span>
      )}
      {selected && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5 }}>
          <div style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: selected.color,
            flexShrink: 0,
          }} />
          <span style={{ ...MONO, fontSize: 10, color: "var(--text-faint)" }}>
            {selected.count} record{selected.count !== 1 ? "s" : ""} will become {label.toLowerCase()}s
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RingRow — one optional ring/belt database entry
// ---------------------------------------------------------------------------

function RingRow({
  mapping,
  databases,
  onChange,
  onRemove,
}: {
  mapping: RingDatabaseMapping;
  databases: DbInfo[];
  onChange: (next: RingDatabaseMapping) => void;
  onRemove: () => void;
}) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "8px 10px",
      background: "var(--bg-overlay)",
      borderRadius: 8,
      border: "1px solid var(--border-subtle)",
    }}>
      <select
        value={mapping.databaseId}
        onChange={(e) => onChange({ ...mapping, databaseId: e.target.value })}
        style={{
          ...MONO,
          flex: 1,
          padding: "5px 8px",
          background: "var(--bg-base)",
          border: "1px solid var(--border-default)",
          borderRadius: 6,
          color: mapping.databaseId ? "var(--text-primary)" : "var(--text-muted)",
          fontSize: 12,
          cursor: "pointer",
          outline: "none",
          appearance: "auto",
        }}
      >
        <option value="">— database —</option>
        {databases.map((db) => (
          <option key={db.id} value={db.id}>
            {db.name} ({db.count})
          </option>
        ))}
      </select>

      {/* Sub-type toggle */}
      <div style={{ display: "flex", borderRadius: 6, border: "1px solid var(--border-default)", overflow: "hidden", flexShrink: 0 }}>
        {(["planet-rings", "star-belt"] as RingSubType[]).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => onChange({ ...mapping, subType: type })}
            style={{
              ...MONO,
              padding: "4px 10px",
              fontSize: 10,
              fontWeight: 500,
              background: mapping.subType === type ? "var(--accent-warm)" : "transparent",
              color: mapping.subType === type ? "#fff" : "var(--text-muted)",
              border: "none",
              cursor: "pointer",
              letterSpacing: "0.04em",
              transition: "background 0.12s, color 0.12s",
              whiteSpace: "nowrap",
            }}
          >
            {type === "planet-rings" ? "Planet rings" : "Star belt"}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onRemove}
        title="Remove"
        style={{
          width: 26,
          height: 26,
          borderRadius: 6,
          border: "1px solid var(--border-default)",
          background: "transparent",
          color: "var(--text-faint)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OrreryUniverseBuilder
// ---------------------------------------------------------------------------

export function OrreryUniverseBuilder({ graphData, initialConfig, onLaunch, onClose }: Props) {
  // Derive available databases from graph data
  const databases = useMemo<DbInfo[]>(() => {
    if (!graphData) return [];
    const map = new Map<string, DbInfo>();
    for (const node of graphData.nodes) {
      const existing = map.get(node.databaseId);
      if (existing) {
        existing.count++;
      } else {
        map.set(node.databaseId, {
          id: node.databaseId,
          name: node.databaseName,
          color: node.color,
          count: 1,
        });
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [graphData]);

  // Form state — pre-fill from initialConfig
  const [galaxyDb, setGalaxyDb] = useState(initialConfig?.tierMapping.galaxyDatabaseId ?? "");
  const [starDb, setStarDb] = useState(initialConfig?.tierMapping.starDatabaseId ?? "");
  const [planetDb, setPlanetDb] = useState(initialConfig?.tierMapping.planetDatabaseId ?? "");
  const [moonDb, setMoonDb] = useState(initialConfig?.tierMapping.moonDatabaseId ?? "");
  const [ringDbs, setRingDbs] = useState<RingDatabaseMapping[]>(
    () => initialConfig?.tierMapping.ringDatabases ?? [],
  );

  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isValid = !!galaxyDb && !!starDb && !!planetDb && !!moonDb;
  const isReconfigure = !!initialConfig;

  // Collect IDs already used in mandatory tiers so we can mark them as in-use
  const usedMandatory = useMemo(() => new Set([galaxyDb, starDb, planetDb, moonDb].filter(Boolean)), [galaxyDb, starDb, planetDb, moonDb]);

  function addRingDb() {
    setRingDbs((prev) => [...prev, { databaseId: "", subType: "planet-rings" }]);
  }

  function updateRingDb(index: number, next: RingDatabaseMapping) {
    setRingDbs((prev) => prev.map((r, i) => (i === index ? next : r)));
  }

  function removeRingDb(index: number) {
    setRingDbs((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    setTouched(true);
    if (!isValid) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const body = {
        tierMapping: {
          galaxyDatabaseId: galaxyDb,
          starDatabaseId: starDb,
          planetDatabaseId: planetDb,
          moonDatabaseId: moonDb,
          ringDatabases: ringDbs.filter((r) => r.databaseId),
        },
      };
      const resp = await fetch("/api/orrery-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

  const mandatoryTiers = [
    { index: 1, label: "Galaxy",  description: "each record becomes a galaxy",          value: galaxyDb, set: setGalaxyDb },
    { index: 2, label: "Star",    description: "each record becomes a star",             value: starDb,   set: setStarDb },
    { index: 3, label: "Planet",  description: "each record becomes a planet",           value: planetDb, set: setPlanetDb },
    { index: 4, label: "Moon",    description: "each record becomes a moon",             value: moonDb,   set: setMoonDb },
  ];

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(5, 6, 13, 0.88)",
        backdropFilter: "blur(8px)",
        padding: 24,
      }}
    >
      {/* Card */}
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 560,
          maxHeight: "90vh",
          overflowY: "auto",
          background: "var(--bg-raised)",
          border: "1px solid var(--border-default)",
          borderRadius: 16,
          boxShadow: "var(--shadow-panel)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "28px 32px 20px",
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div>
              <h2 style={{
                ...LORA,
                margin: 0,
                fontSize: 22,
                fontWeight: 600,
                color: "var(--text-primary)",
                letterSpacing: "-0.02em",
                lineHeight: 1.2,
              }}>
                Universe Builder
              </h2>
              <p style={{
                ...GEIST,
                margin: "6px 0 0",
                fontSize: 13,
                color: "var(--text-muted)",
                fontWeight: 300,
                lineHeight: 1.5,
              }}>
                Map your Notion databases to cosmic tiers to generate your living universe.
              </p>
            </div>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                title="Close"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  border: "1px solid var(--border-default)",
                  background: "transparent",
                  color: "var(--text-faint)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 16,
                  flexShrink: 0,
                }}
              >
                ×
              </button>
            )}
          </div>

          {databases.length === 0 && (
            <div style={{
              marginTop: 12,
              padding: "8px 12px",
              background: "var(--bg-overlay)",
              borderRadius: 8,
              border: "1px solid var(--border-subtle)",
            }}>
              <span style={{ ...MONO, fontSize: 11, color: "var(--text-faint)" }}>
                No graph data loaded. Run{" "}
                <code style={{ background: "var(--bg-base)", padding: "1px 4px", borderRadius: 3 }}>
                  npm run sync
                </code>{" "}
                to pull your Notion data.
              </span>
            </div>
          )}
        </div>

        {/* Body */}
        <div style={{ padding: "24px 32px", display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Mandatory tiers */}
          <div>
            <div style={{ ...MONO, fontSize: 10, color: "var(--text-faint)", letterSpacing: "0.10em", textTransform: "uppercase", marginBottom: 14 }}>
              Required — four cosmic tiers
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {mandatoryTiers.map((tier) => (
                <TierRow
                  key={tier.label}
                  index={tier.index}
                  label={tier.label}
                  description={tier.description}
                  value={tier.value}
                  databases={databases}
                  usedIds={usedMandatory}
                  error={touched && !tier.value}
                  onChange={tier.set}
                />
              ))}
            </div>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: "var(--border-subtle)" }} />

          {/* Optional rings section */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={labelStyle(false)}>
                <span style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 18,
                  height: 18,
                  borderRadius: 4,
                  background: "var(--bg-overlay)",
                  border: "1px solid var(--border-default)",
                  color: "var(--text-muted)",
                  fontSize: 10,
                  fontWeight: 700,
                  flexShrink: 0,
                }}>
                  5
                </span>
                Ring / Asteroid Databases
                <span style={{ color: "var(--text-faint)", fontWeight: 300, textTransform: "none", fontSize: 10 }}>
                  — optional, multi-select
                </span>
              </div>
              <button
                type="button"
                onClick={addRingDb}
                style={{
                  ...GEIST,
                  height: 28,
                  padding: "0 12px",
                  borderRadius: 6,
                  border: "1px solid var(--border-default)",
                  background: "transparent",
                  color: "var(--text-muted)",
                  fontSize: 11,
                  fontWeight: 500,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  transition: "border-color 0.12s, color 0.12s",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = "var(--accent-warm)";
                  (e.currentTarget as HTMLElement).style.color = "var(--accent-warm)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = "var(--border-default)";
                  (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
                }}
              >
                <span style={{ fontSize: 14, lineHeight: 1 }}>+</span>
                Add database
              </button>
            </div>

            {ringDbs.length === 0 ? (
              <div style={{
                padding: "12px 14px",
                background: "var(--bg-overlay)",
                borderRadius: 8,
                border: "1px dashed var(--border-subtle)",
                textAlign: "center",
              }}>
                <span style={{ ...MONO, fontSize: 11, color: "var(--text-faint)" }}>
                  No ring databases — universe will launch without rings or asteroid belts.
                </span>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {ringDbs.map((mapping, i) => (
                  <RingRow
                    key={i}
                    mapping={mapping}
                    databases={databases}
                    onChange={(next) => updateRingDb(i, next)}
                    onRemove={() => removeRingDb(i)}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => setRingDbs([])}
                  style={{
                    ...GEIST,
                    alignSelf: "flex-start",
                    background: "none",
                    border: "none",
                    color: "var(--text-faint)",
                    fontSize: 11,
                    cursor: "pointer",
                    padding: "2px 0",
                    textDecoration: "underline",
                    textUnderlineOffset: 3,
                  }}
                >
                  Skip — no rings
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: "16px 32px 24px",
          borderTop: "1px solid var(--border-subtle)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexShrink: 0,
        }}>
          <div style={{ flex: 1 }}>
            {submitError && (
              <span style={{ ...MONO, fontSize: 11, color: "var(--accent-warm)" }}>
                {submitError}
              </span>
            )}
            {touched && !isValid && !submitError && (
              <span style={{ ...MONO, fontSize: 11, color: "var(--accent-warm)" }}>
                Select all four required databases to continue.
              </span>
            )}
            {isValid && !submitError && (
              <span style={{ ...MONO, fontSize: 10, color: "var(--text-faint)" }}>
                {databases.length} database{databases.length !== 1 ? "s" : ""} available
                {ringDbs.filter((r) => r.databaseId).length > 0
                  ? ` · ${ringDbs.filter((r) => r.databaseId).length} ring database${ringDbs.filter((r) => r.databaseId).length !== 1 ? "s" : ""} configured`
                  : ""}
              </span>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {onClose && (
              <button type="button" onClick={onClose} style={btnSecondary()}>
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || (touched && !isValid)}
              style={btnPrimary(submitting || (touched && !isValid))}
            >
              {submitting
                ? "Saving…"
                : isReconfigure
                ? "Enter Universe"
                : "Launch Universe"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
