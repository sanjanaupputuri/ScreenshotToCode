import { Camera } from "lucide-react";

export default function Logo({ size = "md" }) {
  if (size === "icon") {
    return <Camera size={22} color="#fff" strokeWidth={2.5} />;
  }
  const s = size === "sm" ? 26 : 32;
  const fs = size === "sm" ? 13 : 16;
  const textSize = size === "sm" ? "0.9rem" : "1rem";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <div style={{
        width: s, height: s, borderRadius: 8,
        background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0
      }}>
        <Camera size={fs} color="#fff" strokeWidth={2.5} />
      </div>
      <span style={{ fontWeight: 800, fontSize: textSize, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>
        Screenshot<span style={{ color: "var(--accent-light)" }}>ToCode</span>
      </span>
    </div>
  );
}
