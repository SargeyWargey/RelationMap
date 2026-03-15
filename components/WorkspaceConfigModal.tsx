"use client";

import { useEffect, useRef, useState } from "react";
import type { NotionWorkspace } from "@/lib/types";

type Props = {
  onClose: () => void;
};

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function WorkspaceConfigModal({ onClose }: Props) {
  const [workspaces, setWorkspaces] = useState<NotionWorkspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);

  // Load settings on mount
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        const ws: NotionWorkspace[] = data.workspaces ?? [];
        if (data.warnings?.length) setWarnings(data.warnings);

        if (ws.length > 0) {
          setWorkspaces(ws);
          const active = data.activeWorkspaceId ?? ws[0].id;
          setActiveWorkspaceId(active);
          setExpandedId(active);
        } else if (data.notionToken || data.rootPages?.length) {
          // Migrate legacy
          const legacy: NotionWorkspace = {
            id: "default",
            name: "Primary Workspace",
            notionToken: data.notionToken ?? "",
            rootPages: data.rootPages?.length > 0 ? data.rootPages : [""],
          };
          setWorkspaces([legacy]);
          setActiveWorkspaceId("default");
          setExpandedId("default");
        } else {
          // Empty state — create a blank workspace
          const blank: NotionWorkspace = {
            id: generateId(),
            name: "Primary Workspace",
            notionToken: "",
            rootPages: [""],
          };
          setWorkspaces([blank]);
          setActiveWorkspaceId(blank.id);
          setExpandedId(blank.id);
        }
      })
      .catch(() => {});
  }, []);

  // Close on backdrop click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  function addWorkspace() {
    const newWs: NotionWorkspace = {
      id: generateId(),
      name: `Workspace ${workspaces.length + 1}`,
      notionToken: "",
      rootPages: [""],
    };
    setWorkspaces((prev) => [...prev, newWs]);
    setExpandedId(newWs.id);
  }

  function removeWorkspace(id: string) {
    const remaining = workspaces.filter((w) => w.id !== id);
    setWorkspaces(remaining);
    if (activeWorkspaceId === id) setActiveWorkspaceId(remaining[0]?.id ?? "");
    if (expandedId === id) setExpandedId(remaining[0]?.id ?? null);
  }

  function updateWorkspace(id: string, updates: Partial<NotionWorkspace>) {
    setWorkspaces((prev) => prev.map((w) => (w.id === id ? { ...w, ...updates } : w)));
  }

  function addRootPage(wsId: string) {
    const ws = workspaces.find((w) => w.id === wsId);
    if (!ws) return;
    updateWorkspace(wsId, { rootPages: [...ws.rootPages, ""] });
  }

  function removeRootPage(wsId: string, idx: number) {
    const ws = workspaces.find((w) => w.id === wsId);
    if (!ws) return;
    updateWorkspace(wsId, { rootPages: ws.rootPages.filter((_, i) => i !== idx) });
  }

  function updateRootPage(wsId: string, idx: number, value: string) {
    const ws = workspaces.find((w) => w.id === wsId);
    if (!ws) return;
    updateWorkspace(wsId, { rootPages: ws.rootPages.map((p, i) => (i === idx ? value : p)) });
  }

  async function handleSave() {
    setSaving(true);
    setSaveStatus("idle");
    try {
      const cleaned = workspaces.map((w) => ({
        ...w,
        rootPages: w.rootPages.filter((p) => p.trim()),
      }));
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaces: cleaned, activeWorkspaceId }),
      });
      setSaveStatus(res.ok ? "saved" : "error");
    } catch {
      setSaveStatus("error");
    } finally {
      setSaving(false);
      setTimeout(() => setSaveStatus("idle"), 2500);
    }
  }

  async function handleSync() {
    // Save first, then sync
    setSaving(true);
    setSaveStatus("idle");
    try {
      const cleaned = workspaces.map((w) => ({
        ...w,
        rootPages: w.rootPages.filter((p) => p.trim()),
      }));
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaces: cleaned, activeWorkspaceId }),
      });
    } catch {
      // ignore save error, still try sync
    } finally {
      setSaving(false);
    }

    setSyncing(true);
    setSyncStatus(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setSyncStatus(`Synced — ${data.nodeCount} nodes, ${data.edgeCount} edges`);
        // Refresh warnings from the new graph
        fetch("/api/settings").then((r) => r.json()).then((d) => setWarnings(d.warnings ?? [])).catch(() => {});
      } else {
        setSyncStatus(`Error: ${data.error ?? "unknown"}`);
      }
    } catch {
      setSyncStatus("Sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        backdropFilter: "blur(6px)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        ref={modalRef}
        style={{
          width: 500,
          maxHeight: "85vh",
          background: "var(--panel-bg)",
          backdropFilter: "blur(24px)",
          border: "1px solid var(--border-default)",
          borderRadius: 18,
          boxShadow: "var(--shadow-lg)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            padding: "22px 24px 16px",
            borderBottom: "1px solid var(--border-subtle)",
            flexShrink: 0,
          }}
        >
          <div>
            <span
              style={{
                fontFamily: "'Lora', Georgia, serif",
                fontSize: 17,
                fontWeight: 600,
                color: "var(--text-primary)",
                letterSpacing: "-0.01em",
                display: "block",
              }}
            >
              Workspace Configuration
            </span>
            <p
              style={{
                margin: "4px 0 0",
                fontFamily: "'Geist', sans-serif",
                fontSize: 12,
                color: "var(--text-faint)",
                lineHeight: 1.5,
              }}
            >
              Connect your Notion workspaces. Select the active workspace to sync from.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              flexShrink: 0,
              width: 28,
              height: 28,
              borderRadius: 8,
              border: "1px solid var(--border-default)",
              background: "transparent",
              color: "var(--text-muted)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              lineHeight: 1,
              marginLeft: 12,
            }}
          >
            ×
          </button>
        </div>

        {/* Workspace list */}
        <div style={{ overflowY: "auto", flex: 1, padding: "16px 24px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {workspaces.map((ws) => (
              <WorkspaceCard
                key={ws.id}
                workspace={ws}
                isActive={ws.id === activeWorkspaceId}
                isExpanded={ws.id === expandedId}
                onSetActive={() => setActiveWorkspaceId(ws.id)}
                onToggleExpand={() =>
                  setExpandedId((prev) => (prev === ws.id ? null : ws.id))
                }
                onRemove={workspaces.length > 1 ? () => removeWorkspace(ws.id) : undefined}
                onUpdateName={(name) => updateWorkspace(ws.id, { name })}
                onUpdateToken={(notionToken) => updateWorkspace(ws.id, { notionToken })}
                onAddRootPage={() => addRootPage(ws.id)}
                onRemoveRootPage={(idx) => removeRootPage(ws.id, idx)}
                onUpdateRootPage={(idx, val) => updateRootPage(ws.id, idx, val)}
              />
            ))}
          </div>

          {/* Sync warnings from last sync */}
          {warnings.length > 0 && (
            <div
              style={{
                marginTop: 12,
                padding: "10px 14px",
                background: "rgba(196,146,58,0.08)",
                border: "1px solid rgba(196,146,58,0.3)",
                borderRadius: 10,
              }}
            >
              <p style={{
                margin: "0 0 6px",
                fontFamily: "'DM Mono', monospace",
                fontSize: 10,
                fontWeight: 500,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "rgba(196,146,58,0.8)",
              }}>
                Last Sync Warnings
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {warnings.map((w, i) => (
                  <p key={i} style={{
                    margin: 0,
                    fontFamily: "'Geist', sans-serif",
                    fontSize: 11,
                    color: "var(--accent-gold, #c4923a)",
                    lineHeight: 1.5,
                  }}>
                    · {w}
                  </p>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={addWorkspace}
            style={{
              marginTop: 12,
              padding: "9px 14px",
              width: "100%",
              fontFamily: "'Geist', sans-serif",
              fontSize: 12,
              fontWeight: 500,
              color: "var(--text-secondary)",
              background: "transparent",
              border: "1px dashed var(--border-default)",
              borderRadius: 10,
              cursor: "pointer",
              transition: "border-color 0.15s, color 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = "var(--accent-warm)";
              (e.currentTarget as HTMLElement).style.color = "var(--accent-warm)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = "var(--border-default)";
              (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)";
            }}
          >
            + Add workspace
          </button>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "14px 24px",
            borderTop: "1px solid var(--border-subtle)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: "7px 18px",
              fontFamily: "'Geist', sans-serif",
              fontSize: 12,
              fontWeight: 500,
              color: "#fff",
              background: "var(--accent-warm)",
              border: "none",
              borderRadius: 8,
              cursor: saving ? "not-allowed" : "pointer",
              opacity: saving ? 0.6 : 1,
              transition: "opacity 0.15s",
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing || saving}
            style={{
              padding: "7px 18px",
              fontFamily: "'Geist', sans-serif",
              fontSize: 12,
              fontWeight: 500,
              color: "var(--text-primary)",
              background: "var(--bg-overlay)",
              border: "1px solid var(--border-default)",
              borderRadius: 8,
              cursor: syncing || saving ? "not-allowed" : "pointer",
              opacity: syncing || saving ? 0.6 : 1,
              transition: "opacity 0.15s",
            }}
          >
            {syncing ? "Syncing…" : "Sync Now"}
          </button>

          <div style={{ flex: 1 }} />

          {saveStatus === "saved" && (
            <span
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 11,
                color: "var(--accent-sage)",
              }}
            >
              Saved.
            </span>
          )}
          {saveStatus === "error" && (
            <span
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 11,
                color: "var(--accent-warm)",
              }}
            >
              Failed to save.
            </span>
          )}
          {syncStatus && (
            <span
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 11,
                color: syncStatus.startsWith("Error") ? "var(--accent-warm)" : "var(--accent-sage)",
              }}
            >
              {syncStatus}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── WorkspaceCard ──────────────────────────────────────────────────────────────

function WorkspaceCard({
  workspace,
  isActive,
  isExpanded,
  onSetActive,
  onToggleExpand,
  onRemove,
  onUpdateName,
  onUpdateToken,
  onAddRootPage,
  onRemoveRootPage,
  onUpdateRootPage,
}: {
  workspace: NotionWorkspace;
  isActive: boolean;
  isExpanded: boolean;
  onSetActive: () => void;
  onToggleExpand: () => void;
  onRemove?: () => void;
  onUpdateName: (name: string) => void;
  onUpdateToken: (token: string) => void;
  onAddRootPage: () => void;
  onRemoveRootPage: (idx: number) => void;
  onUpdateRootPage: (idx: number, val: string) => void;
}) {
  return (
    <div
      style={{
        border: `1px solid ${isActive ? "var(--accent-warm)" : "var(--border-default)"}`,
        borderRadius: 12,
        background: "var(--bg-surface)",
        overflow: "hidden",
        transition: "border-color 0.15s",
      }}
    >
      {/* Card header row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "11px 14px",
          cursor: "pointer",
          userSelect: "none",
        }}
        onClick={onToggleExpand}
      >
        {/* Radio — set active */}
        <div
          onClick={(e) => {
            e.stopPropagation();
            onSetActive();
          }}
          title="Set as active workspace"
          style={{
            flexShrink: 0,
            width: 16,
            height: 16,
            borderRadius: "50%",
            border: `1.5px solid ${isActive ? "var(--accent-warm)" : "var(--border-default)"}`,
            background: isActive ? "var(--accent-warm)" : "transparent",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            transition: "background 0.12s, border-color 0.12s",
          }}
        >
          {isActive && (
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#fff",
              }}
            />
          )}
        </div>

        <span
          style={{
            flex: 1,
            fontFamily: "'Geist', sans-serif",
            fontSize: 13,
            fontWeight: 500,
            color: "var(--text-primary)",
          }}
        >
          {workspace.name || "Unnamed Workspace"}
        </span>

        {isActive && (
          <span
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 9,
              color: "var(--accent-warm)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              background: "rgba(196,100,58,0.1)",
              border: "1px solid rgba(196,100,58,0.25)",
              borderRadius: 4,
              padding: "2px 6px",
            }}
          >
            Active
          </span>
        )}

        <span
          style={{
            color: "var(--text-faint)",
            fontSize: 16,
            lineHeight: 1,
            transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.15s",
          }}
        >
          ›
        </span>
      </div>

      {/* Expanded form */}
      {isExpanded && (
        <div
          style={{
            padding: "12px 14px 14px",
            borderTop: "1px solid var(--border-subtle)",
            display: "flex",
            flexDirection: "column",
            gap: 0,
          }}
        >
          {/* Name */}
          <label style={cardLabelStyle}>Workspace Name</label>
          <input
            type="text"
            value={workspace.name}
            onChange={(e) => onUpdateName(e.target.value)}
            placeholder="My Notion Workspace"
            style={cardInputStyle}
            onClick={(e) => e.stopPropagation()}
          />

          {/* API Token */}
          <label style={{ ...cardLabelStyle, marginTop: 12 }}>API Token</label>
          <input
            type="password"
            value={workspace.notionToken}
            onChange={(e) => onUpdateToken(e.target.value)}
            placeholder="secret_..."
            style={cardInputStyle}
            onClick={(e) => e.stopPropagation()}
          />

          {/* Root Pages */}
          <label style={{ ...cardLabelStyle, marginTop: 12 }}>Root Pages</label>
          <p style={cardHintStyle}>
            Paste Notion page URLs or IDs. Databases nested under each page will be synced.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {workspace.rootPages.map((page, i) => (
              <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="text"
                  value={page}
                  onChange={(e) => onUpdateRootPage(i, e.target.value)}
                  placeholder="https://notion.so/… or page ID"
                  style={{ ...cardInputStyle, flex: 1, marginBottom: 0 }}
                  onClick={(e) => e.stopPropagation()}
                />
                {workspace.rootPages.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveRootPage(i);
                    }}
                    style={{
                      flexShrink: 0,
                      width: 22,
                      height: 22,
                      borderRadius: 6,
                      border: "1px solid var(--border-default)",
                      background: "transparent",
                      color: "var(--text-muted)",
                      fontSize: 16,
                      lineHeight: "1",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: 0,
                    }}
                    title="Remove page"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAddRootPage();
            }}
            style={{
              marginTop: 8,
              padding: "5px 10px",
              fontFamily: "'Geist', sans-serif",
              fontSize: 11,
              fontWeight: 500,
              color: "var(--text-secondary)",
              background: "transparent",
              border: "1px dashed var(--border-default)",
              borderRadius: 7,
              cursor: "pointer",
              width: "100%",
            }}
          >
            + Add page
          </button>

          {/* Remove workspace */}
          {onRemove && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              style={{
                marginTop: 14,
                padding: "5px 10px",
                fontFamily: "'Geist', sans-serif",
                fontSize: 11,
                fontWeight: 400,
                color: "rgba(196,100,58,0.8)",
                background: "transparent",
                border: "1px solid rgba(196,100,58,0.25)",
                borderRadius: 7,
                cursor: "pointer",
                width: "100%",
                transition: "border-color 0.15s, color 0.15s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.color = "var(--accent-warm)";
                (e.currentTarget as HTMLElement).style.borderColor = "rgba(196,100,58,0.5)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.color = "rgba(196,100,58,0.8)";
                (e.currentTarget as HTMLElement).style.borderColor = "rgba(196,100,58,0.25)";
              }}
            >
              Remove workspace
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Shared card styles ─────────────────────────────────────────────────────────

const cardLabelStyle: React.CSSProperties = {
  display: "block",
  fontFamily: "'Geist', sans-serif",
  fontSize: 11,
  fontWeight: 500,
  color: "var(--text-secondary)",
  marginBottom: 5,
};

const cardHintStyle: React.CSSProperties = {
  margin: "0 0 8px",
  fontFamily: "'Geist', sans-serif",
  fontSize: 11,
  color: "var(--text-faint)",
  lineHeight: 1.45,
};

const cardInputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  padding: "6px 10px",
  fontFamily: "'DM Mono', monospace",
  fontSize: 11,
  color: "var(--text-primary)",
  background: "var(--bg-raised)",
  border: "1px solid var(--border-default)",
  borderRadius: 7,
  outline: "none",
  marginBottom: 0,
};
