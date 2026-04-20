import { useState } from "react";
import { Copy, Check, Save, Code2, Eye, Loader2, Download } from "lucide-react";
import { toast } from "./Toast";
import Button from "./Button";

export default function CodeBlock({ code, onSave, saving, saved }) {
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState("code");

  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      toast.success("Code copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const download = () => {
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([code], { type: "text/html" })),
      download: "generated.html"
    });
    a.click();
    URL.revokeObjectURL(a.href);
    toast.info("Downloaded as generated.html");
  };

  return (
    <div style={{
      borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)",
      background: "#0d0d18", overflow: "hidden", width: "100%"
    }}>
      {/* Toolbar */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "0.55rem 0.9rem", borderBottom: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(255,255,255,0.02)", flexWrap: "wrap", gap: 6
      }}>
        <div style={{ display: "flex", gap: 3 }}>
          {[["code", <Code2 size={12} />, "Code"], ["preview", <Eye size={12} />, "Preview"]].map(([t, icon, label]) => (
            <button key={t} onClick={() => setTab(t)} style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "0.28rem 0.7rem", borderRadius: 6, border: "none",
              background: tab === t ? "rgba(99,102,241,0.18)" : "transparent",
              color: tab === t ? "#818cf8" : "#475569",
              fontSize: "0.75rem", fontWeight: 600, cursor: "pointer",
              transition: "all 0.15s", fontFamily: "inherit"
            }}>
              {icon} {label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 5 }}>
          <button aria-label="Copy code" onClick={copy} style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "0.28rem 0.7rem", borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.07)",
            background: copied ? "rgba(16,185,129,0.12)" : "rgba(255,255,255,0.03)",
            color: copied ? "#6ee7b7" : "#64748b",
            fontSize: "0.73rem", cursor: "pointer", transition: "all 0.15s", fontFamily: "inherit"
          }}>
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button aria-label="Download as HTML file" onClick={download} style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "0.28rem 0.7rem", borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.07)",
            background: "rgba(255,255,255,0.03)", color: "#64748b",
            fontSize: "0.73rem", cursor: "pointer", transition: "all 0.15s", fontFamily: "inherit"
          }}>
            <Download size={11} /> Download
          </button>
          <button aria-label="Save code to history" onClick={onSave} disabled={saving || saved} style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "0.28rem 0.7rem", borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.07)",
            background: saved ? "rgba(16,185,129,0.12)" : "rgba(255,255,255,0.03)",
            color: saved ? "#6ee7b7" : saving ? "#334155" : "#64748b",
            fontSize: "0.73rem", cursor: saving || saved ? "default" : "pointer",
            transition: "all 0.15s", fontFamily: "inherit"
          }}>
            {saving ? <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> : <Save size={11} />}
            {saved ? "Saved" : saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {tab === "code" ? (
        <pre style={{
          margin: 0, padding: "1rem 1.25rem",
          fontSize: "0.74rem", fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          whiteSpace: "pre-wrap", overflowY: "auto",
          maxHeight: "clamp(200px, 40vh, 340px)",
          color: "#c4b5fd", lineHeight: 1.75, background: "transparent"
        }}>
          {code}
        </pre>
      ) : (
        <iframe
          srcDoc={code}
          title="Generated HTML preview"
          sandbox="allow-scripts"
          style={{ width: "100%", height: "clamp(200px, 40vh, 340px)", border: "none", display: "block", background: "#fff" }}
        />
      )}
    </div>
  );
}
