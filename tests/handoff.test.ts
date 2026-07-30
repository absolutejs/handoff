import { describe, expect, test } from "bun:test";
import {
  createHandoffRecorder,
  handoffCorrelationFrom,
  memoryHandoffStore,
  sanitizeHandoffText,
  summarizeHandoff,
  withHandoffCorrelation,
  type HandoffEvidence,
} from "../src";

const correlationId = "invoice-123";

describe("handoff correlation", () => {
  test("round-trips through default and service-defined metadata fields", () => {
    const standard = withHandoffCorrelation(
      { campaign: "summer" },
      correlationId,
    );
    const fixed = withHandoffCorrelation(
      { field_1: "campaign" },
      correlationId,
      "field_20",
    );

    expect(handoffCorrelationFrom(standard)).toBe(correlationId);
    expect(handoffCorrelationFrom(fixed, "field_20")).toBe(correlationId);
    expect(fixed).toEqual({
      field_1: "campaign",
      field_20: correlationId,
    });
  });

  test("rejects malformed correlation containers and oversized identities", () => {
    expect(handoffCorrelationFrom(null)).toBe(null);
    expect(handoffCorrelationFrom([])).toBe(null);
    expect(handoffCorrelationFrom({ absolute_handoff_correlation: 42 })).toBe(
      null,
    );
    expect(
      handoffCorrelationFrom({
        absolute_handoff_correlation: "x".repeat(201),
      }),
    ).toBe(null);
  });
});

describe("handoff evidence", () => {
  test("keeps reported failures separate from authoritative success", () => {
    const evidence: HandoffEvidence[] = [
      {
        at: 1,
        correlationId,
        operation: "invoice_payment",
        outcome: "started",
        service: "gateway",
        source: "host",
      },
      {
        at: 2,
        correlationId,
        operation: "invoice_payment",
        outcome: "succeeded",
        service: "gateway",
        source: "callback",
      },
      {
        at: 3,
        correlationId,
        message: "Payment token does not exist",
        operation: "invoice_payment",
        outcome: "failed",
        service: "gateway",
        source: "external_surface_report",
      },
    ];

    expect(summarizeHandoff(evidence)).toMatchObject({
      authoritativeOutcome: "succeeded",
      contradiction: true,
      correlationId,
      operation: "invoice_payment",
      reportedOutcome: "failed",
      service: "gateway",
      status: "succeeded",
    });
  });

  test("does not mix operations that share a correlation identity", () => {
    expect(
      summarizeHandoff([
        {
          at: 1,
          correlationId,
          operation: "invoice_email",
          outcome: "failed",
          service: "gateway",
          source: "external_api",
        },
        {
          at: 2,
          correlationId,
          operation: "invoice_payment",
          outcome: "succeeded",
          service: "gateway",
          source: "callback",
        },
      ]),
    ).toMatchObject({
      contradiction: false,
      operation: "invoice_payment",
      status: "succeeded",
    });
  });

  test("redacts payment numbers and bearer credentials", () => {
    expect(
      sanitizeHandoffText(
        "card 4111 1111 1111 1111 Authorization Bearer secret.token",
      ),
    ).toBe("card [redacted payment number] Authorization Bearer [redacted]");
  });

  test("records without allowing sink failures to break host work", async () => {
    const store = memoryHandoffStore();
    const recorder = createHandoffRecorder({
      clock: () => 10,
      observer: () => {
        throw new Error("observer unavailable");
      },
      store,
    });
    const result = await recorder.record({
      correlationId,
      message: "token for 4111111111111111 failed",
      operation: "invoice_payment",
      outcome: "failed",
      service: "gateway",
      source: "external_surface_report",
    });

    expect(result.delivered).toEqual({
      observer: "failed",
      store: "ok",
    });
    expect(result.evidence.message).toBe(
      "token for [redacted payment number] failed",
    );
    expect(result.errors).toHaveLength(1);
    expect(recorder.metrics()).toMatchObject({
      recorded: 1,
      sinkErrors: 1,
    });
    expect(await recorder.summary({ correlationId })).toMatchObject({
      reportedOutcome: "failed",
      status: "failed",
    });
  });
});
