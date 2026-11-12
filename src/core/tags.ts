/** Tags refwright writes itself. Never suggested, cleaned, merged or renamed. */
export const STATUS_TAGS = {
  pdfFound: "fulltext:pdf-found",
  pdfMissing: "fulltext:pdf-missing",
  pdfCheck: "fulltext:check-needed",
  retracted: "retraction:retracted",
  notRetracted: "retraction:none",
  retractionCheck: "retraction:check-needed",
  citeOk: "citation:ok",
  citeIncomplete: "citation:incomplete",
  citeMismatch: "citation:mismatch",
  citeCheck: "citation:check-needed",
  report: "refwright:report",
} as const;

export const RESERVED_PREFIXES = [
  "fulltext:",
  "retraction:",
  "citation:",
  "refwright:",
];
/** prefixes other local programs may write through the write-back API */
export const WRITEBACK_PREFIXES = [
  ...RESERVED_PREFIXES,
  "GRADE:",
  "RoB2:",
  "ROBINS-I:",
  "Quality:",
];

export const isReserved = (tag: string) =>
  RESERVED_PREFIXES.some((p) => tag.toLowerCase().startsWith(p));
export const isWritebackAllowed = (tag: string) =>
  WRITEBACK_PREFIXES.some((p) => tag.startsWith(p));
