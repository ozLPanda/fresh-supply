type SessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const PROMPT_KEY = "company_shop_push_prompt_user";

// One invitation for this signed-in user in this tab/app session, including page reloads.
export function createPushPromptSession(storage?: SessionStorage) {
  let shownFor: number | undefined;
  let ignoreStoredMarker = false;
  return {
    claim(userId: number) {
      if (shownFor === userId) return false;
      try {
        if (!ignoreStoredMarker && storage?.getItem(PROMPT_KEY) === String(userId)) {
          shownFor = userId;
          return false;
        }
        storage?.setItem(PROMPT_KEY, String(userId));
        ignoreStoredMarker = false;
      } catch {
        // Still suppress repeated invitations when browser storage is unavailable.
      }
      shownFor = userId;
      return true;
    },
    reset() {
      shownFor = undefined;
      ignoreStoredMarker = true;
      try {
        storage?.removeItem(PROMPT_KEY);
      } catch {
        // The in-memory session is also reset on logout.
      }
    },
  };
}

function sessionStorageOrUndefined() {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

export const pushPromptSession = createPushPromptSession(sessionStorageOrUndefined());
