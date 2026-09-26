# Activity Log

Structured changelog of completed epics, most recent first — only
completed, user-facing epics belong here, not routine commits.

## Format

```
## $date

- $emoji - $epicName - $briefDescription
```

## 2026-09-26

- 🧩 - Group-aware tab order & clutter - Fixed duplicate tab-order detection and clutter's visual count to scope correctly to visual groups (Selection pane nesting) instead of comparing across the whole page, and added a new advisory finding that compares the authored tab order against the layout-inferred order for each group and the page's top level.
