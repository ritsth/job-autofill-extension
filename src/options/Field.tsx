// Labelled form row for the options page. Kept in its own module so it can be
// unit-tested without pulling in the rest of Options.tsx (which imports the PDF
// text extractor and therefore needs browser globals).

import { Children, cloneElement, isValidElement, useId } from 'react';

const LABELABLE_TAGS = new Set(['input', 'select', 'textarea']);

/**
 * Returns `node` with `id` set on the first labelable element in its tree, or
 * null when it contains none. Searching the whole tree (not just the top node)
 * means wrapping a control — e.g. putting an input in a flex row next to a
 * Show/Hide button — keeps it associated with its <label> instead of silently
 * dropping the htmlFor.
 */
function withControlId(node: React.ReactNode, id: string): React.ReactElement | null {
  if (!isValidElement(node)) return null;
  const el = node as React.ReactElement<{ children?: React.ReactNode; id?: string }>;

  if (typeof el.type === 'string' && LABELABLE_TAGS.has(el.type)) {
    return cloneElement(el, { id });
  }

  const kids = Children.toArray(el.props.children);
  for (let i = 0; i < kids.length; i++) {
    const replaced = withControlId(kids[i], id);
    if (replaced === null) continue;
    const next = [...kids];
    next[i] = replaced;
    return cloneElement(el, undefined, ...next);
  }
  return null;
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId();
  const childArray = Children.toArray(children);
  const [first, ...rest] = childArray;

  const associated = withControlId(first, id);

  if (associated === null) {
    // No form control in here (e.g. a div of buttons like the Account field) —
    // keep the plain label rather than force an incorrect htmlFor.
    return (
      <div className="field">
        <label>{label}</label>
        {children}
      </div>
    );
  }

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {associated}
      {rest}
    </div>
  );
}
