# Konductor Design Direction

## Visual Character

Konductor is a GitHub- and code-editor-like control surface for local
agent-assisted delivery: calm, compact, neutral, and operational. Project state,
blockers, active work, and the relevant terminal context should be easy to scan.

### Core rules

- Use GitHub-like surfaces, borders, underline tabs, tables, and compact controls.
- Use editor-like navigation: a persistent project header, a Status sidebar, and a
  file tree with a line-numbered reader in Project Details.
- Light and dark are first-class themes. CSS variables in
  `apps/web/src/styles/tokens.css` define both palettes. Configuration offers system,
  light, and dark choices; system follows `prefers-color-scheme`.
- Keep the 14px UI type scale, mono type for code and terminal output, 40px data
  rows, 6px radii, and 52px header.
- Prefer labels, counts, and short empty states. Reserve colour for semantic state
  and destructive actions.
- Shared primitives belong in `styles/ui.css`; component styles are co-located.
  Avoid gradients, large shadows, fake terminal chrome, and decorative animation.

## Navigation and Surfaces

### Portfolio

The table-first overview shows project state, blockers, activity, token use, and a
direct path-information affordance. Its bottom-left Project Profile switcher is the
only place a profile can be switched and the entry point for Project Profile
configuration.

### Project navigation

The project header contains underline tabs for Status, Features, Agents, Assets,
Reviews, and Project Details, plus a configuration control for project-scoped general,
integrations, remote, token, and authentication settings. On small screens, preserve access to all
tabs before adding decoration or secondary controls.

- Status uses a left “On this page” navigator for updates, blockers, decisions,
  dependencies, token use, and activity. Decision rows open one dialog: open
  decisions offer option cards, feature links, features to create, rationale, and an
  optional agent hand-off; resolved decisions are read-only with their outcome.
- Features keeps feature work and its launch context together. Feature phases are
  multi-select filters above the category grid; selecting several phases shows the
  union of their features and hides categories without matches.
- Agents is the operator console: harness-first launch, configuration, active fleet,
  and completed tasks.
- Assets is an integrated project workspace, never a separate studio.
- Reviews stacks three sections: preview instances (branch, port, status, output),
  review links (shown once, then listed with state), and change requests with an
  inline status control. The customer page at `/review/:token` frames the preview,
  keeps the page list and pointer inspector at the sides, and never shows operator
  controls.
- Project Details uses a lazy file tree and a readable markdown, image, PDF, or text
  viewer. Hide `.git`, `node_modules`, and build output.

### Agent inspection

Surface the harness, project, tmux pane, branch, status, and attach command. The
dashboard terminal is a read-and-send mirror, not a full browser terminal. Keep
inspection clear and utilitarian.

### Asset manager

The locked state explains what enabling the feature does. The active workspace is
a drive-style explorer: the section header is a breadcrumb (`Assets › 3D ›
Characters`) whose segments navigate up, the body lists child folders before the
assets of the current folder, and the page grows downward rather than scrolling
inside the section. Loose assets appear inline at the root; the word
"Uncategorized" is never shown. Folder tools (instruction, agent-upload lock,
metadata, move, delete) sit in a single row under the header only while inside a
folder. Assets and folders move through a destination picker, not drag and drop. Asset
approval queues and public asset sharing remain placeholders, not implied
functionality.

### Project profiles

Project Profiles are account-like portfolio contexts and must not be confused with
agent profiles. The current switcher is an overview-only browser prototype. It must
not appear in a project header or on project, agent, asset, or review pages.

## Interaction Guidance

- Use clear utilitarian buttons and subtle hover states.
- Make current action, failure, and recovery information obvious.
- Keep destructive actions explicit and semantic red.
- Do not hide agent state behind nested interactions or marketing-style hero blocks.
