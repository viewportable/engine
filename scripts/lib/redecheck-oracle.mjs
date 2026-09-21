export const STANDARD_WIDTHS = [320, 375, 390, 430, 768, 1024, 1280, 1400];

export const CLASS_MAPPING = {
  'Viewport Protrusion': {
    support: 'compatible',
    issueTypes: ['horizontal-overflow'],
  },
  'Element Collision': {
    support: 'partial',
    issueTypes: ['fixed-element-collision'],
  },
  'Element Protrusion': {
    support: 'unsupported',
    issueTypes: [],
  },
  'Small-Range': {
    support: 'unsupported',
    issueTypes: [],
  },
  Wrapping: {
    support: 'compatible',
    issueTypes: ['wrapping'],
  },
};

export function parseOracle(markdown, options = {}) {
  const expectedDistinct = options.expectedDistinct ?? 33;
  const start = markdown.indexOf('### True Positives');
  const end = markdown.indexOf('### False Positives');

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Could not isolate the true-positive table in results-archive.md');
  }

  const failures = new Map();

  for (const line of markdown.slice(start, end).split('\n')) {
    if (!line.startsWith('|')) continue;

    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());

    if (cells.length < 6 || cells[4] !== 'TP') continue;

    const [type, page, distinctCell, rangeCell, , reasonCell] = cells;
    const idMatch = distinctCell.match(/\[(\d+)\]/);
    const rangeMatch = rangeCell.match(/(\d+)px-(\d+)px/);
    const reportMatch = distinctCell.match(/\(([^)]+)\)/);

    if (!idMatch || !rangeMatch) continue;

    const id = Number(idMatch[1]);
    const report = {
      type,
      range: {
        min: Number(rangeMatch[1]),
        max: Number(rangeMatch[2]),
      },
      report: reportMatch?.[1] ?? null,
      reason: reasonCell || null,
    };
    const existing = failures.get(id);

    if (existing) {
      if (existing.page !== page) {
        throw new Error(`Distinct RLF ${id} changed page identity: ${existing.page} vs ${page}`);
      }

      const duplicate = existing.reports.some(
        (candidate) =>
          candidate.type === report.type &&
          candidate.range.min === report.range.min &&
          candidate.range.max === report.range.max &&
          candidate.report === report.report,
      );

      if (!duplicate) {
        existing.reports.push(report);
      }
      continue;
    }

    failures.set(id, {
      id,
      page,
      reports: [report],
    });
  }

  const distinctFailures = [...failures.values()]
    .map((failure) => ({
      ...failure,
      reportTypes: [...new Set(failure.reports.map((report) => report.type))],
    }))
    .sort((a, b) => a.id - b.id);

  if (distinctFailures.length !== expectedDistinct) {
    throw new Error(
      `Expected ${expectedDistinct} distinct ReDeCheck true-positive RLFs, parsed ${distinctFailures.length}`,
    );
  }

  return distinctFailures;
}

export function midpoint(range) {
  return Math.floor((range.min + range.max) / 2);
}

export function widthsForPage(failures, additionalReports = []) {
  const widths = new Set(STANDARD_WIDTHS);
  const reports = [...failures.flatMap((failure) => failure.reports), ...additionalReports];

  for (const report of reports) {
    widths.add(report.range.min);
    widths.add(midpoint(report.range));
    widths.add(report.range.max);
  }

  return [...widths].filter((width) => width >= 320 && width <= 1400).sort((a, b) => a - b);
}

export function supportForFailure(failure) {
  const supports = failure.reportTypes
    .map((type) => CLASS_MAPPING[type]?.support ?? 'unsupported')
    .filter((support) => support !== 'unsupported');

  if (supports.includes('compatible')) return 'compatible';
  if (supports.includes('partial')) return 'partial';
  return 'unsupported';
}

export function compatibleFindings(pageResult, failure) {
  const matches = [];

  for (const viewport of pageResult.viewports ?? []) {
    const applicableReports = failure.reports.filter((report) => {
      const mapping = CLASS_MAPPING[report.type];
      if (!mapping || mapping.issueTypes.length === 0) return false;

      return viewport.width >= report.range.min && viewport.width <= report.range.max;
    });

    if (applicableReports.length === 0) continue;

    for (const issue of viewport.issues ?? []) {
      const matchedReportTypes = applicableReports
        .filter((report) => CLASS_MAPPING[report.type].issueTypes.includes(issue.type))
        .map((report) => report.type);

      if (matchedReportTypes.length === 0) continue;

      matches.push({
        viewportWidth: viewport.width,
        issueId: issue.id,
        issueType: issue.type,
        selector: issue.selector,
        side: issue.side ?? null,
        otherSelector: issue.otherSelector ?? null,
        targetSelector: issue.targetSelector ?? null,
        oracleReportTypes: [...new Set(matchedReportTypes)],
      });
    }
  }

  return matches;
}

export function classifyFailure(failure, pageRun) {
  const support = supportForFailure(failure);

  if (!pageRun || pageRun.status === 'environment-error') {
    return {
      classification: 'environment-error',
      support,
      matches: [],
    };
  }

  if (support === 'unsupported') {
    return {
      classification: 'unsupported',
      support,
      matches: [],
    };
  }

  const matches = compatibleFindings(pageRun.result, failure);

  return {
    classification: matches.length > 0 ? 'candidate-match' : 'missed',
    support,
    matches,
  };
}

function parseReportSection(markdown, startHeading, endHeading, classification) {
  const start = markdown.indexOf(startHeading);
  const end = endHeading ? markdown.indexOf(endHeading, start + 1) : markdown.length;

  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Could not isolate the ${classification} section in results-archive.md`);
  }

  const reports = [];

  for (const line of markdown.slice(start, end).split('\n')) {
    if (!line.startsWith('|')) continue;

    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    const classificationIndex = cells.findIndex((cell) => cell === classification);

    if (classificationIndex < 3) continue;

    const type = cells[0];
    const page = cells[1];
    const rangeCell = cells[classificationIndex - 1];
    const reasonCell = cells[classificationIndex + 1] ?? '';
    const rangeMatch = rangeCell.match(/(\d+)px-(\d+)px/);
    const reportMatch = reasonCell.match(/\((\.\.\/[^)]+)\)/);

    if (!type || !page || !rangeMatch) continue;

    reports.push({
      id: `${classification.toLowerCase()}-${reports.length + 1}`,
      classification,
      type,
      page,
      range: {
        min: Number(rangeMatch[1]),
        max: Number(rangeMatch[2]),
      },
      report: reportMatch?.[1] ?? null,
      reason: reasonCell || null,
    });
  }

  return reports;
}

export function parseAntiOracle(markdown) {
  return [
    ...parseReportSection(markdown, '### False Positives', '### Non-Observable Issues', 'FP'),
    ...parseReportSection(markdown, '### Non-Observable Issues', null, 'NOI'),
  ];
}

export function supportForReport(report) {
  return CLASS_MAPPING[report.type]?.support ?? 'unsupported';
}

export function compatibleFindingsForReport(pageResult, report) {
  const mapping = CLASS_MAPPING[report.type];
  if (!mapping || mapping.issueTypes.length === 0) return [];

  const matches = [];

  for (const viewport of pageResult.viewports ?? []) {
    if (viewport.width < report.range.min || viewport.width > report.range.max) continue;

    for (const issue of viewport.issues ?? []) {
      if (!mapping.issueTypes.includes(issue.type)) continue;

      matches.push({
        viewportWidth: viewport.width,
        issueId: issue.id,
        issueType: issue.type,
        selector: issue.selector,
        side: issue.side ?? null,
        otherSelector: issue.otherSelector ?? null,
        targetSelector: issue.targetSelector ?? null,
      });
    }
  }

  return matches;
}

export function classifyAntiOracleReport(report, pageRun) {
  const support = supportForReport(report);

  if (!pageRun || pageRun.status === 'environment-error') {
    return {
      classification: 'environment-error',
      support,
      matches: [],
    };
  }

  if (support === 'unsupported') {
    return {
      classification: 'unsupported',
      support,
      matches: [],
    };
  }

  const matches = compatibleFindingsForReport(pageRun.result, report);

  return {
    classification: matches.length > 0 ? 'negative-candidate' : 'clean',
    support,
    matches,
  };
}
