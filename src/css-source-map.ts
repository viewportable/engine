import { createHash } from 'node:crypto';
import {
  AnyMap,
  isIgnored,
  sourceContentFor,
  traceSegment,
  type SourceMapInput,
} from '@jridgewell/trace-mapping';
import type { CssAuthoredSourceLocation, CssSourceLocation, CssSourceReference } from './types.js';

interface SourceMapPayload {
  map: SourceMapInput;
  kind: 'inline' | 'external';
  mapUrl: string | null;
  resolutionUrl: string;
}

function sourceMappingReference(stylesheetText: string): string | null {
  const pattern =
    /(?:\/\*[#@]\s*sourceMappingURL=([^\s*]+)\s*\*\/|\/\/[#@]\s*sourceMappingURL=([^\s]+))/g;
  let result: string | null = null;

  for (const match of stylesheetText.matchAll(pattern)) {
    result = match[1] ?? match[2] ?? result;
  }

  return result;
}

function decodeDataUrl(value: string): string | null {
  if (!value.startsWith('data:')) return null;

  const comma = value.indexOf(',');
  if (comma === -1) return null;

  const metadata = value.slice(5, comma);
  const payload = value.slice(comma + 1);

  try {
    return /(?:^|;)base64(?:;|$)/i.test(metadata)
      ? Buffer.from(payload, 'base64').toString('utf8')
      : decodeURIComponent(payload);
  } catch {
    return null;
  }
}

function parsedSourceMap(text: string): SourceMapInput | null {
  try {
    const value = JSON.parse(text) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    if ((value as { version?: unknown }).version !== 3) return null;
    return value as SourceMapInput;
  } catch {
    return null;
  }
}

async function loadSourceMap({
  stylesheetUrl,
  stylesheetText,
  fetchText,
}: {
  stylesheetUrl: URL;
  stylesheetText: string;
  fetchText: (url: string) => Promise<string | null>;
}): Promise<SourceMapPayload | null> {
  const reference = sourceMappingReference(stylesheetText);
  if (!reference) return null;

  const inline = decodeDataUrl(reference);
  if (inline !== null) {
    const map = parsedSourceMap(inline);
    if (!map) return null;

    return {
      map,
      kind: 'inline',
      mapUrl: null,
      resolutionUrl: stylesheetUrl.href,
    };
  }

  let mapUrl: URL;
  try {
    mapUrl = new URL(reference, stylesheetUrl);
  } catch {
    return null;
  }

  if (
    (mapUrl.protocol !== 'http:' && mapUrl.protocol !== 'https:') ||
    mapUrl.origin !== stylesheetUrl.origin
  ) {
    return null;
  }

  const text = await fetchText(mapUrl.href);
  if (text === null) return null;

  const map = parsedSourceMap(text);
  if (!map) return null;

  return {
    map,
    kind: 'external',
    mapUrl: mapUrl.href,
    resolutionUrl: mapUrl.href,
  };
}

function sourcePositionStartsWithProperty(
  sourceContent: string,
  line: number,
  column: number,
  property: string,
): boolean {
  if (line < 0 || column < 0) return false;
  const lines = sourceContent.split(/\r?\n/);
  const sourceLine = lines[line];
  if (sourceLine === undefined || column > sourceLine.length) return false;
  return sourceLine.slice(column).startsWith(property);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function findAuthoredCssSourceLocation({
  source,
  location,
  fetchText,
}: {
  source: CssSourceReference;
  location: CssSourceLocation;
  fetchText: (url: string) => Promise<string | null>;
}): Promise<CssAuthoredSourceLocation | null> {
  if (!source.stylesheet) return null;

  let stylesheetUrl: URL;
  try {
    stylesheetUrl = new URL(source.stylesheet);
  } catch {
    return null;
  }

  if (stylesheetUrl.protocol !== 'http:' && stylesheetUrl.protocol !== 'https:') return null;

  const stylesheetText = await fetchText(stylesheetUrl.href);
  if (stylesheetText === null) return null;

  const payload = await loadSourceMap({
    stylesheetUrl,
    stylesheetText,
    fetchText,
  });
  if (!payload) return null;

  try {
    const tracer = new AnyMap(payload.map, payload.resolutionUrl);
    const generatedLine = location.start.line - 1;
    const generatedColumn = location.start.column - 1;
    const segment = traceSegment(tracer, generatedLine, generatedColumn);

    if (!segment || segment.length < 4 || segment[0] !== generatedColumn) return null;

    const sourceIndex = segment[1];
    const sourceLine = segment[2];
    const sourceColumn = segment[3];
    const sourceName = tracer.sources[sourceIndex];
    const resolvedSource = tracer.resolvedSources[sourceIndex];

    if (!sourceName || !resolvedSource || isIgnored(tracer, sourceName)) return null;

    const sourceContent = sourceContentFor(tracer, sourceName);
    if (sourceContent === null) return null;

    if (
      !sourcePositionStartsWithProperty(sourceContent, sourceLine, sourceColumn, source.property)
    ) {
      return null;
    }

    return {
      kind: 'source-map-property',
      confidence: 'deterministic',
      coordinateSpace: 'authored-source',
      source: sourceName,
      resolvedSource,
      start: {
        line: sourceLine + 1,
        column: sourceColumn + 1,
      },
      sourceContentSha256: sha256(sourceContent),
      sourceMap: {
        version: 3,
        kind: payload.kind,
        url: payload.mapUrl,
      },
    };
  } catch {
    return null;
  }
}
