export default function Skeleton({ height = 80, style = {} }) {
  return (
    <div
      className="skeleton"
      style={{ height, border: "1px solid rgba(255,255,255,0.05)", ...style }}
    />
  );
}
