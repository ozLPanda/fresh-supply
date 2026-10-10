/** Remember every observed ID for this user's running session, including read
 * items, so pagination changes and permission changes cannot replay old alerts. */
export function createDesktopNotificationTracker() {
  let currentUserId: number | undefined;
  let knownIds: Set<number> | undefined;
  return {
    observe<T extends { id: number; read: boolean }>(items: T[], userId?: number): T[] {
      if (!knownIds || userId !== currentUserId) {
        currentUserId = userId;
        knownIds = new Set(items.map((item) => item.id));
        return [];
      }
      const fresh = items.filter((item) => !item.read && !knownIds!.has(item.id));
      for (const item of items) knownIds.add(item.id);
      return fresh;
    },
  };
}

export function internalNotificationTarget(value?: string): string | undefined {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u001f]/.test(value)
  ) {
    return;
  }
  try {
    const base = "https://notification.internal";
    const target = new URL(value, base);
    if (target.origin !== base) return;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return;
  }
}
