export default function Button({ variant = "ghost", danger, children, className = "", ...props }) {
  const cls = variant === "primary" ? "btn-primary" : `btn-ghost${danger ? " danger" : ""}`;
  return (
    <button className={`${cls} ${className}`} {...props}>
      {children}
    </button>
  );
}
