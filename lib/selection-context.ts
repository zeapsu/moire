import { normalizeSelectionText, type SelectionContext } from "@/lib/selection-policy";
import type { ScanSection } from "@/lib/types";

type IndexedElement = {
  element: Element;
  section: ScanSection;
};

const MAX_DOCUMENT_CHARACTERS = 5_000_000;

function rangeIntersects(range: Range, element: Element): boolean {
  try {
    return range.intersectsNode(element);
  } catch {
    return false;
  }
}

function outermost(matches: IndexedElement[]): IndexedElement[] {
  return matches.filter(
    ({ element }, index) =>
      !matches.some((candidate, candidateIndex) => candidateIndex !== index && candidate.element.contains(element)),
  );
}

export type CollectedSelectionContext = {
  context: SelectionContext;
  source?: ScanSection;
  text: string;
};

export function collectSelectionContext(
  range: Range,
  article: HTMLElement,
  sections: ScanSection[],
  rawText: string,
): CollectedSelectionContext {
  const matches = sections.flatMap((section): IndexedElement[] => {
    const element = article.querySelector(section.selector);
    return element && rangeIntersects(range, element) ? [{ element, section }] : [];
  });
  const structural = outermost(matches);
  const figures = [...article.querySelectorAll("figure")].filter((figure) => rangeIntersects(range, figure));
  const figure = figures.length === 1 ? figures[0] : undefined;
  const isSingleFigure = Boolean(
    figure && matches.length > 0 && matches.every(({ element }) => figure === element || figure.contains(element)),
  );
  const figureSource = isSingleFigure
    ? matches.find(({ element }) => element === figure)?.section ??
      matches.find(({ section }) => section.elementType === "figure")?.section
    : undefined;
  const selectedText = normalizeSelectionText(rawText);
  const groundedFigureText =
    figureSource?.text ||
    normalizeSelectionText(figure?.querySelector("figcaption")?.textContent ?? "") ||
    normalizeSelectionText(figure?.querySelector("img")?.getAttribute("alt") ?? "");
  const effective = isSingleFigure && figureSource ? [{ element: figure!, section: figureSource }] : structural;
  const headingCount = isSingleFigure
    ? 0
    : [...article.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter((heading) => rangeIntersects(range, heading)).length;
  const elementTypes = [...new Set(effective.map(({ section }) => section.elementType))];

  return {
    source: figureSource ?? effective[0]?.section ?? matches[0]?.section,
    text: selectedText || (isSingleFigure ? groundedFigureText : ""),
    context: {
      blockCount: Math.max(1, effective.length),
      sectionCount: Math.max(1, new Set(effective.map(({ section }) => section.section)).size),
      headingCount,
      documentCharacters: Math.min(
        MAX_DOCUMENT_CHARACTERS,
        Math.max(1, sections.reduce((sum, section) => sum + section.text.length, 0)),
      ),
      elementTypes: elementTypes.length > 0 ? elementTypes : [isSingleFigure ? "figure" : "paragraph"],
    },
  };
}
