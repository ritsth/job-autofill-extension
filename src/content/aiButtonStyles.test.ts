import { describe, expect, it } from 'vitest';
import { AI_BUTTON_CSS, BUTTON_CLASS } from './aiButtonStyles';

/** Declarations of the rule with exactly this selector. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(AI_BUTTON_CSS);
  if (!m) throw new Error(`no rule for "${selector}"`);
  return m[1];
}

/** The declared value for a property, or undefined if the rule doesn't set it. */
function declaration(body: string, prop: string): string | undefined {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:([^;]*)`).exec(body);
  return m?.[1].trim();
}

const base = () => ruleBody(`button.${BUTTON_CLASS}`);

describe('AI-answer button styling vs. the host page', () => {
  // Listed here rather than imported from the source on purpose: this is an
  // independent statement of what must stay protected, so deleting a property
  // from the stylesheet fails the test instead of quietly shrinking its scope.
  const mustSurviveHostCss = ['display', 'visibility', 'opacity', 'color', 'background'];

  it.each(mustSurviveHostCss)('wins the cascade for %s', (prop) => {
    // Losing any of these hides the button or makes it unreadable, so the user
    // never discovers the feature — a silent failure, unlike a cosmetic clash.
    const value = declaration(base(), prop);
    expect(value, `${prop} is not declared`).toBeDefined();
    expect(value).toContain('!important');
  });

  it('qualifies the selector with the element so host rules stop outranking it', () => {
    // A bare `.jaf-ai-btn` is specificity (0,1,0) and loses to commonplace host
    // rules like `.application button` or `button.btn` at (0,1,1).
    expect(AI_BUTTON_CSS).toContain(`button.${BUTTON_CLASS}`);
    expect(AI_BUTTON_CSS).not.toMatch(new RegExp(`(^|[^.\\w-])\\.${BUTTON_CLASS}`, 'm'));
  });

  it('pins font-family so the surrounding form cannot lend it one', () => {
    // font-family is inherited, so with no declaration here the button picks up
    // the host's font without any host rule ever targeting the button.
    expect(declaration(base(), 'font-family')).toBeDefined();
  });

  it('keeps the disabled state dimmed despite the hardened base rule', () => {
    // Base sets `opacity: 1 !important`; without !important here too, the
    // in-flight button would stop looking disabled.
    expect(declaration(ruleBody(`button.${BUTTON_CLASS}:disabled`), 'opacity')).toContain(
      '!important',
    );
  });

  it('leaves cosmetic properties overridable so the button can blend in', () => {
    // Deliberate scope limit: !important is spent only on staying visible.
    for (const prop of ['padding', 'border-radius', 'font-size']) {
      expect(declaration(base(), prop), prop).not.toContain('!important');
    }
  });
});
