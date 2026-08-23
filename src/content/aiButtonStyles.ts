// Styling for the injected "✨ AI answer" button, kept in its own module so the
// hardening below can be unit-tested (src/content/index.ts runs side effects at
// import time and can't be loaded from a test).

export const BUTTON_CLASS = 'jaf-ai-btn';

/**
 * Stylesheet for the injected button, written to survive the host page's CSS.
 *
 * Unlike the eligibility badge, this button can't hide in a Shadow DOM — it has
 * to sit inline right after its textarea, and injectQuestionButtons' structural
 * reconciliation depends on it being that literal sibling. So it lives in the
 * host's cascade, dropped into the middle of an ATS form, which is exactly where
 * sites style their own buttons hardest.
 *
 * Two defences:
 *
 * - `button.<class>` rather than `.<class>`, so ordinary host rules like
 *   `.application button` or `button.btn` no longer outrank us on specificity.
 * - `!important` on the properties whose loss makes the feature SILENTLY absent
 *   rather than merely ugly: a host `display: none` / `visibility: hidden` reset
 *   or a `color` matching our background means the user never learns the button
 *   exists. Cosmetics (padding, radius, font-size) stay overridable on purpose —
 *   a slightly off-looking button is a cost worth paying to blend into the form.
 *
 * `font-family` is pinned because it's inherited: without a declaration here the
 * button silently takes whatever font the surrounding form sets, and no host rule
 * has to target the button at all for that to happen.
 *
 * Residual gap: `!important` doesn't beat specificity between two important
 * declarations, so an ID-scoped host rule (`#app button { display: none
 * !important }`) still wins. Only Shadow DOM closes that, at the cost of the
 * sibling reconciliation above.
 */
export const AI_BUTTON_CSS = `
  button.${BUTTON_CLASS} {
    display: inline-flex !important;
    visibility: visible !important;
    opacity: 1 !important;
    color: #fff !important;
    background: #44506b !important;
    align-items: center; gap: 4px;
    margin: 6px 0; padding: 5px 10px;
    font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    font-size: 12px; font-weight: 600;
    border: none; border-radius: 6px;
    cursor: pointer; line-height: 1.2;
  }
  button.${BUTTON_CLASS}:hover { background: #333c52 !important; }
  button.${BUTTON_CLASS}:disabled { opacity: .7 !important; cursor: default; }
`;
