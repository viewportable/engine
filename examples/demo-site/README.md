# Viewportable Engine demo site

This is intentionally framework-neutral. Viewportable Engine receives only a URL, so the detection path is identical whether the page is produced by static HTML, Rails, React, Next.js, or another framework.

- `broken.html` contains a realistic responsive pricing-grid regression.
- `fixed.html` contains the responsive fix.
- `styles.css` is shared by both pages.

From the repository root:

```bash
npm run demo
```

For manual inspection:

```bash
npm run demo:serve
```

Then open `http://127.0.0.1:4173/broken.html` and resize the browser. In a second terminal run:

```bash
npm run demo:scan
```
