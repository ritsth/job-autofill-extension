type ErrorButton = Pick<HTMLButtonElement, 'textContent' | 'title'>;

// Compact-label limits per button context. Named and single-sourced so the two
// inline call sites cannot drift apart, and so the badge's shorter limit records
// why it differs instead of reading as arbitrary. Neither value changes what is
// recoverable: showButtonError always puts the complete message in the title.

/** Inline "✨ AI answer" button, which sits in the page's own form width. */
export const INLINE_ANSWER_ERROR_MAX = 40;
/** The badge's "AI check" button, inside a fixed 230px card (see renderBadge). */
export const BADGE_AI_CHECK_ERROR_MAX = 32;

const pendingErrors = new WeakMap<ErrorButton, { timer: ReturnType<typeof setTimeout>; title: string }>();

/** Remove a previous error's tooltip and timer before a retry changes the label. */
export function clearButtonError(button: ErrorButton): void {
  const pending = pendingErrors.get(button);
  if (!pending) return;
  clearTimeout(pending.timer);
  button.title = pending.title;
  pendingErrors.delete(button);
}

/** Keep the label compact, but make the full recovery instructions available on hover. */
export function showButtonError(
  button: ErrorButton,
  message: string,
  restoreLabel: string,
  maxLength: number,
  duration = 4000,
): void {
  clearButtonError(button);
  const title = button.title;
  button.textContent = '⚠ ' + message.slice(0, maxLength);
  button.title = message;
  const timer = setTimeout(() => {
    button.textContent = restoreLabel;
    button.title = title;
    pendingErrors.delete(button);
  }, duration);
  pendingErrors.set(button, { timer, title });
}
