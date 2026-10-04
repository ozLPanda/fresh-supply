type OrderedLine = { localId: string; productGroupName?: string | null };

/** Reorder complete rows, preserving group membership and each group's slots. */
export function reorderWarehouseDocumentLine<T extends OrderedLine>(
  lines: T[],
  sourceId: string,
  targetId: string,
  placement: "before" | "after",
  grouped: boolean,
): T[] {
  if (sourceId === targetId) return lines;
  const source = lines.find((line) => line.localId === sourceId);
  const target = lines.find((line) => line.localId === targetId);
  if (!source || !target) return lines;
  const groupName = (line: T) => line.productGroupName?.trim() ?? "";
  if (grouped && groupName(source) !== groupName(target)) return lines;
  const belongs = (line: T) => !grouped || groupName(line) === groupName(source);
  const reordered = lines.filter((line) => belongs(line) && line.localId !== sourceId);
  const targetIndex = reordered.findIndex((line) => line.localId === targetId);
  reordered.splice(targetIndex + (placement === "after" ? 1 : 0), 0, source);
  let index = 0;
  return lines.map((line) => (belongs(line) ? reordered[index++] : line));
}
