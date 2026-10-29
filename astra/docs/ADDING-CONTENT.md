# Adding content

There are two kinds of content, and they are added differently.

1. **Guides, templates, workflows, shortcuts** are written into small files in `js/seed/`.
2. **Documents** (PDFs and Word files) go in `library/` and are indexed by a build step so every page is searchable.

After adding either, reload the extension (or the page). Run `npm test` to check nothing is broken.

**Changing a built-in guide, template or workflow?** Run `npm run seeds` before committing. It records every past version (from git history) in `js/seed/history.js`, so copies people have not edited are updated to the new wording when Astra next opens, while anything they changed is left alone. A built-in item removed from `js/seed/` is also removed from workspaces that never edited it. `npm test` fails if this step was missed.

Facts that come from the team rather than a supplier document (account numbers, phone menu options, our own addresses) go in `js/seed/company.js`, in guides marked `owner: "company"`. Everything else that can be clicked to copy must appear word for word in a library document; `npm test` checks it.

Write guides for the reader: steps, checks and facts. Leave out notes about how the guide was written or what a source document got wrong; just give the correct instruction.

---

## Adding a document to the library

1. Copy the file into `library/<category folder>/` (for example `library/yealink/`). Keep a clean file name; it becomes the download name.
2. **Word files:** also produce a PDF with the same name, so it can be opened in the browser and searched.
   `soffice --headless --convert-to pdf --outdir <folder> "<file>.docx"`
   Keep the `.docx` next to it: Astra offers both.
3. Add an entry to `library/manifest.json`:
   ```json
   {
     "id": "yealink-t54w",
     "title": "Yealink T54W Quick Guide",
     "category": "Yealink",
     "kind": "Quick guide",
     "file": "yealink/Yealink T54W Quick Guide.pdf",
     "original": "yealink/Yealink T54W Quick Guide.docx",
     "summary": "One or two sentences on what it covers.",
     "tags": ["yealink", "t54w", "desk phone"]
   }
   ```
   `original` is optional. A new category must also be added to the `categories` list at the top.
4. Build the index:
   ```
   npm run library
   ```
   This needs `pdftotext` and `pdfinfo` from poppler-utils. It rewrites `js/library/docs.js` and `js/library/index.js`. Commit both.
5. **Scanned or image-only PDFs** have no text to search. The build stops and tells you. Write what the pages say into `tools/transcripts/<name>.txt`, one page per form-feed character (`\f`), and add `"transcript": "<name>.txt"` to the manifest entry. Two documents already work this way.
6. Leave out duplicates, empty files and anything internal (passwords, training links, notes, another provider's branding or support numbers). Everyone who uses Astra can read and download the library.

Documents are plain files in the repository. Anything in them, including passwords, is searchable and downloadable by anyone who can open Astra or the repository.

---

## Adding a guide (Knowledge)

Guides live in `js/seed/knowledge-*.js`. Start a new file for each supplier or topic, and add a `<script>` line for it in `index.html` with the other seed files, before `js/seed/history.js` and `js/library/docs.js`.

```js
(function (seed) {
  const L = (...lines) => lines.join("\n");
  seed.knowledge.push({
    id: "kb-yealink-t54w-reset", // unique, never changes
    title: "Yealink T54W: factory reset",
    type: "How-to", // Fault, How-to, Reference, Guide or Example
    category: "Yealink", // becomes a filter chip, keep it consistent
    quick: "Reset a T54W", // optional: adds a button to the Fault finder
    tags: ["yealink", "t54w", "reset"], // words people will search for
    summary: "One line shown in the list.",
    rich: true, // use the formatting below
    body: L("## Steps", "1. Press and hold `OK` for 10 seconds.", "2. Confirm the reset."),
    docs: [{ id: "yealink-t54w", find: "Factory reset", label: "Reset steps" }],
    related: ["kb-yealink-reprovision"],
  });
})(window.AstraSeed);
```

### Formatting (`rich: true`)

| Write                              | Result                                                              |
| ---------------------------------- | ------------------------------------------------------------------- |
| `## Heading`                       | A heading                                                           |
| `- text`                           | A bullet                                                            |
| `1. text`                          | A numbered step (numbering carries on after a break)                |
| `> text`                           | A highlighted note                                                  |
| `**text**`                         | Bold                                                                |
| `` `text` ``                       | Code that copies when clicked (use it for URLs, commands and codes) |
| `\| a \| b \|` then `\|---\|---\|` | A table                                                             |

HTML in a guide is always shown as text, never run.

### Linking a guide to its source

`docs` entries say where the guide came from. `find` is a phrase **copied word for word from the page**: Astra finds the page at runtime, so it still works if a document is replaced. `npm test` fails if a phrase is not on any page of that document, which catches typos.

`related` lists other guide ids shown as buttons at the foot of the guide. A workflow can show a **Read the guide** button with `guide: "<knowledge id>"`.

---

## Templates, workflows and shortcuts

| File                                  | List                            | Shown in                               |
| ------------------------------------- | ------------------------------- | -------------------------------------- |
| `templates.js`                        | templates                       | Templates, Home (if `favourite: true`) |
| `workflows.js`, `workflows-faults.js` | workflows                       | Workflows                              |
| `knowledge.js`, `knowledge-*.js`      | knowledge                       | Knowledge                              |
| `shortcuts.js`                        | shortcuts                       | Home, Systems                          |
| `profile.js`                          | default name, company, initials | Toolkit, case note stamp               |

```js
// Template. Fields use {name}. Known: customer, ticket, site, mobile, date, timeslot.
{ id: "tpl-example", title: "...", category: "Faults", tags: ["..."], favourite: false, useCount: 0,
  body: "Hi {customer},\n\n...\n\nKind regards," }

// Workflow
{ id: "wf-example", title: "...", category: "Horizon", tags: ["..."], steps: ["First", "Second"], guide: "kb-..." }
```

## Rules for ids

- **An `id` must be unique and never change.** Astra records which built-in ids a workspace has been offered, so a new id appears once in existing workspaces and a deleted item stays deleted. Renaming or reusing an id will not update workspaces that already have it.
- To change a built-in item for everyone, give it a new id and stop shipping the old one.
- Items from the first release are listed in `js/seed/baseline.js`; leave that file alone.
