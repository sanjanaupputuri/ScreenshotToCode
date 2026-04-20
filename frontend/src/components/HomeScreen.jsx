import Logo from "./Logo";
import Button from "./Button";
import { Zap, Box, Code2, ArrowRight, GitBranch } from "lucide-react";

const features = [
  { Icon: Zap,   title: "OpenCV Detection",   desc: "Computer vision detects every UI element with precision using edge detection and OCR." },
  { Icon: Box,   title: "Template Matching",  desc: "SQLite-powered rule engine classifies components and maps Tailwind CSS classes instantly." },
  { Icon: Code2, title: "AI Code Generation", desc: "Ollama LLM produces semantic, accessible HTML & CSS — fully local, fully private." },
];

const stats = [
  ["8–15s", "Processing time"],
  ["3-Stage", "AI Pipeline"],
  ["100%", "Local & Private"],
];

const steps = [
  { n: "01", label: "Upload Screenshot", desc: "Drag & drop or paste any UI screenshot" },
  { n: "02", label: "AI Detects Elements", desc: "OpenCV + OCR identifies every component" },
  { n: "03", label: "Templates Matched", desc: "SQLite rules classify and map Tailwind classes" },
  { n: "04", label: "Code Generated", desc: "Ollama LLM outputs semantic HTML & CSS" },
];

export default function HomeScreen({ onGetStarted }) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", flexDirection: "column" }}>

      {/* Navbar */}
      <nav style={{
        padding: "1rem 2.5rem", display: "flex",
        justifyContent: "space-between", alignItems: "center",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        backdropFilter: "blur(12px)", position: "sticky", top: 0, zIndex: 10,
        background: "rgba(10,10,15,0.85)"
      }}>
        <Logo />
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            className="nav-link nav-github"
            aria-label="View project on GitHub"
          >
            <GitBranch size={14} /> GitHub
          </a>
          <Button variant="primary" onClick={onGetStarted}>
            Sign in <ArrowRight size={13} strokeWidth={2.5} />
          </Button>
        </div>
      </nav>

      {/* Hero */}
      <section className="hero-section" style={{
        flex: 1, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: "5rem 2rem 3rem", textAlign: "center",
        animation: "fadeUp 0.6s ease"
      }}>

        <h1 style={{
          fontSize: "clamp(2.4rem, 6vw, 4.2rem)", fontWeight: 800,
          lineHeight: 1.08, margin: "0 0 1.25rem", letterSpacing: "-0.03em",
          background: "linear-gradient(160deg, #f1f5f9 40%, #818cf8 100%)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent"
        }}>
          Screenshot to<br />Production Code
        </h1>

        <p style={{
          fontSize: "1.05rem", color: "var(--text-muted)", maxWidth: 460,
          lineHeight: 1.8, margin: "0 0 2.5rem"
        }}>
          Upload any UI screenshot and get clean, semantic HTML & CSS in seconds.
          Powered by OpenCV, SQLite, and Ollama — entirely on your machine.
        </p>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
          <button
            onClick={onGetStarted}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "0.85rem 2rem", borderRadius: 10,
              background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
              border: "none", color: "#fff", fontSize: "0.95rem",
              fontWeight: 700, cursor: "pointer", transition: "all 0.2s",
              boxShadow: "0 4px 24px rgba(99,102,241,0.35)", fontFamily: "inherit"
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 32px rgba(99,102,241,0.45)"; }}
            onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = "0 4px 24px rgba(99,102,241,0.35)"; }}
          >
            Get Started <ArrowRight size={16} strokeWidth={2.5} />
          </button>
        </div>

        {/* Stats */}
        <div className="stats-row" style={{
          display: "flex", gap: "2.5rem", marginTop: "3.5rem",
          flexWrap: "wrap", justifyContent: "center",
          padding: "1.5rem 2.5rem", borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(255,255,255,0.02)"
        }}>
          {stats.map(([val, label], i) => (
            <div key={label} style={{
              textAlign: "center",
              paddingRight: i < stats.length - 1 ? "2.5rem" : 0,
            }}>
              <div className="stats-divider" style={{
                position: "absolute", right: 0, top: "10%", height: "80%",
                width: 1, background: "rgba(255,255,255,0.07)",
                display: i < stats.length - 1 ? "block" : "none"
              }} />
              <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "var(--accent-light)", letterSpacing: "-0.02em" }}>{val}</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 3, fontWeight: 500 }}>{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section style={{ padding: "0 2.5rem 4rem", maxWidth: 900, margin: "0 auto", width: "100%" }}>
        <div style={{ textAlign: "center", marginBottom: "2.5rem" }}>
          <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--accent-light)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
            How it works
          </div>
          <h2 style={{ margin: 0, fontSize: "1.6rem", fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
            From screenshot to code in 4 steps
          </h2>
        </div>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", justifyContent: "center" }}>
          {steps.map(({ n, label, desc }, i) => (
            <div key={n} style={{ flex: "1 1 180px", maxWidth: 210, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 10 }}>
              <div style={{
                width: 44, height: 44, borderRadius: "50%",
                background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.25)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "0.75rem", fontWeight: 800, color: "var(--accent-light)", letterSpacing: "0.04em"
              }}>{n}</div>
              {i < steps.length - 1 && (
                <div style={{ display: "none" }} aria-hidden="true" />
              )}
              <div style={{ fontWeight: 700, color: "var(--text-primary)", fontSize: "0.88rem" }}>{label}</div>
              <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", lineHeight: 1.6 }}>{desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Feature cards */}
      <section className="feature-section" style={{
        display: "flex", gap: "1rem", padding: "0 2.5rem 4rem",
        justifyContent: "center", flexWrap: "wrap"
      }}>
        {features.map(({ Icon, title, desc }) => (
          <div key={title} className="card" style={{
            flex: "1 1 240px", maxWidth: 300, padding: "1.5rem", cursor: "default"
          }}>
            <div style={{
              width: 38, height: 38, borderRadius: 10, marginBottom: "0.9rem",
              background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.22)",
              display: "flex", alignItems: "center", justifyContent: "center"
            }}>
              <Icon size={17} color="var(--accent-light)" strokeWidth={2} />
            </div>
            <div style={{ fontWeight: 700, color: "var(--text-primary)", marginBottom: 6, fontSize: "0.92rem" }}>{title}</div>
            <div style={{ fontSize: "0.82rem", color: "var(--text-muted)", lineHeight: 1.65 }}>{desc}</div>
          </div>
        ))}
      </section>

      {/* Footer */}
      <footer style={{
        borderTop: "1px solid rgba(255,255,255,0.05)",
        padding: "1.5rem 2.5rem",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        flexWrap: "wrap", gap: 12,
        color: "var(--text-faint)", fontSize: "0.78rem"
      }}>
        <Logo size="sm" />
        <span>© {new Date().getFullYear()} ScreenshotToCode · Runs 100% locally</span>
        <a href="https://github.com" target="_blank" rel="noreferrer"
          style={{ color: "var(--text-muted)", textDecoration: "none" }}
          onMouseEnter={e => e.currentTarget.style.color = "var(--accent-light)"}
          onMouseLeave={e => e.currentTarget.style.color = "var(--text-muted)"}
        >
          GitHub ↗
        </a>
      </footer>
    </div>
  );
}
