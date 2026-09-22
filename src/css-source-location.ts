import type { CDPSession } from 'playwright';
import type { CssSourceLocation, CssSourceReference } from './types.js';

interface CdpSourceRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

interface CdpCssProperty {
  name: string;
  value: string;
  disabled?: boolean;
  parsedOk?: boolean;
  range?: CdpSourceRange;
}

interface CdpCssRule {
  styleSheetId?: string;
  selectorList: {
    text: string;
  };
  style: {
    cssProperties: CdpCssProperty[];
  };
  media?: Array<{
    text: string;
  }>;
}

interface CdpMatchedStylesResponse {
  matchedCSSRules?: Array<{
    rule: CdpCssRule;
  }>;
}

interface CdpDocumentResponse {
  root: {
    nodeId: number;
  };
}

interface CdpQuerySelectorResponse {
  nodeId: number;
}

interface CdpStyleSheetTextResponse {
  text: string;
}

function lineColumnToOffset(text: string, line: number, column: number): number | null {
  if (line < 0 || column < 0) return null;

  let offset = 0;
  for (let currentLine = 0; currentLine < line; currentLine += 1) {
    const newline = text.indexOf('\n', offset);
    if (newline === -1) return null;
    offset = newline + 1;
  }

  const lineEnd = text.indexOf('\n', offset);
  const effectiveEnd = lineEnd === -1 ? text.length : lineEnd;
  const target = offset + column;
  return target <= effectiveEnd ? target : null;
}

function textForRange(text: string, range: CdpSourceRange): string | null {
  const start = lineColumnToOffset(text, range.startLine, range.startColumn);
  const end = lineColumnToOffset(text, range.endLine, range.endColumn);
  if (start === null || end === null || end < start) return null;
  return text.slice(start, end);
}

function mediaMatches(rule: CdpCssRule, expected: string | null): boolean {
  if (expected === null) return true;
  return (rule.media ?? []).some((media) => media.text.trim() === expected.trim());
}

function propertyMatches(property: CdpCssProperty, source: CssSourceReference): boolean {
  return (
    property.name === source.property &&
    property.value.trim() === source.value.trim() &&
    property.disabled !== true &&
    property.parsedOk !== false &&
    property.range !== undefined
  );
}

function rangeLooksLikeProperty(
  text: string,
  property: CdpCssProperty,
  source: CssSourceReference,
): boolean {
  if (!property.range) return false;
  const snippet = textForRange(text, property.range);
  if (snippet === null) return false;

  return (
    snippet.includes(source.property) &&
    snippet.includes(source.value) &&
    snippet.trim().length > source.property.length + source.value.length
  );
}

function toLocation(range: CdpSourceRange): CssSourceLocation {
  return {
    kind: 'css-property-range',
    confidence: 'deterministic',
    coordinateSpace: 'stylesheet',
    start: {
      line: range.startLine + 1,
      column: range.startColumn + 1,
    },
    end: {
      line: range.endLine + 1,
      column: range.endColumn + 1,
    },
  };
}

export async function findCssSourceLocation(
  cdp: CDPSession,
  elementSelector: string,
  source: CssSourceReference,
): Promise<CssSourceLocation | null> {
  try {
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');

    const documentResponse = (await cdp.send('DOM.getDocument', {
      depth: 0,
      pierce: true,
    })) as unknown as CdpDocumentResponse;

    const queryResponse = (await cdp.send('DOM.querySelector', {
      nodeId: documentResponse.root.nodeId,
      selector: elementSelector,
    })) as unknown as CdpQuerySelectorResponse;

    if (!queryResponse.nodeId) return null;

    const matched = (await cdp.send('CSS.getMatchedStylesForNode', {
      nodeId: queryResponse.nodeId,
    })) as unknown as CdpMatchedStylesResponse;

    const candidates: CssSourceLocation[] = [];

    for (const match of matched.matchedCSSRules ?? []) {
      const rule = match.rule;
      if (rule.selectorList.text !== source.selector) continue;
      if (!mediaMatches(rule, source.media)) continue;
      if (!rule.styleSheetId) continue;

      const matchingProperties = rule.style.cssProperties.filter((property) =>
        propertyMatches(property, source),
      );

      for (const property of matchingProperties) {
        if (!property.range) continue;

        const stylesheet = (await cdp.send('CSS.getStyleSheetText', {
          styleSheetId: rule.styleSheetId,
        })) as unknown as CdpStyleSheetTextResponse;

        if (!rangeLooksLikeProperty(stylesheet.text, property, source)) continue;
        candidates.push(toLocation(property.range));
      }
    }

    if (candidates.length !== 1) return null;
    return candidates[0] ?? null;
  } catch {
    return null;
  }
}
