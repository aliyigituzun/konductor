# Konductor Design Direction

## Design Goal

Konductor should feel like an operational control surface for software delivery, now including local Claude orchestration.

The UI should make four things obvious:

1. current project state
2. active blockers and decisions
3. what Claude is working on right now
4. what command and terminal output were produced

## Core Visual Rules

- keep the neutral editorial palette
- stay compact and information-dense
- treat the new terminal view as a debugging panel, not a hero element
- keep the header short and the tabs explicit

## Dashboard Additions

### Portfolio

- keep the table layout
- add active agent count
- add per-project info access

### Project Tabs

- `Status`
- `Features`
- `Agents`
- `Project Details`

### Features Tab

- feature cards remain the entry point
- item rows become selectable
- a launch panel sits beside the cards
- the panel must make it obvious which feature item Claude will receive

### Agents Tab

The Agents tab should read like an operator console:

- prompt packs summary
- Claude profile summary
- launch form
- running agents
- past agent tasks
- terminal/debug panel

### Terminal Panel

This is read-only and explicitly for debugging. It should show:

- exact launch command
- sanitized env summary
- rolling stdout/stderr
- exit state

### Project Info Surface

Each project needs a direct path-inspection affordance that reveals:

- repo-local Konductor files
- home-directory registry path
- home-directory host path

This is for debugging and operator trust, not for marketing polish.

## Interaction Guidance

- buttons should be clear and utilitarian
- hover states should be subtle
- active run controls should stand out, but not dominate the page
- destructive controls such as stop/delete should use semantic red

## What To Avoid

- no oversized launch hero
- no fake terminal chrome
- no decorative animations in the terminal/debug surface
- no hidden agent state behind nested interactions
