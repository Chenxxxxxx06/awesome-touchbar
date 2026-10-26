# Awesome Touch Bar widget contract v1

Return a JSON object with exactly these fields:

```json
{"schemaVersion":1,"id":"water-break","name":"喝水提醒","description":"每 60 分钟休息一下，喝一杯水","icon":"drop","color":"mint","kind":"timer","config":{"minutes":60,"repeat":true}}
```

- `id`: lowercase ASCII letter followed by 2–47 lowercase letters, digits or hyphens. Keep the same ID when updating.
- `name`: 1–24 characters; `description`: 1–140 characters. Use the user's language.
- `icon`: spark, drop, clock, bell, check, count, note, link, heart, star, coffee.
- `color`: blue, purple, pink, mint, amber, gray.
- `kind` and its exact `config` shape:
  - timer: `{"minutes":60,"repeat":true}`. Integer minutes 1–1440, Boolean repeat. Start/pause/reset are provided by the host. Repeats start a new period after delivery, without catch-up notification floods.
  - alarm: `{"time":"09:30"}`. Daily local-computer time, 24-hour HH:mm. User enables/disables it. No audio alarm: reminders appear in the bar and inbox; desktop notifications are optional and silent.
  - counter: `{"initial":0,"step":1,"min":0,"max":100}`. Integers, bounds within -1000000..1000000, step 1..10000, min <= initial <= max. Host provides plus/minus/reset.
  - checklist: `{"items":["准备水杯","离开座位"]}`. 1–30 text items, each 1–100 characters. Host provides persistent checked state.
  - text: `{"text":"记得让眼睛休息一下。"}`. 1–2000 characters. Plain text only.
  - links: `{"links":[{"label":"GitHub","url":"https://github.com"}]}`. 1–12 links. Label 1–40 characters. HTTP/HTTPS only, no embedded username/password. Open only after a user click.

The host handles all layout, theme, click actions, state persistence, NEW badge, update rollback and reminders. The installed definition does not execute code or access the filesystem, network, shell, audio or credentials. At most 40 DIY components can be installed. Files are limited to 32 KB.

Timers and alarms work while the app runs. On restart, an overdue active reminder is delivered once; the app cannot wake a powered-off computer. Updating or rolling back resets the widget to inactive initial state. Alarm schedules follow the local Windows timezone.

If the request cannot be represented by these kinds, return `{"error":"用中文简短解释目前不支持的能力"}`. Do not claim real hardware integration, downloads, AI billing or system-wide notifications that the host does not provide.
