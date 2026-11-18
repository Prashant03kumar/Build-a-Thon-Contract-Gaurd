# Contract Guard — Dashboard Design (M5)

The UI is a single-page React dashboard served by the same Express server that
exposes the API (one container, same origin — no CORS anywhere). It renders
**only real data** from the backend; there are no mocks, fixtures or seeded UI
state.

## Layout

```
┌────────────────────────────────────────────────────────────────┐
│ CG  Contract Guard                    ● All systems ok         │  header + health pill
├────────────────────────────────────────────────────────────────┤
│ [Import kit] [Run analyze] [Retry notifications]  last result  │  actions (real pipeline)
├──────────────┬──────────────┬──────────────┬──────────────────┤
│ Providers 3  │ Versions 12  │ Consumers 4  │ Breaking 11      │  overview cards
├──────────────┴──────────────┴──────────────┴──────────────────┤
│ PUBLISHING GATE — latest version of each provider              │
│  quote-api v2.1.0 [ALLOWED]   policy-api v2.1.0 [BLOCKED] …    │  verdict + affected consumers
├────────────────────────────────────────────────────────────────┤
│ PROVIDERS & VERSIONS — per publish slot:                       │
│  # · version · file · valid/invalid · gate badge · findings    │  full timeline
├────────────────────────────────────────────────────────────────┤
│ FINDINGS (22) — severity chip · version pair · path · message  │
│                 affects [mobile-app] ● delivered / ○ pending   │  merged impacts + notified
├──────────────────────────────────────┬─────────────────────────┤
│ CONSUMERS — team · calls · affected  │ WEBHOOK — delivered/    │
│                                      │ pending · retry · link  │
└──────────────────────────────────────┴─────────────────────────┘
```

## Design system (Tailwind v4, matches M0)

- Surface: `gray-50` page, white `rounded-xl border shadow-sm` cards, `max-w-6xl`.
- Severity color language (from `../PLAN.md` §9):
  BREAKING = red · WARN/DEPRECATION/SUNSET = amber · SPEC_ERROR = blue ·
  EARLY_REMOVAL = violet · INFO = gray · ALLOWED = emerald · BLOCKED = red.
- Dots: green = delivered to webhook receiver, amber = pending (BREAKING only).
- Responsive: cards collapse 4→2→1 columns (`sm`/`lg` breakpoints); tables scroll
  horizontally on narrow screens.

## Data flow

1. On load: `providers`, `consumers`, `impacts`, `findings` fetched in parallel.
2. `/api/impacts` carries `affectedConsumers` but not the `notified` flag;
   `/api/findings` carries `notified` but not consumers — the client merges the
   two by finding id (`mergeFindings` in `api/client.ts`). No backend change needed.
3. Gate verdicts: one `POST /api/gate-check {provider, publishOrder}` per **valid**
   version (publishOrder avoids the claims-api "1.1.0 is ambiguous" case). Invalid
   specs are never checked — the UI badges them INVALID SPEC directly.
4. Health polls every 5 s (same rhythm as the receiver's own page); pipeline data
   reloads after each action button.

## Why no router / state library

Six sections fit one scrollable page; adding react-router or a data library would
buy nothing at this size. Shared bits live in `components/ui.tsx` (Card, StatCard,
SeverityChip, GateBadge, ValidBadge, ConsumerChip, NotifyDot).
