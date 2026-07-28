import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Field } from './Field';

// renderToStaticMarkup needs no DOM, so these stay in the default node env.
// Assert on the rendered HTML rather than internals: what matters is that the
// <label for> and the control's id actually agree in the output.
const html = (node: React.ReactElement): string => renderToStaticMarkup(node);

/** The `for` on the rendered <label>, or null when it has none. */
function labelFor(markup: string): string | null {
  return /<label[^>]*\bfor="([^"]*)"/.exec(markup)?.[1] ?? null;
}

/** The id of the first element carrying one, or null. */
function firstId(markup: string): string | null {
  return /\bid="([^"]*)"/.exec(markup)?.[1] ?? null;
}

/** True when the label points at a control that exists with that exact id. */
function isAssociated(markup: string): boolean {
  const target = labelFor(markup);
  if (target === null) return false;
  return new RegExp(`<(?:input|select|textarea)[^>]*\\bid="${target}"`).test(markup);
}

describe('Field — label/control association', () => {
  it('associates a bare input child', () => {
    const markup = html(
      <Field label="Email">
        <input value="" readOnly />
      </Field>,
    );
    expect(isAssociated(markup)).toBe(true);
    expect(labelFor(markup)).toBe(firstId(markup));
  });

  it('associates an input wrapped in a layout div beside a button', () => {
    // Regression guard: the secret-field Show/Hide toggles wrap the input in a
    // flex row. A top-node-only check sees a <div>, drops the htmlFor, and the
    // field silently loses its label — clicking it no longer focuses the input.
    const markup = html(
      <Field label="Gemini API key">
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="password" value="" readOnly />
          <button type="button" aria-label="Show API key">
            Show
          </button>
        </div>
        <div className="help">Get a free key…</div>
      </Field>,
    );
    expect(isAssociated(markup)).toBe(true);
  });

  it('associates select and textarea too', () => {
    const select = html(
      <Field label="Provider">
        <select value="gemini" onChange={() => {}}>
          <option value="gemini">Gemini</option>
        </select>
      </Field>,
    );
    expect(isAssociated(select)).toBe(true);

    const textarea = html(
      <Field label="Template">
        <textarea value="" readOnly />
      </Field>,
    );
    expect(isAssociated(textarea)).toBe(true);
  });

  it('targets the first control when the wrapper holds several', () => {
    const markup = html(
      <Field label="Range">
        <div>
          <input name="from" value="" readOnly />
          <input name="to" value="" readOnly />
        </div>
      </Field>,
    );
    const target = labelFor(markup);
    expect(new RegExp(`<input[^>]*name="from"[^>]*id="${target}"`).test(markup)).toBe(true);
  });

  it('leaves the label unassociated when there is no form control', () => {
    // The Account field is a div of status text + buttons; forcing an htmlFor
    // at nothing would be worse than omitting it.
    const markup = html(
      <Field label="Account">
        <div>
          <span>Signed in</span>
          <button type="button">Sign out</button>
        </div>
      </Field>,
    );
    expect(labelFor(markup)).toBeNull();
    expect(markup).toContain('Sign out');
  });

  it('keeps the trailing help siblings in the output', () => {
    const markup = html(
      <Field label="Admin token">
        <div>
          <input value="" readOnly />
        </div>
        <div className="help">Leave blank for normal use.</div>
      </Field>,
    );
    expect(isAssociated(markup)).toBe(true);
    expect(markup).toContain('Leave blank for normal use.');
  });
});
