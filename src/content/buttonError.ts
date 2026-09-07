type ErrorButton = Pick<HTMLButtonElement, 'textContent' | 'title'>;

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
