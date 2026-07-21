import type { ScanSection } from "@/lib/types";

export const SELECTION_LIMITS = {
  minCharacters: 12,
  minWords: 2,
  maxCharacters: 1800,
  maxWords: 300,
  maxSentences: 10,
  maxBlocks: 4,
  maxSections: 1,
  maxHeadings: 1,
  broadDocumentFraction: 0.2,
  broadDocumentMinCharacters: 500,
  nearWholeDocumentFraction: 0.6,
  nearWholeDocumentMinCharacters: 200,
} as const;

export type SelectionContext = {
  blockCount: number;
  sectionCount: number;
  headingCount: number;
  documentCharacters: number;
  elementTypes: ScanSection["elementType"][];
};

export type SelectionMetrics = {
  characters: number;
  graphemes: number;
  words: number;
  sentences: number;
  documentFraction: number;
};

export type SelectionPolicyReason =
  | "empty"
  | "fragment"
  | "character-limit"
  | "word-limit"
  | "sentence-limit"
  | "block-limit"
  | "section-limit"
  | "heading-limit"
  | "document-scale"
  | "eligible";

export type SelectionPolicyResult = {
  status: "eligible" | "too_narrow" | "too_broad";
  reason: SelectionPolicyReason;
  message: string;
  normalizedText: string;
  metrics: SelectionMetrics;
};

export type SelectionFocusStatus = "sufficient" | "too_narrow" | "multiple_concepts";

export type SelectionFocusAssessment = {
  status: SelectionFocusStatus;
  reason: string;
};

const wordPattern = /[\p{L}\p{N}]+(?:[’'\-][\p{L}\p{N}]+)*/gu;
const meaningfulPattern = /[\p{L}\p{N}\p{S}]/gu;

export function normalizeSelectionText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function countSegments(text: string, granularity: "grapheme" | "sentence"): number {
  const segmenter = new Intl.Segmenter("en", { granularity });
  let count = 0;
  for (const segment of segmenter.segment(text)) {
    if (granularity === "grapheme" || meaningfulPattern.test(segment.segment)) count += 1;
    meaningfulPattern.lastIndex = 0;
  }
  return count;
}

function selfContainedEquation(text: string, context: SelectionContext): boolean {
  if (!context.elementTypes.includes("equation")) return false;
  const meaningful = text.match(meaningfulPattern)?.length ?? 0;
  return text.length >= 5 && meaningful >= 3 && /[=≈≃∝<>≤≥+\-−×*/^∑∫]/u.test(text);
}

export function selectionContextForStoredSection(section: ScanSection): SelectionContext {
  const characters = normalizeSelectionText(section.text).length;
  return {
    blockCount: 1,
    sectionCount: 1,
    headingCount: 0,
    // A persisted selection was already accepted in the context of a larger
    // source document. Do not misclassify it as a whole-document selection
    // when rebuilding the artifact from the notebook.
    documentCharacters: Math.max(characters * 10, 10_000),
    elementTypes: [section.elementType],
  };
}

export function assessSelection(text: string, context: SelectionContext): SelectionPolicyResult {
  const normalizedText = normalizeSelectionText(text);
  const characters = normalizedText.length;
  const graphemes = normalizedText ? countSegments(normalizedText, "grapheme") : 0;
  const words = normalizedText.match(wordPattern)?.length ?? 0;
  const sentences = normalizedText ? countSegments(normalizedText, "sentence") : 0;
  const documentFraction = context.documentCharacters > 0 ? characters / context.documentCharacters : 0;
  const metrics = { characters, graphemes, words, sentences, documentFraction };
  const result = (
    status: SelectionPolicyResult["status"],
    reason: SelectionPolicyReason,
    message: string,
  ): SelectionPolicyResult => ({ status, reason, message, normalizedText, metrics });

  if (graphemes === 0) {
    return result("too_narrow", "empty", "Select a complete sentence, equation, or figure.");
  }
  if (
    (words === 0 || (graphemes < SELECTION_LIMITS.minCharacters && words < SELECTION_LIMITS.minWords)) &&
    !selfContainedEquation(normalizedText, context)
  ) {
    return result("too_narrow", "fragment", "Select a complete sentence, equation, or figure.");
  }
  if (characters > SELECTION_LIMITS.maxCharacters) {
    return result("too_broad", "character-limit", "This selection spans too much source material. Narrow it to one concept.");
  }
  if (words > SELECTION_LIMITS.maxWords) {
    return result("too_broad", "word-limit", "This selection spans too much source material. Narrow it to one concept.");
  }
  if (sentences > SELECTION_LIMITS.maxSentences) {
    return result("too_broad", "sentence-limit", "This selection contains several ideas. Narrow it to one relationship or process.");
  }
  if (context.blockCount > SELECTION_LIMITS.maxBlocks) {
    return result("too_broad", "block-limit", "This selection crosses several passages. Narrow it to one relationship or process.");
  }
  if (context.sectionCount > SELECTION_LIMITS.maxSections) {
    return result("too_broad", "section-limit", "This selection crosses source sections. Narrow it to one concept.");
  }
  if (context.headingCount > SELECTION_LIMITS.maxHeadings) {
    return result("too_broad", "heading-limit", "This selection crosses source sections. Narrow it to one concept.");
  }
  if (
    (characters >= SELECTION_LIMITS.broadDocumentMinCharacters &&
      documentFraction > SELECTION_LIMITS.broadDocumentFraction) ||
    (characters >= SELECTION_LIMITS.nearWholeDocumentMinCharacters &&
      documentFraction > SELECTION_LIMITS.nearWholeDocumentFraction)
  ) {
    return result("too_broad", "document-scale", "This looks like most of the source. Select one passage to experiment with.");
  }

  return result("eligible", "eligible", "This selection is ready for a focus check.");
}

export function warningForFocusStatus(status: Exclude<SelectionFocusStatus, "sufficient">): SelectionPolicyResult {
  return {
    status: status === "too_narrow" ? "too_narrow" : "too_broad",
    reason: status === "too_narrow" ? "fragment" : "block-limit",
    message:
      status === "too_narrow"
        ? "Select a passage with enough context to define one relationship or process."
        : "This selection contains more than one concept. Narrow it to one relationship or process.",
    normalizedText: "",
    metrics: { characters: 0, graphemes: 0, words: 0, sentences: 0, documentFraction: 0 },
  };
}
