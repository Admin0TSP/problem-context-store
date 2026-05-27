/**
 * Build the User Guide DOCX with embedded screenshots.
 *
 *   Run from the repo root with:
 *     npm install docx
 *     node scripts/build-user-guide-docx.js
 *
 *   Outputs: docs/Problem-Context-Store-User-Guide.docx
 *   Inputs:  docs/screenshots/*.png
 */

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, ImageRun,
  Table, TableRow, TableCell,
  Header, Footer, AlignmentType, PageOrientation, LevelFormat,
  ExternalHyperlink, InternalHyperlink, Bookmark,
  TableOfContents, HeadingLevel, BorderStyle, WidthType, ShadingType,
  PageBreak, PageNumber, TabStopType, TabStopPosition,
} = require('docx');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCREENSHOTS_DIR = path.join(REPO_ROOT, 'docs', 'screenshots');
const OUT_PATH = path.join(REPO_ROOT, 'docs', 'Problem-Context-Store-User-Guide.docx');

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function H1(text /* bookmarkId ignored — docx-js auto-IDs collide */) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text, bold: true })],
  });
}

function H2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text, bold: true })],
  });
}

function H3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun({ text, bold: true })],
  });
}

function P(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text, ...opts })],
    spacing: { after: 120 },
  });
}

// Paragraph with mixed runs (e.g. some bold).
function Pmix(runs, opts = {}) {
  return new Paragraph({
    children: runs.map((r) => (typeof r === 'string' ? new TextRun(r) : new TextRun(r))),
    spacing: { after: 120, ...opts },
  });
}

function Bullet(text, level = 0) {
  return new Paragraph({
    numbering: { reference: 'bullets', level },
    children: [new TextRun(text)],
    spacing: { after: 80 },
  });
}

function BulletMix(runs, level = 0) {
  return new Paragraph({
    numbering: { reference: 'bullets', level },
    children: runs.map((r) => (typeof r === 'string' ? new TextRun(r) : new TextRun(r))),
    spacing: { after: 80 },
  });
}

function Num(text) {
  return new Paragraph({
    numbering: { reference: 'numbers', level: 0 },
    children: [new TextRun(text)],
    spacing: { after: 80 },
  });
}

function Code(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: 'Consolas', size: 20 })],
    spacing: { before: 80, after: 120 },
    shading: { fill: 'F4F4F1', type: ShadingType.CLEAR },
  });
}

function Caption(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text, italics: true, color: '71716A', size: 18 })],
    spacing: { after: 240 },
  });
}

function Image(filename, widthPx, caption) {
  const data = fs.readFileSync(path.join(SCREENSHOTS_DIR, filename));
  // Maintain aspect ratio assuming source 2880px wide; height is derived from
  // the file's real dimensions by reading the PNG header.
  const { width: srcW, height: srcH } = pngSize(data);
  const heightPx = Math.round(widthPx * (srcH / srcW));
  const img = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 240, after: 120 },
    children: [new ImageRun({
      type: 'png',
      data,
      transformation: { width: widthPx, height: heightPx },
      altText: {
        title: caption ?? filename,
        description: caption ?? filename,
        name: filename,
      },
    })],
  });
  return caption ? [img, Caption(caption)] : [img];
}

// Tiny PNG size reader (reads IHDR chunk).
function pngSize(buf) {
  // PNG signature: 8 bytes. IHDR: starts at byte 16 (length 4) + type 4 + width 4 + height 4
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

const border = { style: BorderStyle.SINGLE, size: 4, color: 'D3D3CC' };
const borders = { top: border, bottom: border, left: border, right: border };

function HeaderCell(text, width) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: 'F4F4F1', type: ShadingType.CLEAR },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 20 })] })],
  });
}

function BodyCell(text, width, opts = {}) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text, size: 20, ...opts })] })],
  });
}

// 2-column table (header row + body rows).
function Table2(headers, rows, [w1, w2] = [3120, 6240]) {
  const total = w1 + w2;
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: [w1, w2],
    rows: [
      new TableRow({ children: [HeaderCell(headers[0], w1), HeaderCell(headers[1], w2)] }),
      ...rows.map((r) => new TableRow({
        children: [BodyCell(r[0], w1), BodyCell(r[1], w2)],
      })),
    ],
  });
}

// 3-column table.
function Table3(headers, rows, [w1, w2, w3] = [2340, 2340, 4680]) {
  const total = w1 + w2 + w3;
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: [w1, w2, w3],
    rows: [
      new TableRow({ children: [HeaderCell(headers[0], w1), HeaderCell(headers[1], w2), HeaderCell(headers[2], w3)] }),
      ...rows.map((r) => new TableRow({
        children: [BodyCell(r[0], w1), BodyCell(r[1], w2), BodyCell(r[2], w3)],
      })),
    ],
  });
}

function spacer(h = 120) {
  return new Paragraph({ spacing: { after: h }, children: [new TextRun(' ')] });
}

// -----------------------------------------------------------------------------
// Content
// -----------------------------------------------------------------------------

const titlePage = [
  new Paragraph({ spacing: { before: 2400 }, children: [new TextRun('')] }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Problem Context Store', bold: true, size: 56, color: '0F0F0D' })],
    spacing: { after: 120 },
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'User Guide', size: 40, color: '5B4FE9' })],
    spacing: { after: 480 },
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({
      text: 'The customer-problem memory layer for B2B software companies.',
      italics: true, size: 26, color: '3A3A35',
    })],
    spacing: { after: 1200 },
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Version 0.1 · Built for Shipsy', size: 20, color: '71716A' })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'May 2026', size: 20, color: '71716A' })],
    spacing: { after: 480 },
  }),
  new Paragraph({ children: [new PageBreak()] }),
];

// -----------------------------------------------------------------------------
// Table of contents (manual, hyperlinked to bookmarks)
// -----------------------------------------------------------------------------

function TocItem(label) {
  return new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text: label, color: '3A3A35' })],
  });
}

const toc = [
  H1('Contents'),
  TocItem('1. What this tool is for'),
  TocItem('2. The one idea you need to understand'),
  TocItem('3. What’s on the screen'),
  TocItem('4. The Problem — the central object'),
  TocItem('5. Page tour'),
  TocItem('6. Quick Log — your most-used tool'),
  TocItem('7. Common workflows'),
  TocItem('8. Keyboard shortcuts'),
  TocItem('9. Glossary'),
  TocItem('10. What’s not in the dashboard yet'),
  TocItem('11. FAQ & troubleshooting'),
  new Paragraph({ children: [new PageBreak()] }),
];

// -----------------------------------------------------------------------------
// Section 1 — What this tool is for
// -----------------------------------------------------------------------------

const sec1 = [
  H1('1. What this tool is for'),
  P('When a customer hits a problem, the context of that problem ends up scattered across five or six different places: a Slack thread, a DevRev ticket, a GitHub pull request, a Gmail thread, a phone call you took at 3 pm, and maybe a hallway chat with engineering.'),
  P('Six months later, when the same customer hits "that thing again," you can’t reconstruct what happened. You re-investigate. You ask the dev who fixed it last time, who doesn’t remember either. You read three Slack threads and a ticket. You waste two hours.'),
  P('The Problem Context Store fixes this by giving every customer problem one durable home where all of that context lives — automatically gathered from your tools, plus a first-class way to capture the conversations that never made it into a tool.'),
  Pmix([
    { text: 'In short: ' },
    { text: 'it’s your institutional memory for customer problems.', bold: true },
  ]),
];

// -----------------------------------------------------------------------------
// Section 2 — The one idea
// -----------------------------------------------------------------------------

const sec2 = [
  H1('2. The one idea you need to understand'),
  Pmix([
    { text: 'There is one core noun: the ' },
    { text: 'Problem', bold: true },
    { text: '. Everything else hangs off it.' },
  ]),
  P('A Client (customer) has many Problems. Each Problem accumulates Events (Slack messages, DevRev tickets, GitHub PRs, emails), Manual Notes (calls, hallway conversations), Artifacts (the tickets and PRs themselves as enduring objects), and links to Related Problems.'),
  P('Every ticket, message, PR, call, and conversation is evidence about a Problem. You’re not organizing tickets — you’re organizing problems. The Problem is the thing your future self will need to find.'),
  P('That mental shift is the whole product.'),
];

// -----------------------------------------------------------------------------
// Section 3 — What's on the screen
// -----------------------------------------------------------------------------

const sec3 = [
  H1('3. What’s on the screen'),
  P('When you open the dashboard, you see three regions: a sidebar on the left, a topbar across the top of the content area, and the main page below.'),
  ...Image('01-dashboard.png', 600, 'The dashboard at a glance — sidebar on the left, topbar with the Quick Log button, and the problems table.'),
  H3('Sidebar (left, always visible)'),
  Bullet('Workspace tile (top) — shows which workspace you’re in. For Shipsy users, this says "Shipsy".'),
  Bullet('Primary nav — Problems, Clients, Manual notes, Activity.'),
  Bullet('Setup — Connectors, Settings.'),
  Bullet('Your user tile (bottom) — your name and email.'),
  H3('Topbar (above the page content)'),
  Bullet('Page title — e.g. "Problems", "Acme Logistics", or "Problem · Acme Logistics".'),
  Bullet('Subtitle — quick counts (e.g. "1 open · 2 shown").'),
  Bullet('Quick Log button — visible on every page. Press ⌘K (Mac) or Ctrl+K to open from anywhere.'),
  Bullet('Primary action — page-specific (e.g. "New problem" on the dashboard).'),
  H3('Main content area'),
  P('The page itself. Most pages are read-only with a couple of buttons or dropdowns for the actions specific to that page.'),
];

// -----------------------------------------------------------------------------
// Section 4 — The Problem object
// -----------------------------------------------------------------------------

const sec4 = [
  H1('4. The Problem — the central object'),
  P('Every Problem has these fields. Knowing what they mean is the difference between using the tool well and using it poorly.'),

  H3('Title'),
  P('A short, scannable description of what the customer is experiencing — not what we are investigating.'),
  Bullet('Good: "COD reconciliation mismatch for Mumbai hub"'),
  Bullet('Less good: "investigating COD" (vague)'),
  Bullet('Bad: "TKT-9821" (it’s just a ticket number)'),
  P('The Problem belongs to the customer’s world. The ticket number lives in DevRev. Don’t confuse them.'),

  H3('Status — the lifecycle stages'),
  P('There are seven statuses, in a roughly time-ordered flow:'),
  Table2(['Status', 'What it means / when to set it'], [
    ['Open', 'New, no one has picked it up. Set the moment you log the problem.'],
    ['Investigating', 'Someone is actively figuring out what’s wrong. Set after the triage call.'],
    ['In progress', 'Root cause found, fix being built. Set when dev work starts.'],
    ['Awaiting customer', 'Blocked on the customer for info, decision, or retest.'],
    ['Resolved', 'Fix shipped, customer confirmed. The "Resolved" timestamp auto-fills.'],
    ['Closed', 'Resolved plus any wrap-up (credit memo, post-mortem). Optional.'],
    ['Archived', 'Hidden from default views. For old issues you don’t want to see daily.'],
  ]),
  P('Changing status writes to the audit log so you can prove who moved it and when.', { italics: true }),

  H3('Severity — four levels'),
  P('How bad it is for the customer right now:'),
  Table2(['Severity', 'Examples'], [
    ['Critical', 'Production down, money being lost in real time, multiple customers affected.'],
    ['High', 'One customer significantly impacted but operations continuing; data integrity issue.'],
    ['Medium', 'Annoying bug, workaround exists, no immediate revenue risk.'],
    ['Low', 'Cosmetic, nice-to-have, no operational impact.'],
  ]),
  P('Severity should reflect current customer impact, not "how interesting the engineering problem is."', { italics: true }),

  H3('First seen / Resolved timestamps'),
  Bullet('First seen — when the problem first surfaced. The dashboard sorts by this.'),
  Bullet('Resolved — auto-filled when you flip the status to Resolved. Cleared if you reopen.'),

  H3('Summaries (Approach / Root cause / Resolution)'),
  P('Three short paragraphs that get regenerated by an LLM every time the Problem accumulates significant new events. Right now (until the intelligence layer is built) these are seeded by hand or written manually.'),
  Bullet('Approach — "What is the team trying?" Useful while the problem is open.'),
  Bullet('Root cause — "What was actually wrong?" Useful after diagnosis.'),
  Bullet('Resolution — "What did we ship to fix it?" Useful at and after closure.'),
  P('This trio is the most important read-it-six-months-later artifact in the whole tool. When the problem is closed, these are what you remember.'),

  H3('Tags'),
  P('Free-form labels. The seeded problem uses tags like "cod", "reconciliation", "reports".'),

  H3('Linked artifacts'),
  P('The enduring source-system objects attached to this Problem — tickets, PRs, docs, meetings, recordings. Distinct from Events: a ticket is one Artifact, but it generates many Events (created, commented, updated, resolved).'),

  H3('Related problems'),
  P('Other Problems linked to this one. Five kinds of link:'),
  Bullet('Related — broadly similar, helpful to see together.'),
  Bullet('Duplicate — same problem captured twice.'),
  Bullet('Parent / Child — one problem is a component of a bigger one.'),
  Bullet('Caused by — this problem is a downstream effect of another.'),
];

// -----------------------------------------------------------------------------
// Section 5 — Page tour
// -----------------------------------------------------------------------------

const sec5 = [
  H1('5. Page tour'),

  H2('Dashboard — list of problems'),
  Pmix([{ text: 'URL: ', bold: true }, { text: '/dashboard', font: 'Consolas' }]),
  P('The home screen. Shows every Problem in your workspace.'),
  ...Image('01-dashboard.png', 600, 'Dashboard: filters across the top, problems table below.'),
  H3('Columns'),
  Bullet('Problem — title and a one-line description preview. Click anywhere on the row to open it.'),
  Bullet('Client — which customer.'),
  Bullet('Status — the lifecycle pill (Open, Investigating, etc.).'),
  Bullet('Severity — Low / Medium / High / Critical.'),
  Bullet('Activity — event count and manual-note count, side by side.'),
  Bullet('First seen — relative time (e.g. "3 days ago").'),
  H3('Filters'),
  Bullet('Status chips — quick toggles for All / Open / Investigating / In progress / Awaiting customer / Resolved.'),
  Bullet('Severity dropdown — filter to Critical / High / Medium / Low.'),
  Bullet('Client dropdown — narrow to one client.'),
  Bullet('Apply — applies the current dropdown selections to the URL.'),
  Bullet('Reset — clears all filters.'),
  P('The header subtitle tells you "X open · Y shown." X is the true count of open problems in the workspace; Y is how many match your current filter.'),

  H2('Problem detail — the hero screen'),
  Pmix([{ text: 'URL: ', bold: true }, { text: '/problems/[id]', font: 'Consolas' }]),
  P('This is where you’ll spend most of your time. Five regions, all on one page:'),
  ...Image('02-problem-detail.png', 600, 'Problem detail: breadcrumb, status/severity dropdowns, summaries, cross-source timeline, and the artifacts rail.'),
  H3('Region 1: Breadcrumb + title'),
  Bullet('Client name (link — click to see all problems for that client).'),
  Bullet('The big Problem title.'),
  H3('Region 2: Header controls'),
  Bullet('Status dropdown — change it; saves automatically as soon as you select.'),
  Bullet('Severity dropdown — same. Saves on change.'),
  Bullet('Right-aligned: "First seen X ago. Resolved Y ago" (the second part only appears if resolved).'),
  P('You don’t need to click a Save button. The select acts as the form trigger.'),
  H3('Region 3: Description'),
  P('A paragraph block — the longer "what’s the customer experiencing in their own words" text. Only shows if a description exists.'),
  H3('Region 4: Three summary cards — Approach / Root cause / Resolution'),
  P('Side-by-side cards. Each shows either generated text (if the LLM has been run, or if a human filled them in) or an italic placeholder hint. These cards are the answer to "what is this problem and how was it handled" — written for your future self.'),
  H3('Region 5: Timeline (the heart of the tool)'),
  P('A chronological, vertical list of everything that happened on this Problem. Each row is one of:'),
  Bullet('An Event — a message, ticket update, PR action, email. Color-coded by source (purple for Slack, indigo for DevRev, ink for GitHub, red for Gmail, etc.). Shows the actor, source, kind (e.g. "PR opened", "message"), and an "Open in [Source]" link.'),
  Bullet('A Manual Note — green-tinted, with a sticky-note icon. Shows the channel ("Phone call", "Hallway"…), the participants, and the body.'),
  P('Events and Manual notes are interleaved by timestamp. You read the Problem the way you’d read a journal: top to bottom in time.'),
  P('The "Add manual note" button at the top of this section is a shortcut to log a note pre-attached to this Problem.'),
  H3('Region 6: Right rail (three cards stacked)'),
  Bullet('Linked artifacts — tickets, PRs, docs, meetings tied to this Problem.'),
  Bullet('Related problems — linked via duplicate / related / parent-child / caused-by edges.'),
  Bullet('Meta — created / updated / first seen / resolved timestamps.'),

  H2('Clients — list & detail'),
  Pmix([{ text: 'URL: ', bold: true }, { text: '/clients and /clients/[slug]', font: 'Consolas' }]),
  P('A table of every Client in the workspace. Columns: Client name, Domain, Status (Active / Churned / Prospect / Archived), Problem count, Event count.'),
  ...Image('04-clients-list.png', 600, 'Clients list — every customer your workspace serves, with quick activity counts.'),
  P('Click a row to drill into a Client. The detail page shows four stat cards (Tier, ARR, Domain, Account owner) and a full table of that client’s problems.'),
  ...Image('05-client-detail.png', 600, 'Client detail — quick stats up top, every problem this client has ever had below.'),
  P('Useful when prepping for a customer call: open the Client page, scan their open problems, then scan their recent resolved ones to see what you’ve fixed lately.'),

  H2('Manual notes'),
  Pmix([{ text: 'URL: ', bold: true }, { text: '/notes', font: 'Consolas' }]),
  P('Every note you’ve ever captured via Quick Log, regardless of which Problem (if any) it’s attached to.'),
  ...Image('06-notes.png', 600, 'All manual notes captured across the workspace.'),
  P('Each note card shows the author, time, channel pill ("Phone call", "WhatsApp"…), optional title, the body (truncated to four lines), and "Attached to [Problem] · [Client]" if linked.'),
  P('Particularly useful when you’ve captured something without attaching it to a Problem yet ("note to self: customer hinted at churn risk during dinner") and want to come back to it later.'),

  H2('Activity'),
  Pmix([{ text: 'URL: ', bold: true }, { text: '/activity', font: 'Consolas' }]),
  P('The audit log for the workspace. Every state-changing action your team has taken appears here.'),
  ...Image('07-activity.png', 600, 'Audit log — every mutation, who did it, and when.'),
  P('It’s a trust artifact. When a customer asks "who marked this resolved and when?" — this page is the answer.'),

  H2('Connectors'),
  Pmix([{ text: 'URL: ', bold: true }, { text: '/connectors', font: 'Consolas' }]),
  P('Two sections: Installed connectors (currently the seeded Slack and DevRev, both marked PENDING because no real OAuth has been done) and Available connectors (Slack / DevRev / GitHub / Gmail, currently disabled until M8 ships).'),
  ...Image('08-connectors.png', 600, 'Connector inventory — install surface arriving in M8.'),
  P('Until M8 is built, this page is informational. After M8, this is where you’ll connect your real Slack workspace, DevRev org, GitHub org, and Gmail.'),

  H2('Settings'),
  Pmix([{ text: 'URL: ', bold: true }, { text: '/settings', font: 'Consolas' }]),
  P('Workspace info (name, slug, created date, your role) and your user info (name, email). Currently read-only.'),
  ...Image('09-settings.png', 600, 'Settings — workspace metadata and your profile.'),
  P('M2 brings invites, profile editing, workspace renames. M10 brings billing.'),

  H2('Create a new problem'),
  Pmix([{ text: 'URL: ', bold: true }, { text: '/problems/new', font: 'Consolas' }]),
  P('A simple form: pick a Client, give the problem a title, optionally write a description, and choose a severity. After saving, you land on the new problem’s detail page.'),
  ...Image('10-new-problem.png', 600, 'New problem form — the only required fields are Client and Title.'),
];

// -----------------------------------------------------------------------------
// Section 6 — Quick Log
// -----------------------------------------------------------------------------

const sec6 = [
  H1('6. Quick Log — your most-used tool'),
  P('Quick Log is the most important capture surface in the tool, because it solves the problem nothing else does: the conversation that never made it into a tool.'),
  ...Image('03-quick-log-open.png', 600, 'Quick Log — minimal fields, fast to fill, easy to attach to a Problem.'),
  H3('Three ways to open it'),
  Num('Press ⌘K (Mac) or Ctrl+K (Win/Linux) from any page.'),
  Num('Click "Quick log" in the topbar.'),
  Num('From a Problem detail page, click "Add manual note" — same sheet, but pre-attached to the current Problem.'),
  H3('The fields'),
  Table3(['Field', 'Required?', 'Notes'], [
    ['What happened?', 'Yes', 'The body. The only thing you must fill in. Type free-form.'],
    ['Channel', 'No', 'Defaults to Other. Options: Phone call, In-person meeting, WhatsApp, Hallway, Customer visit, Conference, Text message, Other.'],
    ['Attach to problem', 'No', 'Pick a Problem to link this note to. Leave unattached for scratchpad-style notes.'],
    ['Participants', 'No', 'Comma-separated names. E.g. Rajesh (Acme), Priya'],
    ['Title', 'No', 'A short label. Helpful for skimming the Notes page later.'],
  ]),
  H3('Behavior'),
  Bullet('Hit Esc or click outside the sheet to cancel.'),
  Bullet('Click "Save note" — saves, shows "Saved ✓", auto-closes after a beat.'),
  Bullet('The submit button is disabled while saving, so double-clicks don’t create duplicates.'),
  H3('Pro tips'),
  Bullet('Don’t aim for perfection. A 2-line note is better than no note.'),
  Bullet('Use channel honestly. Future you will thank you for knowing whether the context came from a phone call or a casual hallway chat.'),
  Bullet('Attach to a Problem when you can.'),
];

// -----------------------------------------------------------------------------
// Section 7 — Common workflows
// -----------------------------------------------------------------------------

const sec7 = [
  H1('7. Common workflows'),

  H3('"A customer just emailed me about an issue. What do I do?"'),
  Num('Press ⌘K to open Quick Log.'),
  Num('Channel: "Other" (or "Phone call" if you also called them).'),
  Num('Body: paste a summary of what they said.'),
  Num('Leave "Attach to problem" as "— unattached —" for now.'),
  Num('Save.'),
  P('Then: go to /problems/new, create a Problem for the customer’s issue, paste the same summary into the description, and set severity. Once the Problem exists, you can attach the note to it.'),
  P('When connectors are live (M8), the email itself becomes an Event and the resolution layer attaches it to the right Problem automatically. Quick Log only remains for things that didn’t happen in a tool.', { italics: true }),

  H3('"We just had a triage call. How do I record what was decided?"'),
  Num('From the Problem detail page, click "Add manual note".'),
  Num('Channel: "Phone call".'),
  Num('Participants: who was on the call.'),
  Num('Body: write the decisions, not the chat. E.g. "Decided to prioritize the timezone bug over the report caching one. Priya owns. ETA Friday."'),
  Num('Update the Problem’s status to "In progress" using the header dropdown.'),

  H3('"An issue is fixed — how do I close it?"'),
  Num('Open the Problem.'),
  Num('Change Status to "Resolved" using the dropdown.'),
  Num('The "Resolved" timestamp auto-fills.'),
  Num('Once the LLM layer ships, the Resolution summary regenerates from the timeline.'),
  P('If a credit memo or other paperwork is needed, you can move it to "Closed" once that’s done.'),

  H3('"Show me every open Critical issue across all clients."'),
  Num('On /dashboard, click the "Open" status chip.'),
  Num('Change severity dropdown to "Critical".'),
  Num('Click Apply.'),
  P('URL becomes /dashboard?status=OPEN&severity=CRITICAL&client=ALL. Bookmark it.'),

  H3('"Show me everything for Acme Logistics."'),
  Bullet('From /clients, click "Acme Logistics".'),
  Bullet('Or on /dashboard, set the client dropdown to Acme and Apply.'),
  Bullet('Or visit /clients/acme-logistics directly.'),

  H3('"Has this same problem happened before?"'),
  P('For now: open the Problem, look at "Related problems" in the right rail. Until the resolution + intelligence layers ship, this is manually curated. After they ship, the tool will suggest related problems automatically based on event content similarity.'),
];

// -----------------------------------------------------------------------------
// Section 8 — Keyboard shortcuts
// -----------------------------------------------------------------------------

const sec8 = [
  H1('8. Keyboard shortcuts'),
  Table2(['Shortcut', 'What it does'], [
    ['⌘K / Ctrl+K', 'Open Quick Log from anywhere'],
    ['Esc', 'Close Quick Log (without saving)'],
  ]),
  P('More shortcuts are planned (G P to go to Problems, G C to Clients, etc. — Linear-style).'),
];

// -----------------------------------------------------------------------------
// Section 9 — Glossary
// -----------------------------------------------------------------------------

const sec9 = [
  H1('9. Glossary'),
  Table2(['Term', 'Meaning'], [
    ['Workspace', 'The tenant boundary. Shipsy is one workspace. Every Client, Problem, and Event belongs to a workspace.'],
    ['User', 'A human with an account. Can belong to many workspaces.'],
    ['Membership', 'The join between User and Workspace. Carries the user’s role (Owner / Admin / Member / Viewer).'],
    ['Client', 'The customer your workspace serves (e.g. Acme, Globex).'],
    ['Problem', 'The canonical noun. A thing the customer is experiencing that you’re tracking, resolving, or have resolved.'],
    ['Event', 'A normalized cross-source activity record — one Slack message, one ticket comment, one PR merge.'],
    ['Manual note', 'A first-class capture of an off-tool conversation. Has a channel (Hallway, Phone call, etc.).'],
    ['Artifact', 'An enduring object in a source system linked to a Problem (ticket, PR, doc, meeting). Distinct from Events.'],
    ['Connector', 'A per-workspace install of a source system. Brings Events in.'],
    ['Audit log', 'The append-only history of who did what when.'],
    ['Resolution layer', 'The component that decides which Client and which Problem an incoming Event belongs to.'],
    ['Embedding', 'A vector representation of text used for semantic search and problem clustering.'],
    ['Severity', 'How bad the Problem is for the customer right now. Low / Medium / High / Critical.'],
    ['Status', 'Where the Problem is in its lifecycle. Open / Investigating / In progress / Awaiting customer / Resolved / Closed / Archived.'],
  ]),
];

// -----------------------------------------------------------------------------
// Section 10 — Not yet
// -----------------------------------------------------------------------------

const sec10 = [
  H1('10. What’s not in the dashboard yet'),
  P('Being transparent about what you’ll see and what you won’t:'),
  Table2(['Feature', 'Status'], [
    ['Real Slack / DevRev / GitHub / Gmail ingestion', 'Not yet — ingestion framework + connectors'],
    ['LLM-generated Approach / Root cause / Resolution summaries', 'Not yet — intelligence layer'],
    ['Semantic search across all Problems', 'Not yet — intelligence layer'],
    ['Auto-suggested related Problems', 'Not yet — resolution + intelligence layers'],
    ['Real authentication (magic links / Google / SSO)', 'Not yet — auth module'],
    ['Workspace invites + RBAC', 'Not yet — auth module'],
    ['Editing a manual note in place', 'Not yet — UI refinement'],
    ['Deleting a Problem', 'Not yet — admin panel'],
    ['Slack bot (/log, bookmark reactions)', 'Not yet — surfaces module'],
    ['Email-in address per workspace', 'Not yet — surfaces module'],
    ['Browser extension', 'Not yet — surfaces module'],
    ['Billing', 'Not yet — admin/ops module'],
  ]),
  P('What you can test today: creating Problems, updating their status and severity, logging manual notes (attached or unattached), filtering the dashboard, browsing clients, and watching the audit log fill up as you act.'),
];

// -----------------------------------------------------------------------------
// Section 11 — FAQ
// -----------------------------------------------------------------------------

const sec11 = [
  H1('11. FAQ & troubleshooting'),

  H3('"I don’t see any data on the dashboard."'),
  P('If you just set this up, run the seed command from the project root. That loads the demo workspace (Shipsy + Acme + Globex with two example problems). If you’ve already seeded, check the filters — you might have a stale ?status=… in the URL. Click "Reset."'),

  H3('"I made a change but the page didn’t update."'),
  P('The page should auto-refresh after a Server Action runs (status change, severity change, note save). If it doesn’t, hit refresh once. If that becomes a recurring issue, that’s a bug — report it.'),

  H3('"Where is the data physically stored?"'),
  P('In your Supabase Postgres instance (or whatever Postgres you pointed DATABASE_URL at). You can see the raw rows in Supabase’s Table Editor.'),

  H3('"How do I add a new client?"'),
  P('Not exposed in the UI yet. For now, edit the seed file and re-run the seed command, or insert directly via Supabase’s Table Editor. Inline client creation lands with the auth module.'),

  H3('"Quick Log saved a note but I want to attach it to a Problem after the fact."'),
  P('For now: re-log the note from the Problem detail page (which auto-attaches), and delete the unattached one from Supabase. A proper "attach this note" action is a planned refinement.'),

  H3('"I can’t tell the difference between an Event and a Manual Note. Why does it matter?"'),
  P('Both appear on the Problem timeline. The visual difference: Events are white cards; Manual Notes are green-tinted with a sticky-note icon. The conceptual difference: an Event came from a tool (has a source, an actor who lives in that tool, and an "Open in [tool]" link); a Manual Note came from a human typing into Quick Log (has a channel and a list of participants).'),
  P('When connectors are live, Events will flow in automatically; Manual Notes will always be by-hand.'),

  H3('"What’s the difference between Status: Closed and Status: Resolved?"'),
  Bullet('Resolved = the customer’s problem is fixed.'),
  Bullet('Closed = Resolved plus any wrap-up (credit memo, post-mortem doc, customer email confirming, etc.).'),
  P('If your team doesn’t have wrap-up steps, just use Resolved. Closed is optional.'),

  H3('"I changed the status but Activity still shows the old status."'),
  P('The activity log records that you changed it — it shows the action, not the current state. Click into the Problem to see the current status.'),

  H3('"Why are there two storage spots in the schema (Event and Artifact)?"'),
  P('Because they answer different questions. An Event answers "what happened?" (a point in time). An Artifact answers "what object lives in the source system?" (an enduring thing). A single DevRev ticket is one Artifact, but as it gets created, commented on, and resolved, it generates multiple Events.'),
];

// -----------------------------------------------------------------------------
// Closing
// -----------------------------------------------------------------------------

const closing = [
  H1('You’re set.'),
  P('If anything in this guide is unclear, that’s a documentation bug — flag it. If the tool itself does something that contradicts this guide, that’s a tool bug — flag it. Either way, capture it as a Quick Log note tagged "internal feedback" and we’ll work through it.'),
  Pmix([
    { text: 'The most important habit you can build: ' },
    { text: 'press ⌘K whenever a customer conversation happens off-tool.', bold: true },
    { text: ' Even a one-line note is enough. Six months from now, the version of you sitting on a call with that customer will be grateful.' },
  ]),
];

// -----------------------------------------------------------------------------
// Assemble document
// -----------------------------------------------------------------------------

const doc = new Document({
  creator: 'Problem Context Store',
  title: 'Problem Context Store — User Guide',
  description: 'A complete walkthrough of the dashboard.',
  styles: {
    default: { document: { run: { font: 'Calibri', size: 22 } } },
    paragraphStyles: [
      {
        id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 36, bold: true, font: 'Calibri', color: '0F0F0D' },
        paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 },
      },
      {
        id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 28, bold: true, font: 'Calibri', color: '0F0F0D' },
        paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 1 },
      },
      {
        id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, font: 'Calibri', color: '3A3A35' },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 },
      },
      {
        id: 'Hyperlink', name: 'Hyperlink', basedOn: 'Normal',
        run: { color: '5B4FE9', underline: { type: 'single' } },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [
          {
            level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } },
          },
        ],
      },
      {
        reference: 'numbers',
        levels: [
          {
            level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } },
          },
        ],
      },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 }, // US Letter
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: 'Problem Context Store · User Guide', size: 18, color: '71716A' })],
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: 'Page ', size: 18, color: '71716A' }),
            new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '71716A' }),
          ],
        })],
      }),
    },
    children: [
      ...titlePage,
      ...toc,
      ...sec1,
      ...sec2,
      ...sec3,
      ...sec4,
      ...sec5,
      ...sec6,
      ...sec7,
      ...sec8,
      ...sec9,
      ...sec10,
      ...sec11,
      ...closing,
    ],
  }],
});

// -----------------------------------------------------------------------------
// Pack & save
// -----------------------------------------------------------------------------

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(OUT_PATH, buffer);
  console.log('Wrote ' + OUT_PATH + ' (' + buffer.length + ' bytes)');
});
