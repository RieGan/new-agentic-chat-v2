# Agentic Chat Operations Console Design System

## 0. Research Log

- Embedded refs: shortlisted Sentry, Warp, and IBM Carbon; picked the operational taste rules plus Sentry because its warm dark monitoring surfaces fit persisted event inspection. Marketing-scale type, glass, lime, and purple accents were intentionally removed.
- UI/UX database: accessibility-first app guidance confirmed a 4px spacing base, 44px controls, visible labels, native controls, textual status, and adaptive single-column reflow.
- Lazyweb: skipped because this task's exact architecture-validation contract and deterministic fixtures are the reference; anonymous-token external screenshot retrieval was not necessary for an internal MVP console.
- Imagen drafts: skipped because no image-generation tool is available and an operations console should be validated as live DOM, not against a decorative concept image.

## 1. Atmosphere & Identity

A compact event ledger for engineers validating durable agent behavior. It feels calm, exact, and inspectable rather than theatrical. The signature is a cyan left-edge signal rail that connects connection state, active runs, and canonical events without turning every item into a card. Design variance is 4, motion intensity is 2, and visual density is 8.

## 2. Color

| Role | Token | Value | Usage |
|---|---|---|---|
| Canvas | `--color-canvas` | `#111315` | App background |
| Surface | `--color-surface` | `#181b1e` | Primary panels |
| Surface raised | `--color-surface-raised` | `#202428` | Controls and selected rows |
| Surface quiet | `--color-surface-quiet` | `#15181a` | Recessed logs |
| Text | `--color-text` | `#f1f3f2` | Primary content |
| Text muted | `--color-text-muted` | `#aeb6b4` | Secondary content |
| Text quiet | `--color-text-quiet` | `#98a29f` | Tertiary metadata |
| Border | `--color-border` | `#353b3e` | Structural boundaries |
| Border strong | `--color-border-strong` | `#525b5e` | Control boundaries |
| Signal | `--color-signal` | `#58d6d1` | Primary actions, focus, live state |
| Signal ink | `--color-signal-ink` | `#092a2a` | Text on signal |
| Success | `--color-success` | `#82d49a` | Completed, connected |
| Warning | `--color-warning` | `#e3bd72` | Waiting, recovery |
| Danger | `--color-danger` | `#ed8d88` | Failed, reject |
| Info | `--color-info` | `#8bb8e8` | Queued, neutral progress |

Colors are semantic tokens only. Status always includes readable text. Signal is reserved for focus, selected state, links, and the primary action.

## 3. Typography

| Level | Token | Size | Weight | Line height | Usage |
|---|---|---:|---:|---:|---|
| Page title | `--text-title` | `1.75rem` | 650 | 1.1 | Route heading |
| Section | `--text-section` | `1.125rem` | 650 | 1.25 | Panel heading |
| Body | `--text-body` | `1rem` | 400 | 1.55 | Messages and forms |
| Small | `--text-small` | `0.875rem` | 450 | 1.45 | Supporting text |
| Label | `--text-label` | `0.75rem` | 650 | 1.35 | Metadata and state |
| Code | `--text-code` | `0.8125rem` | 500 | 1.5 | IDs, hashes, versions |

- UI stack: `"IBM Plex Sans", "Aptos", "Segoe UI", system-ui, sans-serif`.
- Data stack: `"IBM Plex Mono", "SFMono-Regular", Consolas, monospace`.
- Uppercase is limited to short metadata labels. IDs and numbers use tabular mono figures.

## 4. Spacing & Layout

All intent spacing uses a 4px base: `--space-1` 4px, `--space-2` 8px, `--space-3` 12px, `--space-4` 16px, `--space-5` 20px, `--space-6` 24px, `--space-8` 32px, `--space-10` 40px, `--space-12` 48px.

- Max content width: `--layout-max` 1440px.
- Shell: fixed header, body owns document scroll, no nested primary scrolling on mobile.
- Desktop inspector: `minmax(15rem, 19rem) minmax(0, 1fr)` list-detail grid.
- Desktop chat: `minmax(0, 1fr) minmax(17rem, 22rem)` workspace grid.
- Below 768px every grid becomes one column, navigation wraps, actions remain at least 44px, and no primary content scrolls horizontally.
- Long IDs and unbroken hashes wrap with `overflow-wrap: anywhere`.

## 5. Components

### App Shell
- Structure: visually clipped skip link until focused, header with product label and native anchors, main route region.
- States: active navigation uses `aria-current="page"`; links have hover, active, and focus-visible states.
- Spacing: `--space-3`, `--space-4`, `--space-6`.
- Layout: document scroll; header remains sticky only on wide screens.

### Panel
- Structure: semantic section with optional header and content stack.
- Variants: default, quiet, selected.
- States: empty, loading, and error are textual content, not spinners.
- Depth: tonal shift plus one border, never glass or decorative shadow.

### Action
- Structure: native button or anchor.
- Variants: primary, secondary, danger, quiet.
- States: hover, active, focus-visible, disabled, busy.
- Accessibility: minimum 44px block size; busy state is text and `disabled`.

### Field
- Structure: visible label, native input/select/textarea, helper or error line.
- States: default, focus, disabled, invalid.
- Accessibility: labels bind with `htmlFor`; errors use `role="alert"`.

### Session Controls
- Structure: a visible Session label with a native select composed beside the secondary New session action.
- States: loading, ready, creating, and unavailable; session changes clear the prior message and run surfaces immediately.
- Layout: select and action share a compact row on desktop and reflow to one full-width column below 768px.
- Accessibility: native keyboard behavior, visible focus, and 44px targets come from the existing Field and Action primitives.

### Status Label
- Structure: text label with an optional short context value.
- Variants: neutral, active, success, warning, danger.
- Accessibility: meaning is always in text; no color-only dot.

### Event Ledger
- Structure: ordered list of canonical events with type, sequence, and safe payload summary.
- States: empty, live append, duplicate ignored.
- Accessibility: status ledger is separate from the completed-message `role="log"`.

### Message Log
- Structure: `role="log"`, polite live updates, complete user/assistant articles only.
- States: empty and populated.
- Accessibility: `aria-relevant="additions text"`; no partial text or token-stream path.

### Approval Card
- Structure: heading, exact prepared snapshot definition list, decision forms.
- States: pending, approving, rejecting, approved, rejected, stale/error.
- Accessibility: native forms preserve focused controls while the resolved card remains mounted.

## 6. Motion & Interaction

- `--motion-fast` 120ms ease-out for hover, focus, and press feedback.
- `--motion-standard` 180ms ease-in-out for state-color changes only.
- No entrance, ambient, looping, or layout animation.
- Only color, opacity, and transform may transition. `prefers-reduced-motion: reduce` removes all transitions.

## 7. Depth & Surface

Mixed tonal-shift and borders. Canvas, surface, raised control, and quiet log are four deliberate levels. Panels use one 1px border and no box shadow. The cyan rail is a structural active-state marker, not decoration.

## 8. Accessibility Constraints & Accepted Debt

- Target WCAG 2.2 AA: 4.5:1 normal text, 3:1 large text and controls, persistent 2px focus ring, keyboard-native forms, 44px targets, zoom-safe responsive reflow, textual async states, and reduced-motion compliance.
- Route changes set the document title; native links preserve browser behavior.
- User content and Admin content never share client state. User boundary parsing rejects non-User projections and discards hidden SSE variants before storage.

### Accepted Debt

None.
