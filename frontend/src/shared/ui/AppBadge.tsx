import { HTMLAttributes, ReactNode } from "react";
import "./AppBadge.css";

export function AppBadge({
  children,
  tone = "slate",
  className = "",
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
  tone?: "slate" | "green" | "orange" | "red" | "blue";
}) {
  return (
    <span className={`app-badge ${tone} ${className}`} {...props}>
      {children}
    </span>
  );
}
