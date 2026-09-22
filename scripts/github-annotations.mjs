import { createHash } from 'node:crypto';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { findingLabel, findingRangeText } from './github-pr-comment.mjs';

export const MAX_CHECK_ANNOTATIONS = 50;

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function normalizedAbsolutePath(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;

  if (value.startsWith('file://')) {
    try {
      return path.resolve(fileURLToPath(value));
    } catch {
      return null;
    }
  }

  if (!path.isAbsolute(value)) return null;
  return path.resolve(value);
}

function pathInsideRoot(filePath, repositoryRoot) {
  const root = path.resolve(repositoryRoot);
  const absolute = path.resolve(filePath);
  const relative = path.relative(root, absolute);

  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return null;
  }

  return {
    absolute,
    relative: relative.split(path.sep).join('/'),
  };
}

export function repositoryPathForStylesheet(stylesheet, repositoryRoot) {
  if (typeof repositoryRoot !== 'string' || repositoryRoot.trim() === '') return null;

  const sourcePath = normalizedAbsolutePath(stylesheet);
  if (!sourcePath) return null;

  return pathInsideRoot(sourcePath, repositoryRoot)?.relative ?? null;
}

function rangeOffsets(content, location) {
  const startLine = positiveInteger(location?.start?.line);
  const startColumn = positiveInteger(location?.start?.column);
  const endLine = positiveInteger(location?.end?.line);
  const endColumn = positiveInteger(location?.end?.column);

  if (
    startLine === null ||
    startColumn === null ||
    endLine === null ||
    endColumn === null ||
    endLine < startLine ||
    (endLine === startLine && endColumn <= startColumn)
  ) {
    return null;
  }

  const lines = content.split('\n');
  if (startLine > lines.length || endLine > lines.length) return null;
  if (startColumn > lines[startLine - 1].length + 1 || endColumn > lines[endLine - 1].length + 1) {
    return null;
  }

  const offsetAt = (line, column) => {
    let offset = 0;
    for (let index = 0; index < line - 1; index += 1) {
      offset += lines[index].length + 1;
    }
    return offset + column - 1;
  };

  const start = offsetAt(startLine, startColumn);
  const end = offsetAt(endLine, endColumn);
  if (start < 0 || end <= start || end > content.length) return null;

  return { start, end, startLine, startColumn, endLine, endColumn };
}

function githubRange(offsets) {
  let endLine = offsets.endLine;

  if (offsets.endLine > offsets.startLine && offsets.endColumn === 1) {
    endLine -= 1;
  }

  if (endLine < offsets.startLine) return null;

  const range = {
    start_line: offsets.startLine,
    end_line: endLine,
  };

  if (offsets.startLine === endLine && offsets.startLine === offsets.endLine) {
    range.start_column = offsets.startColumn;
    range.end_column = Math.max(offsets.startColumn, offsets.endColumn - 1);
  }

  return range;
}

function annotationDetails(finding, authoredLocation = null) {
  const source = finding.source;
  return [
    source?.selector ? `selector: ${source.selector}` : null,
    source?.property && source?.value ? `declaration: ${source.property}: ${source.value}` : null,
    source?.media ? `media: ${source.media}` : null,
    authoredLocation
      ? `source-map: ${authoredLocation.sourceMap.kind} -> ${authoredLocation.source}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function relativeSourceCandidate(identifier) {
  if (typeof identifier !== 'string' || identifier.trim() === '') return null;

  const absolute = normalizedAbsolutePath(identifier);
  if (absolute) return { absolute };

  let pathname = identifier;
  try {
    const url = new URL(identifier);
    pathname = decodeURIComponent(url.pathname);
  } catch {
    pathname = identifier.split(/[?#]/, 1)[0];
  }

  const normalized = path.posix.normalize(pathname.replaceAll('\\', '/'));
  const withoutLeading = normalized
    .replace(/^\/+/, '')
    .replace(/^(?:\.\.\/)+/, '')
    .replace(/^\.\//, '');

  return withoutLeading && withoutLeading !== '.' ? { relative: withoutLeading } : null;
}

async function authoredAnnotation({ finding, repositoryRoot, readText }) {
  const source = finding.source;
  const authored = source?.authoredLocation;

  if (
    !source ||
    typeof source.property !== 'string' ||
    !authored ||
    authored.kind !== 'source-map-property' ||
    authored.confidence !== 'deterministic' ||
    authored.coordinateSpace !== 'authored-source' ||
    typeof authored.sourceContentSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(authored.sourceContentSha256)
  ) {
    return null;
  }

  const line = positiveInteger(authored.start?.line);
  const column = positiveInteger(authored.start?.column);
  if (line === null || column === null) return null;

  const candidates = new Map();

  for (const identifier of [authored.source, authored.resolvedSource]) {
    const candidate = relativeSourceCandidate(identifier);
    if (!candidate) continue;

    const resolved = candidate.absolute
      ? pathInsideRoot(candidate.absolute, repositoryRoot)
      : pathInsideRoot(path.resolve(repositoryRoot, candidate.relative), repositoryRoot);

    if (resolved) candidates.set(resolved.absolute, resolved);
  }

  const verified = [];

  for (const candidate of candidates.values()) {
    let content;
    try {
      content = await readText(candidate.absolute);
    } catch {
      continue;
    }

    if (sha256(content) !== authored.sourceContentSha256) continue;

    const lines = content.split(/\r?\n/);
    const sourceLine = lines[line - 1];
    if (sourceLine === undefined || column > sourceLine.length + 1) continue;
    if (!sourceLine.slice(column - 1).startsWith(source.property)) continue;

    verified.push(candidate);
  }

  if (verified.length !== 1) return null;

  const candidate = verified[0];
  const details = annotationDetails(finding, authored);

  return {
    path: candidate.relative,
    start_line: line,
    end_line: line,
    start_column: column,
    end_column: column + source.property.length - 1,
    annotation_level: 'failure',
    title: `Viewportable: ${finding.type ?? 'structural regression'}`,
    message: `${findingRangeText(finding)} - ${findingLabel(finding)}`,
    ...(details ? { raw_details: details } : {}),
  };
}

async function stylesheetAnnotation({ finding, repositoryRoot, readText }) {
  const source = finding.source;
  const location = source?.location;

  if (
    !source ||
    typeof source.stylesheet !== 'string' ||
    location?.kind !== 'css-property-range' ||
    location?.confidence !== 'deterministic' ||
    location?.coordinateSpace !== 'stylesheet'
  ) {
    return null;
  }

  const repositoryPath = repositoryPathForStylesheet(source.stylesheet, repositoryRoot);
  const sourcePath = normalizedAbsolutePath(source.stylesheet);
  if (!repositoryPath || !sourcePath) return null;

  let content;
  try {
    content = await readText(sourcePath);
  } catch {
    return null;
  }

  const offsets = rangeOffsets(content, location);
  const range = offsets ? githubRange(offsets) : null;
  if (!offsets || !range) return null;

  const snippet = content.slice(offsets.start, offsets.end);
  if (
    typeof source.property !== 'string' ||
    typeof source.value !== 'string' ||
    !snippet.includes(source.property) ||
    !snippet.includes(source.value)
  ) {
    return null;
  }

  const details = annotationDetails(finding);

  return {
    path: repositoryPath,
    ...range,
    annotation_level: 'failure',
    title: `Viewportable: ${finding.type ?? 'structural regression'}`,
    message: `${findingRangeText(finding)} - ${findingLabel(finding)}`,
    ...(details ? { raw_details: details } : {}),
  };
}

export async function buildSourceAnnotations(
  report,
  { repositoryRoot, readText = (filePath) => readFile(filePath, 'utf8') } = {},
) {
  const findings = Array.isArray(report?.findings) ? report.findings : [];
  const annotations = [];
  let skipped = 0;

  if (typeof repositoryRoot !== 'string' || repositoryRoot.trim() === '') {
    return {
      annotations,
      total: 0,
      skipped: findings.filter((finding) => finding?.direction === 'introduced').length,
      truncated: false,
    };
  }

  for (const finding of findings) {
    if (finding?.direction !== 'introduced') continue;

    const annotation =
      (await authoredAnnotation({ finding, repositoryRoot, readText })) ??
      (await stylesheetAnnotation({ finding, repositoryRoot, readText }));

    if (annotation) annotations.push(annotation);
    else if (finding.source?.location || finding.source?.authoredLocation) skipped += 1;
  }

  return {
    annotations: annotations.slice(0, MAX_CHECK_ANNOTATIONS),
    total: annotations.length,
    skipped,
    truncated: annotations.length > MAX_CHECK_ANNOTATIONS,
  };
}

export function normalizeSubmittedAnnotations(value) {
  if (!Array.isArray(value)) return [];

  const normalized = [];

  for (const annotation of value.slice(0, MAX_CHECK_ANNOTATIONS)) {
    if (!annotation || typeof annotation !== 'object' || Array.isArray(annotation)) continue;

    const pathValue = typeof annotation.path === 'string' ? annotation.path.trim() : '';
    const normalizedPath = path.posix.normalize(pathValue.replaceAll('\\', '/'));
    const startLine = positiveInteger(annotation.start_line);
    const endLine = positiveInteger(annotation.end_line);
    const message = typeof annotation.message === 'string' ? annotation.message.trim() : '';

    if (
      !pathValue ||
      normalizedPath === '.' ||
      normalizedPath === '..' ||
      normalizedPath.startsWith('../') ||
      normalizedPath.startsWith('/') ||
      /^[A-Za-z]:\//.test(normalizedPath) ||
      startLine === null ||
      endLine === null ||
      endLine < startLine ||
      !message
    ) {
      continue;
    }

    const result = {
      path: normalizedPath,
      start_line: startLine,
      end_line: endLine,
      annotation_level: 'failure',
      message: message.slice(0, 65_535),
    };

    const startColumn = positiveInteger(annotation.start_column);
    const endColumn = positiveInteger(annotation.end_column);
    if (
      startLine === endLine &&
      startColumn !== null &&
      endColumn !== null &&
      endColumn >= startColumn
    ) {
      result.start_column = startColumn;
      result.end_column = endColumn;
    }

    if (typeof annotation.title === 'string' && annotation.title.trim()) {
      result.title = annotation.title.trim().slice(0, 255);
    }
    if (typeof annotation.raw_details === 'string' && annotation.raw_details.trim()) {
      result.raw_details = annotation.raw_details.trim().slice(0, 65_535);
    }

    normalized.push(result);
  }

  return normalized;
}
