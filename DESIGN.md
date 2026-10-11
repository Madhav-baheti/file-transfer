# DESIGN.md: QuickDrop Visual Design

> **For the coding agent:** This file describes how QuickDrop should look. All values live in `apps/web/src/styles/tokens.css`. Component CSS may use **only** those CSS variables (no hardcoded colors, radii, shadows, spacing or font sizes). Behavior and architecture rules stay in `TECH_STACK.md`; this file never overrides them.

**Reference (inspiration only):** "Gig Share Website" by Halo Lab on Dribbble, https://dribbble.com/shots/14673292-Gig-Share-Website

We borrow the *mood and structure*: a calm slate hero inside a soft frame, a light geometric headline, one dashed "add your files" drop zone, and bold abstract tiles for color. We do **not** reuse their logo, illustrations, patterns, icons or copy. Build our own tile patterns and text.

## 1. Overall Look

- Calm, confident and a little playful. A muted slate hero with a few saturated accents.
- Big rounded shapes (frame, panel, cards) and soft shadows. No hard borders except the dashed drop zone.
- Very large, light-weight headline. Small, quiet supporting text.
- Generous whitespace. One main action per screen.

## 2. Page Anatomy

```
┌─ page backdrop (--color-backdrop) ───────────────────────────────┐
│ ┌─ frame, white, radius --radius-frame ────────────────────────┐ │
│ │ ┌─ hero panel, slate, radius --radius-panel ───────────────┐ │ │
│ │ │ nav:  logo      links          [icon btn] [Sign-up style]│ │ │
│ │ │                                                          │ │ │
│ │ │        Big light headline, centered, white               │ │ │
│ │ │        one-line subtext, muted white                     │ │ │
│ │ │                                                          │ │ │
│ │ │        ┌ ─ ─ ─ ─ ─ ─ ┐  dashed outer drop zone           │ │ │
│ │ │        │ [  +  ]     │  inner lighter card, + circle     │ │ │
│ │ │        │ Add files   │                                   │ │ │
│ │ │        └ ─ ─ ─ ─ ─ ─ ┘                                   │ │ │
│ │ │  ▧ floating geometric tiles around the edges ▧           │ │ │
│ │ └──────────────────────────────────────────────────────────┘ │ │
│ └──────────────────────────────────────────────────────────────┘ │
│  light sections below: "How it works", "Why it's private", footer │
└──────────────────────────────────────────────────────────────────┘
```

## 3. Colors

All in `tokens.css`. Roles:

| Role | Variable | Value |
|---|---|---|
| Page backdrop | `--color-backdrop` | #A8ACB1 |
| Hero panel | `--color-hero` | #636C79 |
| Drop-zone inner card | `--color-hero-card` | #747F8E |
| Light section background | `--color-section` | #F5F5F7 |
| Headings on light | `--color-text-heading` | #040026 |
| Body on light | `--color-text-body` | #54535A |
| Accents | `--color-accent-red / orange / indigo / mint / cream / brown / ink / tan` | #FF4033, #FE792D, #4D4E8D, #8BB7A2, #CFC7B5, #432F2C, #101812, #C5936B |

Usage rules:
- Mint is the "go" and success color (primary icon button, completed state). Red is danger and error. Use indigo for focus rings and links on light backgrounds.
- Accent colors appear mainly in the decorative tiles and small status marks, not as large fills behind text.
- **Contrast:** white text on the slate hero is fine. Do **not** put light gray text (such as #A3A9AF) on the slate; use `--color-text-on-hero-muted`. All text must be at least 4.5:1 (3:1 for large text).

## 4. Typography

- **Font:** a geometric sans. The reference uses a commercial geometric face with a single-story "g"; the closest free match is **Outfit** (via `@fontsource-variable/outfit`, self-hosted, no Google request). Fallback stack is already in the tokens.
- **Headline:** `--text-hero`, weight 300, line-height 1.1, centered, max width `--hero-text-max`.
- **Section headings:** `--text-h2`, weight 400, `--color-text-heading`.
- **Body:** `--text-body`, `--leading-body`. **Labels on cards:** `--text-small`, weight 600. **Hints** (such as "Up to 20 GB"): `--text-tiny`.
- Wordmark: all lowercase, medium weight, with a simple two-circle mark made by us.

## 5. Shape, Shadow, Spacing

- Radii: frame 40px, hero panel 30px, cards 22px, tiles 24px, buttons 8px.
- Shadows: tiles `--shadow-tile`, light cards `--shadow-card`, drop-zone inner card `--shadow-inner-card`.
- Spacing uses the 4px scale (`--space-1` to `--space-9`). Hero vertical padding is `--space-8`. Content max width is `--content-max`.

## 6. Components

Build each as its own file with its own CSS module.

**NavBar:** logo left, links (About, How it works, Features) next to it, and on the right a mint square icon button plus an outlined button (1px `--color-border-on-hero`, radius `--radius-button`, white text). On mobile it collapses to logo plus a menu button.

**Hero:** the headline and subtext. Suggested QuickDrop copy: *"Send big files, skip the cloud."* and *"Direct from your device to theirs. Encrypted, no accounts, no uploads."*

**DropZone (the signature element):** an outer dashed border (`1px dashed var(--color-border-on-hero)`, radius around 28px, 10px padding) around an inner card (`--color-hero-card`, `--radius-card`, `--shadow-inner-card`). Inside: a 42px white circle with a "+" icon, a label ("Add your files", weight 600) and a hint line. States:
- **Idle:** as above. **Hover and drag-over:** inner card lifts 2px and brightens slightly, and the dashed border becomes solid white.
- **Disabled** (not connected yet): 60% opacity with the hint "Connect a device first".
- Must be a real `<button>` or a labelled drop area, with a visible focus ring (`--focus-ring-on-hero`), and keyboard operable.

**Pairing card** (replaces the generic Create and Join cards): same dashed-outer and inner-card construction. Two of them side by side on desktop, stacked on mobile: "Create session" and "Join with code". The short code is shown in large monospaced characters on the inner card, with a Copy button.

**TransferProgress:** a card with the filename, size, a progress bar (mint fill on a darker slate track, radius pill), percentage, speed, ETA and a Cancel button. A completed transfer shows a mint check. A failed one shows a red mark and a plain-language reason.

**IncomingOffer:** a card with the sanitized filename, size and type, and clear Accept (mint) and Decline (outlined) buttons.

**Tiles (decoration):** rounded squares (`--radius-tile`) with bold geometric patterns (diagonal splits, quarter circles, stripes) using only the accent colors, with `--shadow-tile`. Place 3 to 5 around the hero edges, slightly overlapping the frame. **Draw our own patterns** with CSS gradients or small inline SVGs. They are decorative: `aria-hidden="true"`, no tab stops.

**Light sections:** a "How it works" row of three numbered steps (Create, Share the code, Send), and a "Why it's private" block with short points (end-to-end encrypted, nothing stored on a server, direct connection). Cards use `--color-card`, `--radius-card` and `--shadow-card`.

## 7. Motion

- Hover on cards and buttons: 2px lift and a subtle shadow change, `--dur` with `--ease`.
- Tiles: a slow floating drift (6 to 10 second loop, a few pixels). CSS only.
- Progress bar fill: smooth width transition.
- All of this must respect `prefers-reduced-motion` (the tokens already shorten durations; also disable the tile drift).

## 8. Responsive

- Design mobile-first at 360px. On mobile the frame padding shrinks, the tiles shrink or are hidden except one or two, the pairing cards stack, and the headline uses the clamp in `--text-hero`.
- No horizontal scrolling at any width. Touch targets are at least 44px.

## 9. Accessibility

- Visible focus on every interactive element. Color is never the only signal (use icons and text for states).
- The QR code (a later phase) always has the typed-code alternative next to it.
- Respect `prefers-reduced-motion` and `prefers-color-scheme` (dark mode is a later phase; the tokens are structured so a dark theme can override them in one block).

## 10. Do and Don't

- **Do** keep one primary action per screen, large radii and soft shadows.
- **Do** use only token variables in component CSS.
- **Don't** copy the reference's logo, illustrations, patterns or text.
- **Don't** add UI libraries, CSS frameworks or icon packs without asking. Draw simple icons as inline SVG.
- **Don't** change app behavior while restyling. A restyle PR must not touch `lib/` logic or tests except where a component's props change.
