# Docs

| File | What it is |
|---|---|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Module-by-module deep dive. The map every future module references. |
| [`USER_GUIDE.md`](./USER_GUIDE.md) | Markdown user guide for the dashboard. |
| [`Problem-Context-Store-User-Guide.docx`](./Problem-Context-Store-User-Guide.docx) | Polished Word version of the user guide, with embedded screenshots. |
| `screenshots/` | Source images used by the .docx. Re-captured from the live dashboard. |

To regenerate the .docx after the UI changes:

```bash
npm install docx
node scripts/build-user-guide-docx.js
```

The script reads from `docs/screenshots/*.png` and writes to `docs/Problem-Context-Store-User-Guide.docx`.
