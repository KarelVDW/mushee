```markdown
# Design System Specification: The Curated Manuscript

## 1. Overview & Creative North Star
**The Creative North Star: "The Curated Manuscript"**

This design system is built on the tension between the fluid, predictive intelligence of AI and the rigid, centuries-old tradition of musical notation. We are moving away from "app-like" interfaces characterized by boxes and borders. Instead, we are leaning into an editorial, high-end experience that feels like a living document.

The visual identity relies on **intentional asymmetry**, high-contrast typography, and vast expanses of whitespace (the "paper"). By overlapping elements and using varied tonal depths, we create a sense of organized luxury. The goal is to make the user feel like a composer working on a premium parchment, assisted by an invisible, sophisticated hand.

---

## 2. Colors & Tonal Architecture
The palette avoids the sterile "tech blue." Instead, it uses a deep, intellectual teal (`primary`) against a warm, off-white base (`surface`) to evoke the feeling of ink on aged paper.

### The Palette (Material Design Convention)
*   **Primary (The Ink):** `#00342b` (Deep Teal) / `#004d40` (Primary Container)
*   **Surface (The Paper):** `#fcf9f8` (Background) / `#f0edec` (Surface Container)
*   **Accent (The Soul):** `#4e2013` (Tertiary - a muted earthy tone for focus)

### The "No-Line" Rule
To maintain an editorial feel, **1px solid borders are strictly prohibited for sectioning.** Boundaries must be defined through:
1.  **Background Shifts:** Place a `surface-container-low` section against a `surface` background.
2.  **Negative Space:** Use the spacing scale to create distinct visual groups.
3.  **Tonal Transitions:** A subtle shift from `#fcf9f8` to `#f6f3f2` is enough to signal a new functional area.

### Glass & Gradient Implementation
To move beyond a flat UI, use **Glassmorphism** for floating AI panels. Use a background blur of `20px` with a semi-transparent `surface_container_lowest` (80% opacity). Main CTAs should utilize a subtle linear gradient from `primary` (#00342b) to `primary_container` (#004d40) at a 135-degree angle to add "soul" and depth.

---

## 3. Typography: The Dual Voice
We pair a traditional serif for "the music" (expression) with a modern sans-serif for "the tool" (utility).

*   **Display & Headline (Newsreader):** This serif font carries the brand's heritage. Use `display-lg` (3.5rem) for hero statements with tight letter-spacing (-0.02em) to mimic high-end mastheads.
*   **Title & Body (Manrope):** This sans-serif provides the AI’s clarity. Use `body-lg` (1rem) for general instruction.
*   **Editorial Hierarchy:** Always lead with a Newsreader headline. The transition from a `headline-lg` serif to a `body-md` sans-serif creates an immediate sense of authoritative hierarchy.

---

## 4. Elevation & Depth: Tonal Layering
We reject the standard Material Design drop shadow. Depth is achieved through "Tonal Layering."

*   **The Layering Principle:** Treat the UI as stacked sheets of fine paper. 
    *   **Base:** `surface` (#fcf9f8)
    *   **Sections:** `surface_container_low` (#f6f3f2)
    *   **Floating Cards:** `surface_container_lowest` (#ffffff)
*   **Ambient Shadows:** For floating elements (like an AI suggestion box), use a shadow with a `24px` blur and `4%` opacity, tinted with the `on_surface` color (#1c1b1b). It should look like a soft glow of light, not a "drop shadow."
*   **The Ghost Border Fallback:** If accessibility requires a border, use `outline_variant` at `15%` opacity. It should be felt, not seen.

---

## 5. Components & Interface Elements

### Buttons
*   **Primary:** Rounded at `md` (0.375rem). Uses the Primary-to-Container gradient. Text is `on_primary` (#ffffff).
*   **Secondary:** No fill. `Ghost Border` (20% opacity outline). Use `title-sm` for the label.
*   **Interaction:** On hover, increase the `surface_tint` overlay by 8% rather than changing the base color.

### The Manuscript Canvas (Custom Component)
The area where sheet music is edited. This should always be `surface_container_lowest` (#ffffff) to appear as the "brightest" and most important layer. Use `xl` (0.75rem) rounding for the canvas container to soften the technical feel.

### Cards & Lists
*   **Rule:** Forbid the use of divider lines.
*   **Implementation:** Use a `surface_container_high` background on hover to define list items. Use `body-md` for list content, ensuring the `on_surface_variant` is used for secondary metadata to maintain a soft contrast.

### Input Fields
*   **Styling:** Minimalist. No bottom line. Use a `surface_container` fill with `sm` (0.125rem) rounding. 
*   **States:** On focus, the background shifts to `surface_container_highest` and the label (Manrope `label-md`) shifts to the `primary` color.

### AI Floating Tooltips
*   **Styling:** Use the Glassmorphism rule. `backdrop-blur: 12px`.
*   **Animation:** Should slide in from a 4px offset with a "soft-spring" easing (0.4, 0, 0.2, 1).

---

## 6. Do’s and Don’ts

### Do:
*   **Embrace Whitespace:** If a layout feels "busy," increase the padding rather than adding a border.
*   **Asymmetric Compositions:** Align a headline to the far left and the body text to a center-column to create an editorial feel.
*   **Use Tonal Shifts:** Layer `surface` tiers to show which information is "inside" another.

### Don't:
*   **Don't use 100% Black:** Use `on_background` (#1c1b1b) for text to keep the "ink" from feeling too harsh against the "paper."
*   **Don't use Default Shadows:** Avoid the "fuzzy grey" shadow look; it kills the premium editorial aesthetic.
*   **Don't Over-round:** Stick to the scale. `0.375rem` is the sweet spot. Anything more feels "bubbly" and toy-like, undermining the professional AI context.

### Accessibility Note:
While we use soft transitions, ensure the contrast between `on_surface` and `surface` always meets WCAG AA standards. The `primary` teal (#00342b) is specifically chosen to be highly legible against our warm white backgrounds.```