import { CSSProperties, HTMLAttributes, Key, ReactNode } from "react";
import "./AppTable.css";

export function AppTable({
  headers,
  rows,
  body,
  size = "default",
  className = "",
  style,
  rowKey,
  getRowProps,
}: {
  headers: string[];
  rows?: ReactNode[][];
  /** Use for semantic table bodies that need group rows or cells spanning columns. */
  body?: ReactNode;
  size?: "default" | "compact";
  className?: string;
  style?: CSSProperties;
  rowKey?: (row: ReactNode[], rowIndex: number) => Key;
  getRowProps?: (row: ReactNode[], rowIndex: number) => HTMLAttributes<HTMLTableRowElement>;
}) {
  return (
    <div className={`app-table-wrap app-table-wrap--${size}`}>
      <table className={`app-table app-table--${size} ${className}`} style={style}>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body ??
            (rows ?? []).map((row, rowIndex) => (
              <tr key={rowKey?.(row, rowIndex) ?? rowIndex} {...getRowProps?.(row, rowIndex)}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
