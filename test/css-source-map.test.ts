import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { findAuthoredCssSourceLocation } from '../src/css-source-map.js';
import type { CssSourceLocation, CssSourceReference } from '../src/types.js';

const original = ['$card-width: 400px;', '', '.proof {', '  min-width: $card-width;', '}', ''].join(
  '\n',
);

const map = JSON.stringify({
  version: 3,
  sources: ['../src/proof.scss'],
  sourcesContent: [original],
  names: [],
  mappings: 'AAEA;EACE',
});

const location: CssSourceLocation = {
  kind: 'css-property-range',
  confidence: 'deterministic',
  coordinateSpace: 'stylesheet',
  start: { line: 2, column: 3 },
  end: { line: 2, column: 20 },
};

const source: CssSourceReference = {
  stylesheet: 'https://example.test/assets/app.css',
  selector: '.proof',
  property: 'min-width',
  value: '400px',
  media: null,
  location,
};

describe('CSS source map mapping', () => {
  it('maps only an exact generated declaration segment to authored source', async () => {
    const fetchText = async (url: string) => {
      if (url === 'https://example.test/assets/app.css') {
        return '.proof {\n  min-width: 400px;\n}\n/*# sourceMappingURL=app.css.map */\n';
      }
      if (url === 'https://example.test/assets/app.css.map') return map;
      return null;
    };

    await expect(
      findAuthoredCssSourceLocation({
        source,
        location,
        fetchText,
      }),
    ).resolves.toEqual({
      kind: 'source-map-property',
      confidence: 'deterministic',
      coordinateSpace: 'authored-source',
      source: '../src/proof.scss',
      resolvedSource: 'https://example.test/src/proof.scss',
      start: { line: 4, column: 3 },
      sourceContentSha256: createHash('sha256').update(original).digest('hex'),
      sourceMap: {
        version: 3,
        kind: 'external',
        url: 'https://example.test/assets/app.css.map',
      },
    });
  });

  it('supports inline data source maps without another network request', async () => {
    const encoded = Buffer.from(map).toString('base64');
    const requested: string[] = [];
    const fetchText = async (url: string) => {
      requested.push(url);
      if (url === 'https://example.test/assets/app.css') {
        return (
          '.proof {\n  min-width: 400px;\n}\n' +
          `/*# sourceMappingURL=data:application/json;base64,${encoded} */\n`
        );
      }
      return null;
    };

    const result = await findAuthoredCssSourceLocation({
      source,
      location,
      fetchText,
    });

    expect(result?.sourceMap).toEqual({
      version: 3,
      kind: 'inline',
      url: null,
    });
    expect(requested).toEqual(['https://example.test/assets/app.css']);
  });

  it('rejects nearest-previous mappings when the generated column is not exact', async () => {
    const shiftedLocation: CssSourceLocation = {
      ...location,
      start: { line: 2, column: 4 },
    };

    const result = await findAuthoredCssSourceLocation({
      source,
      location: shiftedLocation,
      fetchText: async (url) => {
        if (url.endsWith('app.css')) {
          return '.proof {\n  min-width: 400px;\n}\n/*# sourceMappingURL=app.css.map */\n';
        }
        return map;
      },
    });

    expect(result).toBeNull();
  });

  it('rejects cross-origin source maps', async () => {
    const requested: string[] = [];
    const result = await findAuthoredCssSourceLocation({
      source,
      location,
      fetchText: async (url) => {
        requested.push(url);
        return url.endsWith('app.css')
          ? '.proof {\n  min-width: 400px;\n}\n/*# sourceMappingURL=https://cdn.test/app.css.map */\n'
          : map;
      },
    });

    expect(result).toBeNull();
    expect(requested).toEqual(['https://example.test/assets/app.css']);
  });

  it('rejects a source-map position that does not point at the attributed property', async () => {
    const mismatchedMap = JSON.stringify({
      version: 3,
      sources: ['../src/proof.scss'],
      sourcesContent: [original.replace('min-width', 'width')],
      names: [],
      mappings: 'AAEA;EACE',
    });

    const result = await findAuthoredCssSourceLocation({
      source,
      location,
      fetchText: async (url) => {
        if (url.endsWith('app.css')) {
          return '.proof {\n  min-width: 400px;\n}\n/*# sourceMappingURL=app.css.map */\n';
        }
        return mismatchedMap;
      },
    });

    expect(result).toBeNull();
  });
});
