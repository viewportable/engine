# Source-Aware Real React Agent Acceptance

- Status: accepted experiment
- Date: 2026-09-22
- Engine: `238dc2df1752e03a005c8077506ba5496de6be5c`
- Application: `viewportable/viewportable@7ce05528496e4ffae6f166387885bb325c35797f`
- Model: `gpt-5.6-terra`
- Evidence schema: `viewportable.agent-evidence.v2`
- Controlled GitHub Actions run: `35674216078`

## Question

Does deterministic source attribution materially improve the coding-agent repair loop on real React code, rather than only making the JSON report richer?

The previous real React acceptance proved that an agent could repair the regression with Viewportable evidence, but it had to read the complete candidate `src/renderer/styles.css`.

This experiment removed the full-file reader entirely.

## Real application

The test used the actual Viewportable React renderer from:

```text
viewportable/viewportable
commit 7ce05528496e4ffae6f166387885bb325c35797f
```

Baseline and candidate started from the same commit.

The harness injected one controlled candidate-only CSS regression:

```css
@media (min-width: 850px) and (max-width: 949px) {
  [data-viewport-id="iphone-15-pro"] {
    min-width: 800px;
  }
}
```

The renderer itself remained the real application code. Only the Electron preload boundary was replaced by a minimal temporary browser bridge so the renderer could run under Vite in the controlled test.

## Viewportable evidence

Viewportable reported two introduced structural protrusions with the same exact responsive range:

```text
850-949px exact
sampled 875-925px
```

The header protrusion was an indirect geometry effect, so its source remained:

```json
"source": null
```

The directly constrained viewport scroll zone was attributed deterministically:

```json
{
  "kind": "css-declaration",
  "confidence": "deterministic",
  "stylesheet": ".../react-candidate/src/renderer/styles.css",
  "selector": "[data-viewport-id=\"iphone-15-pro\"]",
  "property": "min-width",
  "value": "800px",
  "media": "(min-width: 850px) and (max-width: 949px)"
}
```

This distinction is intentional. Viewportable attributed only the direct authored cause and did not fabricate source attribution for the downstream header effect.

## Agent surface

The model had only three tools:

```text
viewportable_compare
read_attributed_source_context
replace_in_styles
```

There was no arbitrary shell and no full-file source reader.

`read_attributed_source_context` accepted only a source object returned by the immediately preceding Viewportable comparison. The harness rejected any other path or attribution tuple.

The tool returned at most 1.5 KB around the proven CSS declaration.

## Observed repair loop

The actual tool sequence was:

```text
viewportable_compare
  -> 2 findings, 1 deterministic source attribution

read_attributed_source_context
  -> src/renderer/styles.css
  -> lines 569-579
  -> 163 bytes

replace_in_styles
  -> remove 119 bytes
  -> add 0 bytes

viewportable_compare
  -> clean
  -> 0 findings
```

The final candidate `styles.css` was byte-for-byte identical to the baseline file.

## Measured effect

Compared with the prior real React agent acceptance:

| Metric | Full-file repair | Source-aware repair |
| --- | ---: | ---: |
| Source bytes exposed to model | 9,349 | 163 |
| Source-context reduction | - | 98.3% |
| Tool calls | 4 | 4 |
| Writes | 1 | 1 |
| Final findings | 0 | 0 |
| Model tokens | 16,707 | 5,851 |
| Token reduction | - | 65.0% |

These are two controlled runs rather than a statistical benchmark. The token difference should therefore be treated as directional evidence, not a universal performance claim.

The source-context reduction is deterministic for this experiment: the model was structurally prevented from reading the full stylesheet.

## Product finding

Source attribution materially improved the agent integration without adding an explanatory AI layer.

The useful product boundary is now:

```text
rendered regression
      ↓
Viewportable structural finding
      ↓
exact responsive range
      ↓
deterministic authored source
      ↓
small local source context
      ↓
agent patch
      ↓
Viewportable verification
```

For this case, `viewportable_explain` was unnecessary.

The evidence itself was sufficient once it included a trustworthy source pointer.

## Consequences

1. Keep source attribution conservative. A missing source is preferable to a guessed source.
2. Continue treating direct and downstream structural effects separately.
3. Agent integrations should prefer attributed local context over broad repository reads.
4. Do not add line numbers until Viewportable has a trustworthy source-location mechanism.
5. Source maps / DevTools stylesheet locations are a reasonable next research direction for line-level attribution, but should not weaken the current deterministic standard.
6. The controlled OpenAI workflow remains an experiment, not permanent CI.

## Cleanup

The temporary OpenAI workflow and source-aware acceptance script were removed from the experiment branch after the successful run.

`OPENAI_API_KEY` was never exposed to the model or written to evidence; it remained a GitHub Actions secret used only by the controlled model-call step.
