import type { FocusEvent } from "react";

export function selectNumericInputOnFocus(event: FocusEvent<HTMLInputElement>) {
  const input = event.currentTarget;
  input.select();

  // Money inputs replace their formatted display value after focus.
  requestAnimationFrame(() => {
    if (document.activeElement === input) input.select();
  });
}
