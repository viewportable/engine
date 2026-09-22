import type { Page } from 'playwright';
import type { CssSourceReference } from './types.js';

export async function findUniqueCssSource(
  page: Page,
  selector: string,
  property: string,
  computedValue: string,
): Promise<CssSourceReference | null> {
  return page.evaluate(
    ({ selector: targetSelector, property: targetProperty, computedValue: targetValue }) => {
      const element = document.querySelector(targetSelector);
      if (!element) return null;

      const normalizedTarget = targetValue.trim();
      const matches: Array<{
        stylesheet: string | null;
        selector: string;
        property: string;
        value: string;
        media: string | null;
      }> = [];

      const sourceName = (sheet: CSSStyleSheet): string | null => {
        if (sheet.href) return sheet.href;

        const owner = sheet.ownerNode;
        if (owner instanceof Element) {
          return (
            owner.getAttribute('data-vite-dev-id') ??
            owner.getAttribute('data-source') ??
            owner.getAttribute('href')
          );
        }

        return null;
      };

      const visitRules = (
        rules: CSSRuleList,
        stylesheet: string | null,
        media: string | null,
      ): void => {
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSMediaRule) {
            if (!window.matchMedia(rule.conditionText).matches) continue;

            const nestedMedia = media
              ? `${media} and ${rule.conditionText}`
              : rule.conditionText;
            visitRules(rule.cssRules, stylesheet, nestedMedia);
            continue;
          }

          if (rule instanceof CSSStyleRule) {
            let matchesElement = false;

            try {
              matchesElement = element.matches(rule.selectorText);
            } catch {
              matchesElement = false;
            }

            if (matchesElement) {
              const value = rule.style.getPropertyValue(targetProperty).trim();
              if (value === normalizedTarget) {
                matches.push({
                  stylesheet,
                  selector: rule.selectorText,
                  property: targetProperty,
                  value,
                  media,
                });
              }
            }
          }

          if ('cssRules' in rule) {
            try {
              visitRules((rule as CSSGroupingRule).cssRules, stylesheet, media);
            } catch {
              // Ignore inaccessible nested rules.
            }
          }
        }
      };

      for (const sheet of Array.from(document.styleSheets)) {
        try {
          visitRules(sheet.cssRules, sourceName(sheet), null);
        } catch {
          // Cross-origin stylesheets are intentionally ignored.
        }
      }

      return matches.length === 1 ? matches[0] : null;
    },
    {
      selector,
      property,
      computedValue,
    },
  );
}
