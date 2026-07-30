# `@absolutejs/handoff`

Storage-neutral correlation and evidence for work that leaves your application.

A handoff starts in your code, continues in an external system, and may return
through a callback, reconciliation, or a customer report. `@absolutejs/handoff`
keeps those observations joined without pretending your application can inspect
an external page directly.

## Install

```sh
bun add @absolutejs/handoff
```

## Correlation

```ts
import {
  handoffCorrelationFrom,
  withHandoffCorrelation,
} from "@absolutejs/handoff";

const metadata = withHandoffCorrelation(
  { campaign: "summer" },
  crypto.randomUUID(),
);

// Services with fixed metadata slots can name the slot explicitly.
const gatewayFields = withHandoffCorrelation(
  { field_1: "campaign" },
  crypto.randomUUID(),
  "field_20",
);

const correlationId = handoffCorrelationFrom(gatewayFields, "field_20");
```

## Evidence and reconciliation

```ts
import { summarizeHandoff } from "@absolutejs/handoff";

const summary = summarizeHandoff([
  {
    at: Date.now(),
    correlationId: "invoice-123",
    operation: "invoice_payment",
    outcome: "succeeded",
    service: "gateway",
    source: "callback",
  },
  {
    at: Date.now() + 1,
    correlationId: "invoice-123",
    message: "The hosted page displayed an error",
    operation: "invoice_payment",
    outcome: "failed",
    service: "gateway",
    source: "external_surface_report",
  },
]);

// The callback remains authoritative while the customer-visible contradiction
// remains actionable.
console.log(summary.status); // "succeeded"
console.log(summary.contradiction); // true
```

`external_api`, `callback`, and `reconciliation` evidence is authoritative.
`external_surface_report` evidence records what a customer or operator saw
without silently overriding external-system truth.

## Recording

`createHandoffRecorder()` accepts optional storage and observer contracts.
Recording returns per-sink delivery state instead of throwing when an
observability sink fails, so visibility cannot break the business operation.
The recorder also exposes low-cardinality counters by source and outcome.

Messages and references redact payment-number-shaped text and bearer
credentials. Applications must still keep raw callbacks, credentials, payment
details, and customer data in their own protected stores.

## Package boundaries

`@absolutejs/handoff` owns the shared protocol. Domain packages keep their own
meaning and adapters:

- Commerce decides what paid, declined, and settled mean.
- Dispatch decides what sent, bounced, and complained mean.
- CRM decides what synchronized or conflicted means.
- Voice and Meeting decide what joined, recorded, and transcribed mean.

Those packages translate external-system evidence into this neutral vocabulary.

## License

MIT
