# Design System Documentation: High-Energy Musical Rebellion

## 1. Overview & Creative North Star
**Creative North Star: "The Precision Maverick"**
This design system is a visual manifesto for the modern musician. It rejects the cluttered, "academic" look of traditional notation software in favor of a sleek, high-tech editorial experience. We are blending the raw energy of a digital "life hack" with the sophisticated precision of a high-end studio.

The aesthetic is driven by **Intentional Asymmetry** and **Aggressive Contrast**. We utilize a clean, clinical white-space environment as the "stage," allowing neon accents and bold typography to act as "performers." The layout should feel like a high-end streetwear magazine—structured yet rebellious, breathable yet punchy.

---

## 2. Colors: High-Voltage Neutrals
Our palette relies on a sophisticated "White-on-White" layering system punctuated by two neon power-sources: Cyan and Magenta.

### The Palette
- **The Canvas:** `surface` (#f6f6f6) and `surface_container_lowest` (#ffffff). These provide the clean, airy foundation.
- **The Pulse (Primary):** `primary_container` (#00DBE9 - Neon Cyan). Use this for high-energy actions and primary focus states.
- **The Accent (Secondary):** `secondary_container` (#FF2079 - Neon Magenta) and `secondary` (#b60052 - Deep Magenta). This is our "rebellious" pop, used for secondary interactions and highlights.
- **The Depth:** `on_surface` (#2d2f2f). This isn't pure black; it’s a deep, tech-charcoal that provides "punch" without looking dated.

### The "No-Line" Rule
**Prohibit 1px solid borders for sectioning.** To define boundaries, use tonal shifts.
- A navigation sidebar should sit on `surface_container_low` (#f0f1f1) against a `surface` (#f6f6f6) background.
- This creates a seamless, "molded" look rather than a boxed-in feel.

### Surface Hierarchy & Nesting
Treat the UI as a series of stacked sheets of fine paper.
- **Base Level:** `surface` (#f6f6f6)
- **Mid-Level Panels:** `surface_container` (#e7e8e8)
- **Interactive Floating Elements:** `surface_container_lowest` (#ffffff) with Glassmorphism.

### The Glass & Gradient Rule
For primary call-to-actions or floating music-control docks, use a **Glassmorphism** effect:
- Background: `surface_container_lowest` at 85% opacity.
- Effect: `backdrop-filter: blur(12px)`.
- For CTAs, use a subtle gradient from `primary` (#00666d) to `primary_container` (#00DBE9) at a 135-degree angle to add "visual soul."

---

## 3. Typography: Space Grotesk
We use **Space Grotesk** exclusively. It is a font that feels both technical and human, with quirky terminals that suggest a "rebellious" streak.

- **Display (The Statement):** `display-lg` (3.5rem) should be used sparingly for screen titles or "hero" numbers (like BPM). Set with `-0.04em` letter-spacing for a tight, high-fashion look.
- **Headlines (The Anchor):** `headline-lg` (2rem) and `headline-md` (1.75rem) use Bold weights to anchor the user’s eye.
- **Body (The Utility):** `body-lg` (1rem) for general reading.
- **Labels (The Tech):** `label-md` (0.75rem) in All-Caps for secondary metadata, mimicking the look of technical schematics or hardware labeling.

---

## 4. Elevation & Depth
Depth in this system is achieved through **Tonal Layering** and **Atmospheric Shadows**, not structural lines.

- **The Layering Principle:** Place a `surface_container_lowest` card on a `surface_container_low` section to create a soft, natural lift.
- **Ambient Shadows:** When a floating effect is required (e.g., a music tool-kit), use a shadow with a 24px blur, 0px offset, and 6% opacity of the `on_surface` color. This mimics natural light.
- **The "Ghost Border" Fallback:** If a container requires definition for accessibility, use the `outline_variant` (#acadad) at **15% opacity**. It should be felt, not seen.
- **The Sanctuary (Sheet Music Editor):** The editor area must be strictly `#ffffff` with `#2d2f2f` notes. No elevation, no color. It is a vacuum of focus in the center of a high-energy UI.

---

## 5. Components

### Buttons
- **Primary:** Gradient fill (`primary` to `primary_container`), `on_primary_container` text, `full` roundedness. High energy.
- **Secondary:** `surface_container_highest` background with `primary` text. Use for less critical tools.
- **Tertiary:** Transparent background, `on_surface` text, bold `label-md` styling.

### Input Fields
- Avoid four-sided boxes. Use a `surface_container_low` background with a `0.25rem` (DEFAULT) roundedness and a `2px` bottom-only stroke in `primary` that animates from 0% to 100% width on focus.

### The "Tool-Dock" (Floating Controls)
- Create a floating container using `surface_container_lowest` with Glassmorphism. 
- Use `xl` (0.75rem) roundedness to make it feel like a modern handheld device.
- Forbid dividers. Use `1.5rem` horizontal spacing between icon groups to define categories.

### Chips (Genre/Instrument Tags)
- Use `secondary_container` (Magenta) for active states.
- Forbid borders; use the contrast between `secondary_container` and the `surface` background to define the shape.

---

## 6. Do’s and Don'ts

### Do:
- **Asymmetric Spacing:** Use wider margins on the left than the right to create an editorial, "off-beat" feel.
- **High-Contrast Scale:** Use a massive `display-lg` title right next to a tiny `label-sm` technical detail.
- **Color Pop:** Use the Magenta (`secondary`) sparingly—only for "Destructive" actions or "High-Rebellion" features (like a 'Turbo' or 'Remix' button).

### Don’t:
- **No Divider Lines:** Never use a horizontal rule `<hr>` or border to separate list items. Use a background shift to `surface_container_low` on hover instead.
- **No Grey Shadows:** Never use `#000000` for shadows. Always tint the shadow with the `on_surface` (#2d2f2f) color to maintain the clean, light-mode vibrance.
- **No Color in the Editor:** Do not allow the Cyan or Magenta to bleed into the sheet music editor. That space is sacred and strictly monochrome for maximum cognitive focus.