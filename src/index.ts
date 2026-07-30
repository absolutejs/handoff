/**
 * @absolutejs/handoff — privacy-safe visibility for work that leaves your app.
 *
 * A handoff starts in a host application, continues in an external system, and
 * may return through callbacks, reconciliation, or a customer/operator report.
 * This package preserves one correlation identity while keeping reported
 * outcomes separate from authoritative external evidence.
 */

export const HANDOFF_CORRELATION_KEY = "absolute_handoff_correlation";

export type HandoffEvidenceSource =
  | "host"
  | "external_api"
  | "external_surface_report"
  | "callback"
  | "reconciliation";

export type HandoffOutcome =
  | "started"
  | "pending"
  | "succeeded"
  | "failed"
  | "unknown";

/**
 * A privacy-safe projection of one observation. Do not include credentials,
 * payment details, raw callback bodies, or customer data.
 */
export type HandoffEvidence = {
  at: number;
  correlationId: string;
  operation: string;
  outcome: HandoffOutcome;
  service: string;
  source: HandoffEvidenceSource;
  attempt?: number;
  externalId?: string;
  message?: string;
  reference?: string;
};

export type HandoffSummary = {
  authoritativeOutcome: HandoffOutcome | null;
  contradiction: boolean;
  correlationId: string;
  latest: HandoffEvidence | null;
  operation: string;
  reportedOutcome: HandoffOutcome | null;
  service: string;
  status: HandoffOutcome;
};

export type HandoffMetrics = {
  contradictions: number;
  recorded: number;
  sinkErrors: number;
  byOutcome: Record<HandoffOutcome, number>;
  bySource: Record<HandoffEvidenceSource, number>;
};

export type HandoffStore = {
  append(evidence: HandoffEvidence): Promise<void> | void;
  list(input: {
    correlationId: string;
    operation?: string;
    service?: string;
  }): Promise<HandoffEvidence[]> | HandoffEvidence[];
};

export type HandoffObserver = (
  evidence: HandoffEvidence,
) => Promise<void> | void;

export type HandoffRecordResult = {
  delivered: {
    observer: "failed" | "ok" | "skipped";
    store: "failed" | "ok" | "skipped";
  };
  evidence: HandoffEvidence;
  errors: Error[];
};

export type HandoffRecorder = {
  metrics(): HandoffMetrics;
  record(
    evidence: Omit<HandoffEvidence, "at"> & { at?: number },
  ): Promise<HandoffRecordResult>;
  summary(input: {
    correlationId: string;
    operation?: string;
    service?: string;
  }): Promise<HandoffSummary>;
};

export type HandoffRecorderOptions = {
  clock?: () => number;
  observer?: HandoffObserver;
  store?: HandoffStore;
};

const TERMINAL_OUTCOMES = new Set<HandoffOutcome>(["failed", "succeeded"]);
const AUTHORITATIVE_SOURCES = new Set<HandoffEvidenceSource>([
  "external_api",
  "callback",
  "reconciliation",
]);
const REPORTED_SOURCES = new Set<HandoffEvidenceSource>([
  "external_surface_report",
]);
const PAYMENT_NUMBER_PATTERN = /\b\d(?:[ -]?\d){12,18}\b/gu;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/giu;

const emptyOutcomes = (): Record<HandoffOutcome, number> => ({
  failed: 0,
  pending: 0,
  started: 0,
  succeeded: 0,
  unknown: 0,
});

const emptySources = (): Record<HandoffEvidenceSource, number> => ({
  callback: 0,
  external_api: 0,
  external_surface_report: 0,
  host: 0,
  reconciliation: 0,
});

const errorOf = (value: unknown) =>
  value instanceof Error ? value : new Error(String(value));

export const sanitizeHandoffText = (value: string) =>
  value
    .replace(PAYMENT_NUMBER_PATTERN, "[redacted payment number]")
    .replace(BEARER_PATTERN, "Bearer [redacted]")
    .trim();

export const withHandoffCorrelation = (
  metadata: Record<string, string> | undefined,
  correlationId: string,
  key = HANDOFF_CORRELATION_KEY,
) => ({
  ...metadata,
  [key]: correlationId,
});

export const handoffCorrelationFrom = (
  value: unknown,
  key = HANDOFF_CORRELATION_KEY,
) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const correlationId = (value as Record<string, unknown>)[key];

  return typeof correlationId === "string" &&
    correlationId.length > 0 &&
    correlationId.length <= 200
    ? correlationId
    : null;
};

export const summarizeHandoff = (
  evidence: HandoffEvidence[],
): HandoffSummary => {
  const ordered = evidence.toSorted((left, right) => left.at - right.at);
  const latest = ordered.at(-1) ?? null;
  const correlationId = latest?.correlationId ?? "";
  const operation = latest?.operation ?? "";
  const service = latest?.service ?? "";
  const matching = ordered.filter(
    (item) =>
      item.correlationId === correlationId &&
      item.operation === operation &&
      item.service === service,
  );
  const authoritative = matching.filter((item) =>
    AUTHORITATIVE_SOURCES.has(item.source),
  );
  const reports = matching.filter((item) => REPORTED_SOURCES.has(item.source));
  const authoritativeOutcome =
    authoritative.findLast((item) => TERMINAL_OUTCOMES.has(item.outcome))
      ?.outcome ??
    authoritative.at(-1)?.outcome ??
    null;
  const reportedOutcome =
    reports.findLast((item) => TERMINAL_OUTCOMES.has(item.outcome))?.outcome ??
    reports.at(-1)?.outcome ??
    null;
  const terminalAuthoritativeOutcomes = new Set(
    authoritative
      .map(({ outcome }) => outcome)
      .filter((outcome) => TERMINAL_OUTCOMES.has(outcome)),
  );
  const contradiction =
    terminalAuthoritativeOutcomes.size > 1 ||
    (authoritativeOutcome !== null &&
      reportedOutcome !== null &&
      TERMINAL_OUTCOMES.has(authoritativeOutcome) &&
      TERMINAL_OUTCOMES.has(reportedOutcome) &&
      authoritativeOutcome !== reportedOutcome);

  return {
    authoritativeOutcome,
    contradiction,
    correlationId,
    latest,
    operation,
    reportedOutcome,
    service,
    status:
      authoritativeOutcome ?? reportedOutcome ?? latest?.outcome ?? "unknown",
  };
};

export const memoryHandoffStore = (
  initial: HandoffEvidence[] = [],
): HandoffStore => {
  const evidence = [...initial];

  return {
    append: (item) => {
      evidence.push(item);
    },
    list: ({ correlationId, operation, service }) =>
      evidence.filter(
        (item) =>
          item.correlationId === correlationId &&
          (operation === undefined || item.operation === operation) &&
          (service === undefined || item.service === service),
      ),
  };
};

export const createHandoffRecorder = (
  options: HandoffRecorderOptions = {},
): HandoffRecorder => {
  const counters: HandoffMetrics = {
    byOutcome: emptyOutcomes(),
    bySource: emptySources(),
    contradictions: 0,
    recorded: 0,
    sinkErrors: 0,
  };
  const clock = options.clock ?? Date.now;

  return {
    metrics: () => ({
      ...counters,
      byOutcome: { ...counters.byOutcome },
      bySource: { ...counters.bySource },
    }),
    record: async (input) => {
      const evidence: HandoffEvidence = {
        ...input,
        at: input.at ?? clock(),
        ...(input.message === undefined
          ? {}
          : { message: sanitizeHandoffText(input.message) }),
        ...(input.reference === undefined
          ? {}
          : { reference: sanitizeHandoffText(input.reference) }),
      };
      const errors: Error[] = [];
      const delivered: HandoffRecordResult["delivered"] = {
        observer: options.observer === undefined ? "skipped" : "ok",
        store: options.store === undefined ? "skipped" : "ok",
      };

      counters.recorded += 1;
      counters.byOutcome[evidence.outcome] += 1;
      counters.bySource[evidence.source] += 1;
      for (const [sink, write] of [
        ["store", () => options.store?.append(evidence)],
        ["observer", () => options.observer?.(evidence)],
      ] as const) {
        if (delivered[sink] === "skipped") continue;
        try {
          await write();
        } catch (error) {
          delivered[sink] = "failed";
          counters.sinkErrors += 1;
          errors.push(errorOf(error));
        }
      }

      return { delivered, errors, evidence };
    },
    summary: async (input) => {
      const evidence = (await options.store?.list(input)) ?? [];
      const summary = summarizeHandoff(evidence);
      if (summary.contradiction) counters.contradictions += 1;

      return summary;
    },
  };
};
