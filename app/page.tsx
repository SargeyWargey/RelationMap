"use client";

import { useState } from "react";
import Link from "next/link";
import { useTheme } from "@/components/ThemeProvider";
import { WorkspaceConfigModal } from "@/components/WorkspaceConfigModal";

export default function HomePage() {
  const { darkMode, toggleDarkMode } = useTheme();
  const [configOpen, setConfigOpen] = useState(false);

  return (
    <main
      style={{
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Top-right controls */}
      <div
        style={{
          position: "absolute",
          top: 20,
          right: 24,
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        {/* Configure workspaces button */}
        <button
          type="button"
          onClick={() => setConfigOpen(true)}
          title="Configure workspaces"
          style={{
            height: 28,
            padding: "0 12px",
            borderRadius: 8,
            border: "1px solid var(--border-default)",
            background: "var(--panel-bg)",
            backdropFilter: "blur(12px)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            fontFamily: "'Geist', sans-serif",
            fontWeight: 500,
            color: "var(--text-muted)",
            transition: "background 0.15s, color 0.15s, border-color 0.15s",
            boxShadow: "var(--shadow-sm)",
            whiteSpace: "nowrap",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--bg-overlay)";
            (e.currentTarget as HTMLElement).style.color = "var(--text-primary)";
            (e.currentTarget as HTMLElement).style.borderColor = "var(--accent-warm)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--panel-bg)";
            (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
            (e.currentTarget as HTMLElement).style.borderColor = "var(--border-default)";
          }}
        >
          <span style={{ fontSize: 13 }}>⚙</span>
          Configure
        </button>

        {/* Dark mode toggle */}
        <button
          type="button"
          onClick={toggleDarkMode}
          title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            border: "1px solid var(--border-default)",
            background: "var(--panel-bg)",
            backdropFilter: "blur(12px)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
            color: "var(--text-muted)",
            transition: "background 0.15s, color 0.15s",
            boxShadow: "var(--shadow-sm)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--bg-overlay)";
            (e.currentTarget as HTMLElement).style.color = "var(--text-primary)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--panel-bg)";
            (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
          }}
        >
          {darkMode ? "☀" : "◑"}
        </button>
      </div>

      {/* Logo + umbrella brand */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          marginBottom: 56,
        }}
        className="animate-fade-up"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/PimaryIcon.png" alt="Logo" style={{ width: 120, height: 120, objectFit: "contain" }} />
        <span style={{
          fontFamily: "'Lora', Georgia, serif",
          fontSize: 28,
          fontWeight: 600,
          color: "var(--text-primary)",
          letterSpacing: "-0.02em",
        }}>
          Data Visualizer
        </span>
        <span style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 12,
          color: "var(--text-faint)",
          fontWeight: 300,
          letterSpacing: "0.02em",
        }}>
          choose a mode to get started
        </span>
      </div>

      {/* Mode tiles */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          gap: 20,
          alignItems: "stretch",
        }}
        className="animate-fade-up home-tiles"
      >
        <ModeTile
          href="/graph"
          title="Project Graph"
          subtitle="notion graph"
          description="Explore relationships between your Notion data as an interactive 3D graph."
          icon="/GraphIcon2.png"
        />
        <ModeTile
          href="/project-city"
          title="Project City"
          subtitle="navigate your data"
          description="A new way to visualize and navigate your projects. Coming soon."
          icon="/PimaryIcon.png"
        />
      </div>

      <style>{`
        @media (max-width: 640px) {
          .home-tiles {
            flex-direction: column !important;
          }
        }
      `}</style>

      {/* Workspace config modal */}
      {configOpen && <WorkspaceConfigModal onClose={() => setConfigOpen(false)} />}
    </main>
  );
}

function ModeTile({
  href,
  title,
  subtitle,
  description,
  icon,
}: {
  href: string;
  title: string;
  subtitle: string;
  description: string;
  icon?: string;
}) {
  return (
    <Link href={href} style={{ textDecoration: "none" }}>
      <div
        style={{
          width: 260,
          padding: "32px 28px",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-default)",
          borderRadius: 16,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          cursor: "pointer",
          boxShadow: "var(--shadow-sm)",
          transition: "box-shadow 0.2s, border-color 0.2s, transform 0.2s",
        }}
        onMouseEnter={(e) => {
          const el = e.currentTarget as HTMLElement;
          el.style.boxShadow = "var(--shadow-md)";
          el.style.borderColor = "var(--accent-warm)";
          el.style.transform = "translateY(-2px)";
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget as HTMLElement;
          el.style.boxShadow = "var(--shadow-sm)";
          el.style.borderColor = "var(--border-default)";
          el.style.transform = "translateY(0)";
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{
            fontFamily: "'Lora', Georgia, serif",
            fontSize: 18,
            fontWeight: 600,
            color: "var(--text-primary)",
            letterSpacing: "-0.01em",
            lineHeight: 1.3,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}>
            {icon && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={icon} alt="" style={{ width: 22, height: 22, objectFit: "contain", flexShrink: 0 }} />
            )}
            {title}
          </span>
          <span style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 10,
            color: "var(--accent-warm)",
            fontWeight: 400,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}>
            {subtitle}
          </span>
        </div>
        <p style={{
          margin: 0,
          fontFamily: "'Geist', sans-serif",
          fontSize: 13,
          color: "var(--text-muted)",
          fontWeight: 300,
          lineHeight: 1.6,
        }}>
          {description}
        </p>
        <div style={{
          marginTop: 4,
          display: "flex",
          alignItems: "center",
          gap: 4,
          color: "var(--accent-warm)",
          fontFamily: "'Geist', sans-serif",
          fontSize: 12,
          fontWeight: 500,
        }}>
          <span>Open</span>
          <span style={{ fontSize: 14, lineHeight: 1 }}>→</span>
        </div>
      </div>
    </Link>
  );
}
