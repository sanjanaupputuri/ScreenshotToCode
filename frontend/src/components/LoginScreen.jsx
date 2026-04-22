import { useState } from "react";
import Logo from "./Logo";
import { ArrowLeft, Loader2 } from "lucide-react";

const GoogleIcon = () => (
  <svg width="17" height="17" viewBox="0 0 18 18" aria-hidden="true">
    <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
    <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
    <path fill="#FBBC05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.348 2.825.957 4.039l3.007-2.332z"/>
    <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z"/>
  </svg>
);

export default function LoginScreen({ onLogin, onBack, error }) {
  const [signingIn, setSigningIn] = useState(false);

  const handleLogin = async () => {
    setSigningIn(true);
    await onLogin();
    setSigningIn(false);
  };

  return (
    <div style={{
      height: "100vh", background: "var(--bg)",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      position: "relative", padding: "1.5rem"
    }}>
      <div style={{ width: "100%", maxWidth: 400, animation: "fadeUp 0.4s ease" }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14, margin: "0 auto 1.1rem",
            background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 8px 28px rgba(99,102,241,0.35)"
          }}>
            <Logo size="icon" />
          </div>
          <h1 style={{
            margin: 0, fontSize: "1.55rem", fontWeight: 800, letterSpacing: "-0.02em",
            background: "linear-gradient(135deg, #f1f5f9, #a5b4fc)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent"
          }}>Welcome back</h1>
          <p style={{ margin: "0.5rem 0 0", color: "var(--text-muted)", fontSize: "0.88rem" }}>
            Sign in to start converting screenshots to code
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 16, padding: "2rem",
          backdropFilter: "blur(20px)"
        }}>
          {error && (
            <div
              role="alert"
              aria-live="assertive"
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "0.75rem 1rem", borderRadius: 8, marginBottom: "1.25rem",
                background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)",
                color: "#fca5a5", fontSize: "0.83rem"
              }}
            >
              <span aria-hidden="true">⚠</span> {error}
            </div>
          )}

          <button
            onClick={handleLogin}
            disabled={signingIn}
            aria-label="Continue with Google"
            style={{
              width: "100%", padding: "0.85rem 1.5rem", borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.06)",
              color: "var(--text-primary)", fontSize: "0.92rem", fontWeight: 600,
              cursor: signingIn ? "not-allowed" : "pointer", transition: "all 0.2s",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              fontFamily: "inherit", opacity: signingIn ? 0.7 : 1
            }}
            onMouseEnter={e => { if (!signingIn) { e.currentTarget.style.background = "rgba(255,255,255,0.1)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)"; }}}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)"; }}
          >
            {signingIn
              ? <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Signing in…</>
              : <><GoogleIcon /> Continue with Google</>
            }
          </button>

          <p style={{
            margin: "1.25rem 0 0", textAlign: "center",
            fontSize: "0.75rem", color: "var(--text-faint)", lineHeight: 1.6
          }}>
            By signing in you agree to our{" "}
            <span style={{ color: "var(--text-muted)", textDecoration: "underline", cursor: "pointer" }}>Terms of Service</span>
          </p>
        </div>

        <button
          onClick={onBack}
          className="btn-ghost"
          style={{ display: "flex", margin: "1.25rem auto 0", border: "none", background: "none", fontSize: "0.85rem" }}
        >
          <ArrowLeft size={14} /> Back to home
        </button>
      </div>
    </div>
  );
}
