import { useEffect, useRef, useState } from "react";

const BUBBLE_COUNT = 6;
const randomBetween = (a, b) => a + Math.random() * (b - a);
const createBubble = (id) => ({
  id, x: randomBetween(5, 95), y: randomBetween(5, 95),
  size: randomBetween(120, 200), vx: randomBetween(-0.08, 0.08),
  vy: randomBetween(-0.12, -0.02), opacity: randomBetween(0.25, 0.4),
  hue: randomBetween(200, 260), phase: randomBetween(0, Math.PI * 2),
});

export default function App() {
  const canvasRef = useRef(null);
  const bubblesRef = useRef(Array.from({ length: BUBBLE_COUNT }, (_, i) => createBubble(i)));
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const animRef = useRef(null);
  const timeRef = useRef(0);
  const [screen, setScreen] = useState("home");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [messages, setMessages] = useState([]);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const userMsg = { text: "Screenshot uploaded", sender: "user", image: event.target?.result };
        setMessages([...messages, userMsg]);
        
        setTimeout(() => {
          const generatedCode = `<div class="container">
  <header class="navbar">
    <h1>Your App</h1>
  </header>
  <main class="content">
    <section class="hero">
      <h2>Welcome</h2>
      <p>Your generated code here</p>
    </section>
  </main>
</div>

<style>
  .container { max-width: 1200px; margin: 0 auto; }
  .navbar { background: #333; color: white; padding: 1rem; }
  .content { padding: 2rem; }
  .hero { text-align: center; }
</style>`;
          const botMsg = { text: "Code generated successfully!", sender: "bot", code: generatedCode };
          setMessages(prev => [...prev, botMsg]);
        }, 1500);
      };
      reader.readAsDataURL(file);
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener("resize", resize);

    const onMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    canvas.addEventListener("mousemove", onMouseMove);

    const animate = () => {
      timeRef.current += 0.012;
      const t = timeRef.current;
      const W = canvas.width, H = canvas.height;
      const mx = mouseRef.current.x, my = mouseRef.current.y;

      ctx.clearRect(0, 0, W, H);
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, "#f0f2f5"); bg.addColorStop(0.5, "#ffffff"); bg.addColorStop(1, "#f0f2f5");
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

      bubblesRef.current.forEach((b) => {
        b.x += b.vx + Math.sin(t * 0.7 + b.phase) * 0.08;
        b.y += b.vy + Math.cos(t * 0.5 + b.phase) * 0.06;

        const bpx = (b.x / 100) * W, bpy = (b.y / 100) * H;
        const dx = bpx - mx, dy = bpy - my;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const repelRadius = 150;
        if (dist < repelRadius && dist > 0) {
          const force = ((repelRadius - dist) / repelRadius) * 1.5;
          b.x += ((dx / dist) * force * 0.5 * 100) / W;
          b.y += ((dy / dist) * force * 0.4 * 100) / H;
        }

        if (b.y < -15) { b.y = 110; b.x = randomBetween(5, 95); }
        if (b.x < -10) b.x = 105;
        if (b.x > 110) b.x = -5;

        const px = (b.x / 100) * W, py = (b.y / 100) * H, r = b.size;
        const proximity = Math.max(0, 1 - dist / 300);
        const dynamicOpacity = b.opacity + proximity * 0.3;
        const dynamicHue = b.hue + proximity * 20;

        const glow = ctx.createRadialGradient(px, py, 0, px, py, r * 1.6);
        glow.addColorStop(0, `hsla(${dynamicHue}, 80%, 65%, ${dynamicOpacity * 0.5})`);
        glow.addColorStop(0.5, `hsla(${dynamicHue}, 80%, 60%, ${dynamicOpacity * 0.25})`);
        glow.addColorStop(1, `hsla(${dynamicHue}, 80%, 55%, 0)`);
        ctx.beginPath(); ctx.arc(px, py, r * 1.6, 0, Math.PI * 2);
        ctx.fillStyle = glow; ctx.fill();

        const grad = ctx.createRadialGradient(px - r * 0.35, py - r * 0.35, r * 0.15, px, py, r);
        grad.addColorStop(0, `hsla(${dynamicHue}, 90%, 72%, ${dynamicOpacity * 0.8})`);
        grad.addColorStop(0.5, `hsla(${dynamicHue}, 85%, 58%, ${dynamicOpacity * 0.5})`);
        grad.addColorStop(1, `hsla(${dynamicHue}, 80%, 48%, ${dynamicOpacity * 0.15})`);
        ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fillStyle = grad; ctx.fill();

        const shine = ctx.createRadialGradient(px - r * 0.4, py - r * 0.4, 0, px - r * 0.4, py - r * 0.4, r * 0.55);
        shine.addColorStop(0, `rgba(255,255,255,${0.6 + proximity * 0.25})`);
        shine.addColorStop(0.35, "rgba(255,255,255,0.15)");
        shine.addColorStop(1, "rgba(255,255,255,0)");
        ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fillStyle = shine; ctx.fill();
      });

      if (mx > 0 && my > 0) {
        const ringPulse = (Math.sin(t * 3) + 1) / 2;
        ctx.beginPath(); ctx.arc(mx, my, 15 + ringPulse * 6, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(24, 119, 242, ${0.2 + ringPulse * 0.15})`;
        ctx.lineWidth = 1; ctx.stroke();
        ctx.beginPath(); ctx.arc(mx, my, 3, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(24, 119, 242, 0.6)"; ctx.fill();
      }

      animRef.current = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("mousemove", onMouseMove);
      cancelAnimationFrame(animRef.current);
    };
  }, []);

  return (
    <div style={{ width: "100vw", height: "100vh", background: "#f0f2f5", position: "relative", overflow: "hidden", fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif" }}>
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
      
      {screen === "home" && !isLoggedIn && (
        <div style={{
          position: "relative", zIndex: 10, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", height: "100%",
          color: "#1c1e21", textAlign: "center", gap: "2rem"
        }}>
          <div style={{ fontSize: "2.8rem", fontWeight: 700, letterSpacing: "-0.02em", color: "#1877f2" }}>
            Screenshot to Code
          </div>
          <div style={{ fontSize: "1rem", color: "#606770", maxWidth: "450px", lineHeight: "1.7", fontWeight: 400 }}>
            Convert your UI screenshots into clean, production-ready HTML and CSS code instantly
          </div>
          <button
            onClick={() => setScreen("login")}
            style={{
              padding: "0.85rem 2.5rem", borderRadius: "8px",
              border: "none", background: "#1877f2", color: "white",
              fontSize: "1rem", fontWeight: 600, cursor: "pointer",
              transition: "all 0.3s", boxShadow: "0 4px 15px rgba(24, 119, 242, 0.3)"
            }}
            onMouseEnter={(e) => { e.target.style.background = "#166fe5"; e.target.style.boxShadow = "0 6px 20px rgba(24, 119, 242, 0.4)"; }}
            onMouseLeave={(e) => { e.target.style.background = "#1877f2"; e.target.style.boxShadow = "0 4px 15px rgba(24, 119, 242, 0.3)"; }}
          >
            Get Started
          </button>
        </div>
      )}

      {screen === "login" && !isLoggedIn && (
        <div style={{
          position: "relative", zIndex: 10, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", height: "100%",
          color: "#1c1e21", gap: "2rem"
        }}>
          <div style={{ fontSize: "2rem", fontWeight: 700, color: "#1877f2" }}>Login</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "1.2rem", width: "320px" }}>
            <input
              type="email"
              placeholder="Email"
              style={{
                padding: "0.85rem", borderRadius: "8px", border: "1px solid #dddfe2",
                fontSize: "0.95rem", outline: "none", transition: "all 0.2s",
                background: "#ffffff", color: "#1c1e21"
              }}
              onFocus={(e) => { e.target.style.borderColor = "#1877f2"; e.target.style.boxShadow = "0 0 0 3px rgba(24, 119, 242, 0.1)"; }}
              onBlur={(e) => { e.target.style.borderColor = "#dddfe2"; e.target.style.boxShadow = "none"; }}
            />
            <input
              type="password"
              placeholder="Password"
              style={{
                padding: "0.85rem", borderRadius: "8px", border: "1px solid #dddfe2",
                fontSize: "0.95rem", outline: "none", transition: "all 0.2s",
                background: "#ffffff", color: "#1c1e21"
              }}
              onFocus={(e) => { e.target.style.borderColor = "#1877f2"; e.target.style.boxShadow = "0 0 0 3px rgba(24, 119, 242, 0.1)"; }}
              onBlur={(e) => { e.target.style.borderColor = "#dddfe2"; e.target.style.boxShadow = "none"; }}
            />
            <button
              onClick={() => { setIsLoggedIn(true); setScreen("chat"); }}
              style={{
                padding: "0.85rem", borderRadius: "8px", border: "none",
                background: "#1877f2", color: "white", fontSize: "1rem",
                fontWeight: 600, cursor: "pointer", transition: "all 0.3s",
                boxShadow: "0 4px 15px rgba(24, 119, 242, 0.3)"
              }}
              onMouseEnter={(e) => { e.target.style.background = "#166fe5"; e.target.style.boxShadow = "0 6px 20px rgba(24, 119, 242, 0.4)"; }}
              onMouseLeave={(e) => { e.target.style.background = "#1877f2"; e.target.style.boxShadow = "0 4px 15px rgba(24, 119, 242, 0.3)"; }}
            >
              Login
            </button>
          </div>
          <button
            onClick={() => setScreen("home")}
            style={{
              background: "none", border: "none", color: "#1877f2",
              cursor: "pointer", fontSize: "0.95rem", textDecoration: "underline",
              transition: "color 0.2s"
            }}
            onMouseEnter={(e) => e.target.style.color = "#166fe5"}
            onMouseLeave={(e) => e.target.style.color = "#1877f2"}
          >
            Back
          </button>
        </div>
      )}

      {screen === "chat" && isLoggedIn && (
        <div style={{
          position: "relative", zIndex: 10, display: "flex", flexDirection: "column",
          height: "100%", color: "#1c1e21"
        }}>
          <div style={{
            padding: "1.5rem 2rem", borderBottom: "1px solid #dddfe2",
            display: "flex", justifyContent: "space-between", alignItems: "center",
            background: "rgba(255, 255, 255, 0.8)", backdropFilter: "blur(10px)"
          }}>
            <div style={{ fontSize: "1.3rem", fontWeight: 700, color: "#1877f2" }}>Screenshot to Code</div>
            <button
              onClick={() => { setIsLoggedIn(false); setScreen("home"); setMessages([]); }}
              style={{
                background: "none", border: "none", color: "#606770",
                cursor: "pointer", fontSize: "0.95rem", transition: "color 0.2s"
              }}
              onMouseEnter={(e) => e.target.style.color = "#1c1e21"}
              onMouseLeave={(e) => e.target.style.color = "#606770"}
            >
              Logout
            </button>
          </div>

          <div style={{
            flex: 1, overflowY: "auto", padding: "2rem", display: "flex",
            flexDirection: "column", gap: "1.2rem", background: "#f0f2f5"
          }}>
            {messages.length === 0 && (
              <div style={{
                margin: "auto", textAlign: "center", color: "#606770",
                fontSize: "1rem"
              }}>
                <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>📸</div>
                <div>Upload a screenshot to generate code</div>
              </div>
            )}
            {messages.map((msg, idx) => (
              <div key={idx} style={{
                alignSelf: msg.sender === "user" ? "flex-end" : "flex-start",
                maxWidth: "75%"
              }}>
                {msg.image && (
                  <img src={msg.image} style={{
                    maxWidth: "100%", borderRadius: "10px", border: "1px solid #dddfe2",
                    marginBottom: "0.75rem", boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)"
                  }} alt="uploaded" />
                )}
                {msg.code ? (
                  <div style={{
                    padding: "1.2rem", borderRadius: "10px",
                    background: "#ffffff", border: "1px solid #dddfe2",
                    color: "#1c1e21", fontSize: "0.8rem", fontFamily: "monospace",
                    maxHeight: "280px", overflowY: "auto", boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)"
                  }}>
                    <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{msg.code}</pre>
                  </div>
                ) : (
                  <div style={{
                    padding: "0.85rem 1.2rem", borderRadius: "10px",
                    background: msg.sender === "user" ? "#e7f3ff" : "#f0f2f5",
                    color: "#1c1e21", fontSize: "0.95rem", border: msg.sender === "user" ? "1px solid #1877f2" : "1px solid #dddfe2"
                  }}>
                    {msg.text}
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          <div style={{
            padding: "1.5rem 2rem", borderTop: "1px solid #dddfe2",
            display: "flex", gap: "1rem", background: "rgba(255, 255, 255, 0.8)", backdropFilter: "blur(10px)"
          }}>
            <label style={{
              flex: 1, padding: "0.85rem", borderRadius: "8px",
              border: "1px solid #dddfe2", background: "#f0f2f5",
              color: "#606770", fontSize: "0.95rem", cursor: "pointer",
              textAlign: "center", transition: "all 0.2s"
            }}
            onMouseEnter={(e) => { e.target.style.borderColor = "#1877f2"; e.target.style.background = "#e7f3ff"; }}
            onMouseLeave={(e) => { e.target.style.borderColor = "#dddfe2"; e.target.style.background = "#f0f2f5"; }}
            >
              📁 Upload Screenshot
              <input
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                style={{ display: "none" }}
              />
            </label>
            <button
              style={{
                padding: "0.85rem 1.8rem", borderRadius: "8px",
                border: "none", background: "#1877f2", color: "white",
                cursor: "pointer", fontSize: "0.95rem", fontWeight: 600,
                transition: "all 0.3s", boxShadow: "0 4px 15px rgba(24, 119, 242, 0.3)"
              }}
              onMouseEnter={(e) => { e.target.style.background = "#166fe5"; e.target.style.boxShadow = "0 6px 20px rgba(24, 119, 242, 0.4)"; }}
              onMouseLeave={(e) => { e.target.style.background = "#1877f2"; e.target.style.boxShadow = "0 4px 15px rgba(24, 119, 242, 0.3)"; }}
            >
              Copy Code
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
