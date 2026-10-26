---
name: touchbar-component
description: Create or update an Awesome Touch Bar DIY component manifest, validate its behavior and prepare an optional community contribution. Use for timer, alarm, counter, checklist, text and link widgets in this Windows bar.
---

# Touch Bar component workflow

Read [the widget contract](references/widget-contract.md) before generating a manifest. The app also supplies that contract directly to Codex, Claude Code or Pi; no global skill installation is required for in-bar DIY.

1. Translate the user's request into one supported kind. Preserve the component ID when editing. If the request needs an unsupported capability, explain the limitation rather than inventing a working API.
2. Return one JSON manifest. Do not emit executable JavaScript, HTML, shell commands, credentials or external dependencies. Keep the name short enough for a 48 DIP bar; choose an allowed icon and color. Timer/alarm components start inactive and need a user gesture to begin.
3. Validate with `node scripts/validate-community.cjs path/to/widget.json`. Validation must reject unknown fields, unsafe URLs, invalid ranges and duplicate IDs. Correct validation failures before installation.
4. Test the user-visible behavior in mock mode. Check horizontal and vertical layout, overflow scrolling, keyboard focus, persistence, NEW badge clearing, update and rollback. Never change actual audio volume, mute or media playback during testing.
5. Install through the plugin store. A complete validated definition is committed atomically; an update retains the previous manifest for rollback. Do not rewrite application source or package files to add a component.
6. For optional sharing, export only the manifest. Place it at `community/<id>/widget.json`, document what it does and its limits, and open a pull request only when the user requests sharing. Do not include local runtime state, prompts, AI logs or account files. Community likes can use GitHub PR reactions; no fabricated local popularity counts.

For app-level changes, retain the compact dark shell, free dragging and always-on-top behavior. Register new capabilities in the schema, renderer and service together, with meaningful mock tests. A manifest must never claim a capability that the host does not implement.
