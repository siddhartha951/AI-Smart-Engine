# AI Smart Engine Design System

**Status:** Source of truth for Admin OS and Merchant OS implementation  
**Product:** AI Smart Engine, a multi-tenant AI shopping assistant and commerce operations platform for Shopify merchants  
**Reference direction:** Stripe-level product clarity, information hierarchy, and interaction discipline  
**Primary audience:** Platform administrators and Shopify merchant operators

---

## 0. How to use this document

This document defines the shared visual language and interaction rules for the existing product surfaces. It is intentionally not a feature roadmap and it is not permission to add new modules, routes, sidebar options, or business workflows.

Implementers should use this document when:

- replacing the current dark glassmorphism treatment with a calmer product interface;
- adding or updating a component in either OS;
- deciding how a page should group data, controls, and actions;
- defining loading, empty, error, paused, disabled, and success states;
- checking responsive behavior and accessibility;
- reviewing a new page against the existing information architecture.

### Non-negotiable product constraints

1. Keep the existing Admin OS and Merchant OS navigation labels and order unless the product owner explicitly changes them.
2. Keep the existing role boundaries. Admin users manage the platform and merchants. Merchant users operate their own store, agent, marketing, and growth surfaces.
3. Do not turn every section into a card. Use grouping, whitespace, dividers, and page-level hierarchy before adding elevation.
4. Do not use gradients, glow, blur, animated backgrounds, or decorative 3D scenes to compensate for weak hierarchy.
5. Every action must expose a clear state: idle, hover, focus, pressed, loading, success, failure, disabled, or paused where applicable.
6. Never communicate a critical state with color alone. Pair color with text, iconography, or a visible label.
7. Use real product data as the source of truth. Do not invent precision, growth percentages, conversion rates, or health states for visual effect.

---

## 1. Existing product audit

### 1.1 Product model

AI Smart Engine is a multi-tenant platform for Shopify merchants. The product currently has two browser-based single-page surfaces backed by the same API and authentication model:

| Surface | Primary user | Primary job | Current entry point |
| --- | --- | --- | --- |
| Admin OS | Platform super admin / operations team | Monitor merchants, enforce platform controls, inspect usage and audit activity, resolve alerts | `src/public/admin/index.html` |
| Merchant OS | Merchant owner / merchant operator | Understand store performance, configure the AI assistant, manage leads and campaigns, and act on growth signals | `src/public/dashboard/index.html` |

### 1.2 Existing Admin OS information architecture

The Admin OS currently exposes these navigation items and nested views:

- Overview
- Merchants
- Platform Controls
- Alerts
- Merchant Detail, opened from Merchants, with Details, Usage, and Audit Log tabs
- Create Merchant modal
- Confirm Action modal
- Merchant Onboarding Link modal

The design system must make these flows easier to scan and safer to operate. It must not introduce additional admin modules.

### 1.3 Existing Merchant OS information architecture

The Merchant OS currently exposes these navigation items, in this order:

- Growth Copilot
- Overview
- Live Pulse & Funnel
- My Agent
- Leads & Opt-ins
- Widget Settings
- Shopify Catalog
- Ad Creative Studio
- WhatsApp Growth
- Email Automation
- Smart Reorder
- Ad Intelligence

Existing content within those surfaces includes growth actions and history, store metrics, live shoppers, conversion funnels, agent configuration, lead export, widget preview and installation snippet, Shopify connection and catalog data, ad creative generation and saved creatives, WhatsApp configuration and conversations, email automation and test sends, reorder schedules and product settings, and attribution/ad-spend analysis.

### 1.4 Current visual debt to resolve

The current Admin OS and Merchant OS use separate but similar dark visual systems. The main issues are consistency and signal-to-noise, not a lack of features.

| Current pattern | Why it weakens the product | Direction in this system |
| --- | --- | --- |
| Dark glass panels and `backdrop-filter` used as the default surface | Makes every region feel elevated, reduces grouping clarity, and can reduce text contrast | Use a flat neutral canvas, white surfaces, thin borders, and elevation only for transient or layered UI |
| Purple, cyan, green, and multi-stop gradients | Creates competing focal points and a promotional rather than operational tone | Use one restrained brand accent. Reserve semantic colors for system states only. Do not use decorative gradients |
| Three.js backgrounds on product surfaces | Adds visual motion without helping a merchant complete a task | Keep product screens visually still. If retained temporarily, place it behind the login view only and disable for reduced motion or low-power devices |
| Emoji used as navigation icons and section decoration | Inconsistent across platforms and difficult to align or interpret as a control | Use one icon family with consistent stroke and size. Keep visible labels as the source of meaning |
| Multiple radius scales and multiple glass-card variants | Makes hierarchy difficult to predict | Adopt one documented radius scale and a small elevation vocabulary |
| Hover lift, glow, and animated accent bars on metrics | Implies every metric is interactive and adds noise to dense pages | Keep metrics stable. Use hover only when the whole surface is actionable |
| Small uppercase labels used for many headings | Increases cognitive load and weakens page hierarchy | Use sentence case for most labels. Reserve uppercase micro-labels for system metadata such as `LIVE`, `UTC`, or a data source |
| Inline styles inside Merchant OS markup | Makes the system difficult to update consistently | Move values into shared tokens and component classes. Inline styling may be used only for data-driven values such as chart widths |
| Tables that depend on hover and horizontal overflow without a strong mobile rule | Important data becomes hard to scan or inaccessible by touch | Define table density, numeric alignment, sticky headers, focus behavior, and mobile overflow explicitly |

---

## 2. Brand and product design direction

### 2.1 Product idea

**AI Smart Engine gives commerce operators a calm control surface for understanding what is happening, why it is happening, and what can be done next.**

The product should feel like operational infrastructure, not a marketing dashboard. It is a place where a platform operator or merchant can trust a number, understand a system state, and take a consequential action without hesitation.

### 2.2 Design read

This is a role-based B2B SaaS product with operational and analytics surfaces, leaning toward Stripe-style product UI: quiet, dense where necessary, precise, and strongly structured. The visual language is owned by AI Smart Engine, with Stripe used as a quality benchmark rather than as a source of copied assets or UI.

### 2.3 The four qualities to optimize

1. **Clarity:** The next useful decision is always visually obvious.
2. **Calm:** The default state is quiet. Color and motion appear when they carry meaning.
3. **Confidence:** Numbers, statuses, permissions, and destructive actions are explicit.
4. **Continuity:** Admin OS and Merchant OS feel like the same product, even when density and emphasis differ.

### 2.4 Visual principles inspired by Stripe-level quality

#### Structure before decoration

Use alignment, spacing, typography, and border rhythm to establish hierarchy. A panel should exist because it groups content or separates a decision, not because every section needs a container.

#### One strong accent

Use the brand accent for selected navigation, primary actions, links, focus, and key interactive affordances. Semantic colors are separate and only appear when communicating success, warning, danger, or information.

#### Surface hierarchy is shallow

Use three surface levels at most in a single view:

1. Canvas for the page background.
2. Surface for content regions and controls.
3. Elevated layer for popovers, modals, drawers, or a clearly prioritized action.

Do not stack translucent panels on top of translucent panels.

#### Density is intentional

Admin tables, audit logs, leads, schedules, and attribution views can be dense. Growth Copilot, Overview, and configuration surfaces need more breathing room. Density should change by task, not randomly between components.

#### Motion confirms state

Use motion for loading, state transitions, expansion, and immediate feedback. Do not animate static metrics, navigation, or background decoration continuously. Respect `prefers-reduced-motion`.

#### Copy is part of the UI system

Use direct, operational labels. Prefer `Save widget settings`, `Verify domain`, `Run full store audit`, `Pause all agents`, and `Copy installation snippet` over vague labels such as `Continue`, `Manage`, or `Explore` when the specific action is known.

### 2.5 Brand expression

AI Smart Engine should not rely on a large logo, an oversized wordmark, or a decorative hero. Brand recognition should come from:

- the disciplined indigo accent;
- the compact wordmark and consistent app shell;
- the relationship between data, action, and explanation;
- clear language around AI-assisted recommendations and platform controls.

---

## 3. Design tokens

Tokens are the only approved place for shared visual values. Admin OS and Merchant OS may use different component classes, but they must resolve to the same token names.

### 3.1 Token naming

Use semantic tokens in components and primitive tokens only inside the token layer.

Good: `var(--color-text-secondary)`, `var(--space-4)`, `var(--control-height-md)`  
Avoid: `#7c5cfc`, `rgba(255,255,255,.06)`, or `13px` repeated in component files.

### 3.2 Core token set

```css
:root {
  /* Canvas and surfaces */
  --color-canvas: #f6f8fb;
  --color-surface: #ffffff;
  --color-surface-subtle: #fbfcfe;
  --color-surface-muted: #f1f4f8;
  --color-surface-inset: #eef2f6;
  --color-overlay: rgb(9 22 38 / 0.44);

  /* Text */
  --color-text-primary: #12263a;
  --color-text-secondary: #53657a;
  --color-text-tertiary: #718198;
  --color-text-disabled: #a6b2c1;
  --color-text-on-accent: #ffffff;

  /* Borders and focus */
  --color-border-subtle: #edf0f4;
  --color-border-default: #dfe5ec;
  --color-border-strong: #c9d2de;
  --color-focus-ring: #635bff;

  /* Brand accent */
  --color-accent: #635bff;
  --color-accent-hover: #554ee6;
  --color-accent-active: #4842c5;
  --color-accent-soft: #f0efff;
  --color-accent-soft-strong: #e4e2ff;

  /* Semantic states */
  --color-success: #087f5b;
  --color-success-soft: #eaf8f1;
  --color-warning: #a15c00;
  --color-warning-soft: #fff5df;
  --color-danger: #c9372c;
  --color-danger-soft: #fff0ee;
  --color-info: #2167c7;
  --color-info-soft: #edf5ff;
  --color-neutral-soft: #eef2f6;

  /* Elevation */
  --shadow-xs: 0 1px 2px rgb(15 23 42 / 0.04);
  --shadow-sm: 0 4px 12px rgb(15 23 42 / 0.08);
  --shadow-md: 0 12px 32px rgb(15 23 42 / 0.14);
  --shadow-focus: 0 0 0 3px rgb(99 91 255 / 0.22);

  /* Shape */
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-pill: 999px;

  /* Spacing */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;

  /* Controls */
  --control-height-sm: 32px;
  --control-height-md: 40px;
  --control-height-lg: 48px;
  --icon-size-sm: 16px;
  --icon-size-md: 20px;
  --icon-size-lg: 24px;

  /* Motion */
  --duration-fast: 120ms;
  --duration-normal: 180ms;
  --duration-slow: 260ms;
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
}
```

### 3.3 Dark mode tokens

The current product is dark by default, but the target system is light-first for operational clarity. A dark theme remains supported for environments that require it. Dark mode changes token values only. It does not introduce gradients, glass, or a different component language.

```css
[data-theme="dark"] {
  --color-canvas: #0f1722;
  --color-surface: #172232;
  --color-surface-subtle: #1b293a;
  --color-surface-muted: #202f41;
  --color-surface-inset: #0d1622;
  --color-text-primary: #f4f7fb;
  --color-text-secondary: #b2bfd0;
  --color-text-tertiary: #8b9aae;
  --color-text-disabled: #66768b;
  --color-border-subtle: #223144;
  --color-border-default: #314156;
  --color-border-strong: #465a73;
  --color-accent-soft: #25254d;
  --color-accent-soft-strong: #333366;
  --color-success-soft: #12382f;
  --color-warning-soft: #3d2d14;
  --color-danger-soft: #411d20;
  --color-info-soft: #172f50;
  --color-neutral-soft: #263444;
  --shadow-xs: 0 1px 2px rgb(0 0 0 / 0.18);
  --shadow-sm: 0 8px 20px rgb(0 0 0 / 0.22);
  --shadow-md: 0 16px 36px rgb(0 0 0 / 0.32);
}
```

### 3.4 Radius rules

- `--radius-sm` is for inputs, compact buttons, menu items, table controls, and inline actions.
- `--radius-md` is the default for cards, panels, alerts, and previews.
- `--radius-lg` is for large feature regions or modal content where the surface needs separation.
- `--radius-pill` is reserved for status badges, live indicators, and compact filter chips. Do not make every button a pill.

### 3.5 Elevation rules

- No shadow for the main page canvas or normal sections.
- `shadow-xs` for a control or surface that needs a one-pixel lift from the canvas.
- `shadow-sm` for a dropdown, popover, or hoverable action surface.
- `shadow-md` only for modal, drawer, or high-priority floating surfaces.
- Never combine glow, gradient, and shadow on the same component.

---

## 4. Color system

### 4.1 Color roles

The role is more important than the hue.

| Role | Usage | Do not use for |
| --- | --- | --- |
| Canvas | Page background and large empty regions | Cards, alerts, or controls |
| Surface | Primary content regions, tables, form groups, previews | Decorative glow |
| Accent | Selected nav, primary action, link, focus, active tab | Success, revenue, or live state unless explicitly branded |
| Success | Completed, connected, enabled, healthy, delivered, converted | General positive decoration |
| Warning | Needs attention, pending verification, nearing limit, paused | Default informational emphasis |
| Danger | Destructive action, failed, disconnected, revoked, error | Normal secondary actions |
| Info | Contextual explanation, system note, telemetry information | Brand accent replacement |
| Neutral | Draft, inactive, unknown, not configured | Success or failure states |

### 4.2 Color usage limits

- A normal page should have one accent color plus semantic colors where data requires them.
- A single card should have one state color at most. A danger card should not also use accent glow.
- Do not use colored borders on every metric. Use text and a small state marker instead.
- Use tinted fills for status context, not saturated fills.
- Use color with text. Examples: `Connected`, `Paused`, `Needs verification`, `Failed`, `Draft`.

### 4.3 Charts and color

Charts should use a neutral baseline and a limited semantic sequence:

1. Primary series: accent.
2. Comparison series: text tertiary or muted blue.
3. Positive outcome: success.
4. Warning threshold: warning.
5. Failure or blocked state: danger.

Avoid rainbow palettes, gradient fills, and a different color for every category unless the data genuinely has categorical meaning and the legend remains accessible.

### 4.4 Contrast requirements

- Body text and controls: WCAG 2.2 AA, at least 4.5:1.
- Large text: at least 3:1.
- Focus indicator: visible against both canvas and surface.
- Do not use `--color-text-tertiary` for primary content, input values, table values, or action labels.
- Disabled controls may be lower contrast but must remain distinguishable from the canvas and never be the only way to understand why an action is unavailable.

---

## 5. Typography system

### 5.1 Typeface strategy

Use one UI sans across both OS surfaces. The repository currently references Inter, Outfit, and Fira Code in different places. Consolidate the product UI to one sans family, preferably the existing Inter stack during migration to avoid an unnecessary dependency change. Use a monospace face only for code snippets, widget keys, IDs, timestamps where precision matters, and technical values.

```css
:root {
  --font-ui: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-mono: "Fira Code", "SFMono-Regular", Consolas, monospace;
}
```

Do not use a separate display font for headings. Product clarity comes from weight, size, tracking, and spacing.

### 5.2 Type scale

| Token | Size / line height | Weight | Use |
| --- | --- | --- | --- |
| Display | 32px / 38px | 700 | Login title or a single focal telemetry number only |
| Page title | 24px / 30px | 650 to 700 | `Platform Overview`, `Store Overview`, `Growth Copilot` |
| Section title | 16px / 24px | 650 | Panel and section headings |
| Card title | 14px / 20px | 650 | Metric and card titles |
| Body | 14px / 22px | 400 | Main content and explanatory copy |
| Body strong | 14px / 22px | 600 | Important values and labels |
| Small | 12px / 18px | 400 to 500 | Helper text, metadata, table secondary lines |
| Micro | 11px / 16px | 600 | Status metadata, live tags, timestamps only |
| Numeric | Contextual | 600 to 700 | Use tabular numerals, never decorative display numerals |

### 5.3 Typography behavior

- Use sentence case for page titles, section titles, buttons, filters, and form labels.
- Use uppercase only for short metadata such as `LIVE`, `7 DAYS`, or `UTC`; keep tracking between `0.06em` and `0.1em`.
- Page titles should be compact. Do not use oversized landing-page typography inside the product.
- Metric values use tabular numerals and align by baseline when shown in a group.
- Do not use text gradients, transparent fill, or animated text as a brand treatment.
- For long AI explanations, use 14px body text with a 60 to 72 character measure. Do not reduce body text below 13px to fit more content.

---

## 6. Spacing and layout grid

### 6.1 Base rhythm

The system uses a 4px base unit. Most product spacing should land on 8px increments.

| Use | Spacing |
| --- | --- |
| Icon to label | 8px |
| Label to input | 6px |
| Helper or error text from input | 6px |
| Related controls | 8px |
| Form fields in one group | 16px |
| Card internal padding | 20px or 24px |
| Section to section | 32px |
| Page header to first content block | 24px |
| Table cell horizontal padding | 16px |
| Table row vertical padding | 14px, producing a 48 to 52px row |

### 6.2 Application shell

Desktop shell:

- Sidebar width: 240px, with 16px inner padding.
- Main content left offset: 240px.
- Page content max width: 1360px; use the available width for tables and charts rather than allowing text to stretch indefinitely.
- Main content padding: 32px on wide screens, 24px at medium widths.
- Top-level header height: 56px to 64px if a page needs a persistent header.

Mobile shell:

- Page gutter: 16px.
- Mobile top bar: 56px minimum height, sticky only when it contains the menu control or the current store context.
- Sidebar becomes a drawer that covers 288px to 320px of the viewport and uses a real backdrop.
- Main content does not retain a desktop left margin when the drawer is closed.

### 6.3 12-column page grid

Use a 12-column grid for page-level composition on desktop.

- Standard content block: 12 columns.
- Two-panel analytical split: 7 / 5 or 8 / 4 depending on content weight.
- Form plus preview: 5 / 7 or 6 / 6.
- Metric grid: 4 columns for four primary metrics, 3 columns for six metrics at large widths, then collapse to two and one columns.
- Do not use complex percentage-based flex math. Use CSS Grid with named regions or repeatable minmax columns.

### 6.4 Page rhythm

Every page should read in this order:

1. Page title and purpose.
2. Immediate state or primary action.
3. Summary metrics or primary content.
4. Detail, analysis, or configuration.
5. History, audit, supporting data, or secondary actions.

Use 24px between major blocks and 32px before a new conceptual group. A page should not look like a continuous stack of equally weighted rectangles.

---

## 7. Navigation and sidebar behavior

### 7.1 Shared shell rules

The Admin OS and Merchant OS share a navigation model:

- persistent left navigation on desktop;
- clear active state;
- visible current role and, for Merchant OS, current store context;
- compact footer area for identity and sign-out;
- mobile drawer with focus management and backdrop;
- no decorative animation or continuous background motion in the shell.

The shell itself is a flat surface separated from the canvas by a border. It is not a floating glass panel.

### 7.2 Navigation item anatomy

Each item contains:

- one consistent 20px icon;
- one visible label;
- optional right-aligned count badge;
- active background using `--color-accent-soft`;
- active text and icon using `--color-accent`;
- a 3px left indicator only if the background alone is insufficient.

Use the same icon family and stroke weight everywhere. Icons are supportive; labels carry the meaning. Replace emoji navigation glyphs during implementation.

### 7.3 States

| State | Visual behavior |
| --- | --- |
| Default | Transparent background, primary or secondary text depending on hierarchy |
| Hover | `--color-surface-muted` background and primary text; no lift |
| Focus-visible | 2px accent ring with 2px offset |
| Active | Accent-soft background, accent text, medium weight |
| Disabled | Tertiary text, no pointer interaction, explanatory tooltip only if the reason is not obvious |
| Count present | Small semantic or neutral badge aligned to the far edge |

### 7.4 Admin OS navigation

Keep the current order: Overview, Merchants, Platform Controls, Alerts. The shell should make the operational sequence obvious without adding groups or sub-navigation that do not exist in the codebase.

### 7.5 Merchant OS navigation

Keep the current order beginning with Growth Copilot, followed by Overview, Live Pulse & Funnel, My Agent, Leads & Opt-ins, Widget Settings, Shopify Catalog, Ad Creative Studio, WhatsApp Growth, Email Automation, Smart Reorder, and Ad Intelligence.

The active item should remain visible when a merchant is in a long page. On mobile, close the drawer after navigation and restore focus to the menu button.

### 7.6 Store context

The existing Merchant OS supports a store selector when applicable. Keep it in the shell near the brand and role context. The selected store must be visually distinct from ordinary navigation, and changing it should show a short loading state before content is replaced. Never silently swap store data.

---

## 8. Page hierarchy

### 8.1 Page header

Use a page header with:

- title, 24px, sentence case;
- one concise description only when the page's purpose is not obvious;
- right-aligned actions or filters;
- optional status badge for page health or connection state.

Desktop header spacing: 24px bottom.  
Mobile header spacing: 16px bottom, actions wrap below the title.

Do not put an icon, decorative emoji, or gradient behind every title. Use a status indicator only when it carries real state.

### 8.2 Section hierarchy

Use a 16px section title, optional helper text, and a 16px bottom gap before content. A section may be a border-separated group rather than a card.

For pages with multiple related sections, use:

- one clear page title;
- one primary content group;
- secondary groups separated by 24px whitespace or a subtle divider;
- a panel only when grouping changes how the user interprets or acts on the data.

### 8.3 Action hierarchy

Each page should have one primary action at most in the initial header row. Secondary actions are outlined or ghost. Destructive actions are separated from ordinary save or navigation actions.

Use consistent verbs:

- `Save` for a form group;
- `Refresh` for reloading data;
- `Verify` for domain verification;
- `Sync` for a connection data refresh;
- `Export` for downloads;
- `Copy` for snippets or keys;
- `Run` for analysis or audit actions;
- `Pause` or `Resume` for controls that change an operational state.

---

## 9. Data-dense tables

### 9.1 When to reuse

Use the shared data table pattern for merchant management, leads and opt-ins, product lists, saved creatives, WhatsApp consents and conversations, reorder schedules, customer or product settings, attribution campaigns, ad spend, action history, and audit logs.

Do not use a table for a short set of two to four labeled values. Use an information list or definition list instead.

### 9.2 Visual behavior

- Surface is white or the dark-mode surface token, with a 1px border.
- Header row uses small, medium-weight text in sentence case. Avoid excessive uppercase tracking.
- Body rows are 48 to 52px tall by default.
- Row separators use `--color-border-subtle`, not a heavy line between every cell.
- Hover highlights the complete row with a subtle surface tint.
- Selected rows use accent-soft background and a visible checkbox or selected label where selection exists.
- Actions appear in the final column and should not be hidden behind hover only.
- Align text left, numeric values right, and status badges according to the content type.
- Use tabular numerals for counts, currency, percentages, and dates.

### 9.3 Table header behavior

Headers should expose sorting only when sorting exists. A sortable header has a button target of at least 32px and a visible selected direction. Do not display fake sort affordances.

For long tables, keep the header sticky within the table scroll region. The page itself should not have a second sticky header unless the existing workflow requires it.

### 9.4 States

- **Loading:** retain column headers and show row-shaped skeletons. Do not replace the entire page with a spinner.
- **Empty:** keep the table structure when the user has filtered or searched. Explain the condition and offer `Clear filters` when relevant.
- **Error:** show an inline table-level error with `Try again`. Keep previous data visible if it is stale but valid, and label it as such.
- **Partial data:** show `Not available` or `Not configured`, not a blank cell.
- **Long values:** truncate visually with a title or accessible full value. Do not cause the whole table to wrap unpredictably.

### 9.5 Responsive behavior

At widths below 768px, prefer a horizontal scroll region with an explicit visual affordance and preserve the table semantics. Do not transform every table into cards because that often hides column relationships. For tables with only one primary value and one action, a compact stacked row is allowed, but the column labels must remain accessible.

Table actions should move into a row action menu only when the action count cannot fit. The menu must be keyboard accessible and not the only way to discover a destructive action.

### 9.6 Table spacing rules

- Header: 12px top and bottom, 16px horizontal.
- Body: 14px top and bottom, 16px horizontal.
- Compact audit log: 10px top and bottom, 12px horizontal.
- Use 16px to 20px outside the table before adjacent content.

---

## 10. Filters and search

### 10.1 Reuse points in this product

Use the filter bar pattern for:

- Admin merchant search and status filter;
- live funnel timeframe selection;
- product searches in Shopify Catalog and Smart Reorder;
- attribution model, campaign, and ad spend filters;
- any existing list that already supports a search or time window.

Do not add filters to pages simply to make the toolbar look complete.

### 10.2 Filter bar anatomy

Desktop:

1. Search input with a leading search icon and visible label or accessible name.
2. Select or segmented control for the primary scope.
3. Optional secondary filters.
4. Result count or last updated metadata.
5. Clear action only when a filter is active.

The toolbar uses 8px gaps between controls and 16px below the toolbar before content.

### 10.3 Search behavior

- Search field height: 40px.
- Search should preserve input while results load.
- For client-side filtering, update the visible count immediately and expose the result state to assistive technology.
- For server-backed search, debounce typing and show a subtle loading indicator inside the field or near the result count.
- `Escape` clears the query only when the field is focused and the user has entered a query.
- Empty query shows the full current dataset.

### 10.4 Filter states

- Active filters are represented in the control itself and, when more than one filter is applied, by compact removable chips below the bar.
- Chips are not the primary control. They summarize current state and expose a clear remove action.
- If a filter produces no results, say which filter caused the state when possible.
- On mobile, controls stack full width. Filter chips wrap and remain horizontally readable.

---

## 11. Forms and validation

### 11.1 Form structure

Use the same field anatomy across Admin OS and Merchant OS:

1. Label above input, select, checkbox, or toggle.
2. Optional helper text below the label or below the control, depending on what it explains.
3. Control with visible border and a 40px minimum height.
4. Error message below the control, with a text label and optional icon.
5. Save or submit actions grouped at the end of the relevant form section.

Never use placeholder text as a label. Never rely on color alone to show a required, invalid, or disabled field.

### 11.2 Spacing

- Label to control: 6px.
- Control to helper or error: 6px.
- Field to field: 16px.
- Related fields in a row: 16px column gap, collapsing to one column below 768px.
- Form section to form section: 24px.
- Form actions: 24px top, 8px gap between buttons.

### 11.3 Control states

| State | Behavior |
| --- | --- |
| Default | White or themed surface, default border, primary text |
| Hover | Stronger border only; no glow |
| Focus-visible | Accent border and `--shadow-focus` |
| Filled | Same height and padding as empty state; do not shift layout |
| Invalid | Danger border plus visible error text; place focus on the first invalid field on submit |
| Disabled | Muted surface and text; explain why if the reason is not self-evident |
| Loading | Keep the button width, disable repeated submit, show progress text or a small spinner inside the button |
| Success | Show a nearby confirmation or toast and keep the saved value visible |

### 11.4 Save behavior

Every independent configuration form should have its own save action and its own success/error feedback. This matches the existing Admin OS forms for budget, limits, email, and widget defaults, and the Merchant OS forms for agent, widget, email, WhatsApp, reorder, ad spend, and related settings.

Do not silently save on blur for high-impact configuration. If a toggle changes an operational state immediately, label it as immediate and show the resulting state.

### 11.5 Dangerous settings

Global pause, revoke consent, regenerate a widget key, delete saved creative, or any action that can interrupt delivery must:

- use a danger or warning treatment only on the action itself;
- state what will change;
- name the affected scope;
- require explicit confirmation;
- show the final result in the page context;
- provide a safe recovery path where the product supports one.

---

## 12. Cards and metric sections

### 12.1 Card rule

A card is a grouping device, not a default wrapper. Use a card when content has its own heading, state, or action, or when it must be compared with a neighboring region. If two groups are part of one reading flow, use whitespace and a divider instead.

### 12.2 Metric card anatomy

- Label: 12px or 13px, sentence case, secondary text.
- Value: 24px to 32px, semibold or bold, tabular numerals.
- Context: optional 12px supporting line, such as period or source.
- Change: only when real comparative data exists; show direction, value, and comparison window.
- State: optional small status label, not a color-only border.

Padding: 20px desktop, 16px mobile.  
Grid gap: 16px.  
Metric cards do not lift on hover unless clicking the complete card is an existing interaction.

### 12.3 Admin metric sections

Admin Overview currently has merchant status cards and global platform metrics. Keep these as two intentionally named groups:

1. **Merchant status:** Active, Paused, Onboarding, Connection Error.
2. **Platform activity:** Total Chats, Total Leads, Total Opt-ins, Add to Carts, Purchases, Emails.

The groups should have separate headings or a clear 24px gap. Avoid displaying ten or more equal cards as one undifferentiated wall.

### 12.4 Merchant metric sections

Growth Copilot uses the current five KPIs: Estimated Opportunity, Attributed Revenue, Blended ROAS, Store Conversion, and AI-Assisted Sales. The first is the primary opportunity metric and may receive a soft accent treatment. The other four remain neutral and comparable.

Overview uses the existing store metrics, Recovery Emails group, and Current Month AI Usage group. Keep AI usage visually separate from commercial outcomes because cost and revenue answer different questions.

### 12.5 Metric states

- `--` is acceptable while a request is loading only if it is replaced by a skeleton or a clear unavailable state quickly.
- `Not configured` is used when the value cannot exist until setup is complete.
- `Unavailable` is used when the API or integration cannot provide the value.
- `0` is used only when the source explicitly returns zero.
- If a metric is based on an estimate, label it as an estimate beside the value.

---

## 13. Tabs, badges, and status indicators

### 13.1 Tabs

Use tabs when content shares the same context and only one view is visible at a time. Existing tab use includes Admin Merchant Detail tabs and Merchant OS variation tabs in Ad Creative Studio.

Visual behavior:

- tabs are text-first, not large pill buttons;
- active tab uses accent text and a 2px underline or a clear accent border;
- inactive tabs use secondary text;
- hover uses surface-muted background or text darkening;
- tabs have a 40px minimum height and 16px horizontal padding;
- tab content begins 24px below the tab row;
- on mobile, the tab row scrolls horizontally without wrapping.

Do not use tabs to hide unrelated workflows. If the content has different page purposes, use the existing sidebar destinations.

### 13.2 Badges

Badges are compact labels for state, not decorative tags.

- Height: 24px minimum for touch-adjacent UI, 20px for dense tables.
- Padding: 6px horizontal.
- Radius: pill.
- Font: 11px or 12px, semibold.
- Use short labels: `Active`, `Paused`, `Draft`, `Invited`, `Onboarding`, `Connection error`, `Disabled`, `Verified`, `Pending`.

### 13.3 Status indicators

The current product has agent status, widget status, live telemetry, domain verification, WhatsApp provider, email status, and merchant status. Use a status dot only when the user needs an at-a-glance signal and pair it with text.

| State | Visual treatment | Example |
| --- | --- | --- |
| Healthy / active | Success-soft background, success text, solid dot | Agent active |
| Pending | Warning-soft background, warning text, hollow or pulsing dot only for real live work | Domain verification pending |
| Error | Danger-soft background, danger text, exclamation or error icon | Shopify connection error |
| Paused | Warning or neutral background, explicit `Paused` copy | Telemetry paused by platform admin |
| Draft / not configured | Neutral background and secondary text | Draft creative |
| Disabled | Neutral low-emphasis background, disabled text | Feature disabled |

Do not animate dots except for genuinely real-time states. The live shopper indicator may pulse gently, but it must stop when live tracking is paused or unavailable.

---

## 14. Modals, drawers, and confirmations

### 14.1 Modal use

Use a modal for a short, focused task that must be completed before returning to the page. Existing modal use includes Create New Merchant, Confirm Action, and Merchant Onboarding Link.

Modal anatomy:

- overlay using `--color-overlay`;
- surface width 400px to 560px on desktop;
- 24px to 32px padding;
- title and purpose at the top;
- body or form with 16px field rhythm;
- footer actions aligned right on desktop and stacked on small screens;
- close button with an accessible label;
- focus trapped while open;
- `Escape` closes only when the action is not in a required confirmation step.

### 14.2 Confirmation modal

The confirm modal must include:

1. The action name in the title.
2. The scope or object affected.
3. The consequence in plain language.
4. The cancel action.
5. The explicit confirm action, labeled with the verb, such as `Pause all agents` or `Regenerate widget key`.

Do not use `Confirm` as the only action label for a consequential operation.

### 14.3 Drawers

Use a drawer only for contextual detail that should preserve the current list or page, such as inspecting a selected item without losing table filters. Do not convert existing Merchant Detail or full settings pages into drawers without a product decision. A drawer is a presentation option, not a new workflow.

Desktop drawer width: 420px to 520px.  
Mobile drawer: full width with a clear close button and top padding for the safe area.

### 14.4 Modal and drawer states

- Loading: keep title and task context, disable primary action, show progress inside the body or action.
- Error: preserve entered form values and show the error near the affected field or action.
- Success: close only when the user does not need to verify the result. Otherwise keep open and show the result.
- Destructive failure: never reset the page silently or dismiss the confirmation without explaining what failed.

---

## 15. Charts and data visualization

### 15.1 General rules

Charts exist to answer a specific question. Pair every chart with a title that states the subject and a short context line when the time window or population is not obvious.

- Prefer a clear chart with one primary series over a decorative multi-series chart.
- Use gridlines sparingly and keep them neutral.
- Use direct labels where possible; legends are secondary.
- Use tabular summaries or accessible data tables as a fallback.
- Do not use 3D charts, perspective, donut charts with many slices, or decorative gradients.
- Do not animate the entire chart on every refresh. Animate only the changed data or use a brief enter transition.

### 15.2 Current chart and visualization surfaces

The existing Merchant OS includes Live Shopper Pulse, conversion funnel stages, live activity, recommendation performance, attribution and channel performance, and other analytical panels. The shared chart grammar applies to all of them.

### 15.3 Funnel behavior

The conversion funnel should:

- show each stage label, count, and percentage;
- make the drop-off between stages readable without relying on color;
- expose the selected time window clearly;
- include the existing diagnostics and recommended actions below the visual;
- distinguish real-time active shoppers from historical funnel totals;
- provide a text summary for screen readers and small screens.

Use one accent for the primary funnel track and semantic warning emphasis only when a real drop-off threshold or diagnostic state exists. Do not use a purple-to-cyan-to-green gradient.

### 15.4 Live telemetry

The Live Pulse & Funnel page may use a subtle live indicator and refresh status. The user must be able to tell:

- when the data was last updated;
- whether live tracking is active;
- whether telemetry has been paused by a platform admin;
- whether the current value is zero or not yet available.

When telemetry is paused, replace the animated radar treatment with a static paused banner and an actionable explanation.

### 15.5 Chart states

- Loading: show chart-shaped skeleton axes or bars, not an empty box with a spinner.
- Empty: explain why the chart has no data and what action or time window could populate it.
- Error: show a retry action and preserve the title and selected filters.
- Insufficient data: label the chart `Not enough data` and avoid implying a trend.
- Reduced motion: render directly into the final state without animated bars or pulsing indicators.

---

## 16. Empty, loading, error, and success states

### 16.1 Loading

Loading must preserve the final layout's geometry so the page does not jump.

- Use skeleton blocks with the same height and width as the content they replace.
- Use a neutral surface shimmer only if motion is enabled; a static pulse or flat placeholder is the reduced-motion fallback.
- Keep page title, navigation, and filters usable when data loading is local to one region.
- Use button-level loading for saves, syncs, exports, tests, and AI generation.

### 16.2 Empty

An empty state contains:

1. What is empty.
2. Why it may be empty, when useful.
3. One next action if the existing workflow supports one.

Examples grounded in this product include no merchants found after search, no alerts, no action history, no saved creatives, no live shoppers, no reorder schedules, and no captured leads. Do not use a generic illustration for every empty state.

### 16.3 Error

Use inline errors for field and panel failures. Use a toast only for a transient result that does not require explanation.

An error must say:

- what failed;
- whether previous data is still present;
- what the user can do next.

Examples: `We could not verify the sender domain. Check the DNS records and try again.` or `Live activity could not be refreshed. The previous results are still shown.`

### 16.4 Success

Success is visible, brief, and contextual. Prefer a status change near the saved object or a small toast for a completed operation. Do not use confetti, glow, or page-wide animation.

### 16.5 Paused and disabled

Paused is an operational state, not a generic error. Use an explicit banner when platform controls or integration state make a surface unavailable. The existing `Real-Time Telemetry Paused by Platform Admin` state should remain clear and non-alarming.

Disabled means the control cannot be used now. Provide helper text when the reason is not obvious, such as a missing Shopify connection or unverified domain.

---

## 17. Responsive behavior

### 17.1 Breakpoints

Use the following shared breakpoints:

| Breakpoint | Intent |
| --- | --- |
| 480px | Small mobile adjustments |
| 768px | Mobile to tablet transition, drawer navigation, one-column forms |
| 1024px | Tablet and compact desktop layouts |
| 1280px | Full desktop layout with multi-column analytical panels |
| 1440px and above | Increase available content width, not type size or visual noise |

### 17.2 Mobile priorities

On small screens, preserve this order:

1. Page title and current status.
2. Primary action.
3. Most important metric or decision.
4. Detail and supporting analysis.
5. Historical or secondary data.

Do not hide critical states or destructive controls solely because the viewport is small.

### 17.3 Responsive layout rules

- Metric grids collapse from 4 or 3 columns to 2, then 1.
- Two-panel analytical layouts become one column with the primary decision region first.
- Form grids become one column below 768px.
- Toolbars wrap with full-width search first and secondary filters below it.
- Tabs scroll horizontally rather than wrapping into multiple rows.
- Tables use a controlled horizontal scroll region with a visible label or affordance.
- Modal actions stack with the primary action last or visually dominant, depending on task safety.
- Dense table and audit text stays at least 13px where possible; do not solve space by making the interface unreadable.

### 17.4 Touch targets

All interactive targets are at least 44px high and 44px wide where the target is icon-only. Compact table actions may be smaller visually but must retain a 44px hit area.

---

## 18. Accessibility

### 18.1 Baseline

Target WCAG 2.2 AA for both OS surfaces. Accessibility is a product quality requirement, not a later QA pass.

### 18.2 Keyboard behavior

- Every navigation item, control, tab, table action, modal action, and menu item is keyboard reachable.
- Focus order follows visual and task order.
- Focus-visible states are never removed.
- Modals trap focus and return focus to the trigger when closed.
- Mobile drawer focus moves to the close button or first navigation item and returns to the menu button on close.
- Tabs use arrow-key navigation where implemented as a true tablist, with `aria-selected` and controlled panels.

### 18.3 Semantics

- Use actual headings in order. Do not style a `div` as a heading without the correct semantics.
- Use `button` for actions and links for navigation.
- Use table headers with scope and accessible names for tables.
- Use `aria-live="polite"` for non-critical refresh, save, export, and AI-generation feedback.
- Use `role="alert"` only for errors or urgent state changes that require immediate attention.
- Give every chart a text summary or accessible data table.

### 18.4 Color and motion

- Never communicate status with color alone.
- Provide `prefers-reduced-motion` behavior for loaders, live dots, chart transitions, drawer animation, and page transitions.
- Avoid blur-heavy UI because it can reduce clarity for low-vision users and weak devices.
- Ensure dark mode also meets contrast requirements.

### 18.5 Content accessibility

- Use plain labels and direct error copy.
- Keep technical IDs and code values in monospace, but include a readable label.
- Do not use emoji as the only label or status signal.
- Do not truncate a critical state without a way to reveal the full text.

---

## 19. Admin OS patterns

### 19.1 Admin OS design role

Admin OS is the platform operations surface. It should feel compact, cautious, and audit-friendly. The user is responsible for platform-wide state, merchant access, limits, and emergency controls. Admin OS should prioritize scope, status, and consequence over visual excitement.

### 19.2 Admin Overview

**Current purpose:** Understand platform health, merchant states, AI budget, top consumers, and recent alerts.

**Recommended hierarchy:**

1. Page header: `Platform Overview`, global pause state if active, and `Refresh`.
2. Merchant status group: Active, Paused, Onboarding, Connection Error.
3. Platform activity group: chats, leads, opt-ins, add to carts, purchases, emails.
4. Two-column detail row: AI Budget and Top AI Consumers.
5. Recent Alerts feed.

**Behavior:**

- Make global pause state visible in the header and in the emergency-control context.
- Treat budget as a resource state with spent, remaining, thresholds, and last updated time. The bar is secondary to the numbers.
- Use the alert list for recent operational events, not as a general activity stream.
- Keep the page stable during refresh. Update individual blocks with skeletons or a refresh state.

**Responsive:**

- Status and activity metrics become two columns, then one.
- AI Budget appears before Top AI Consumers on mobile.
- Recent Alerts stays below the resource summary.

### 19.3 Merchant Management

**Current purpose:** Search, filter, inspect, and create merchants.

**Recommended hierarchy:**

1. Page header: `Merchant Management` and `Create Merchant`.
2. Toolbar: search, status filter, result count, clear filters.
3. Merchant data table.

**Table guidance:**

- Merchant name is the primary row value, email and domain are secondary.
- Status uses the shared status badge.
- Put row actions at the end and keep the merchant row clickable only if the detail view is the established action.
- Preserve active search and status filter when navigating back from Merchant Detail.

**Responsive:**

- Search is full width on mobile.
- The table scrolls horizontally; do not hide status or the primary merchant identity.
- Create Merchant remains visible as the primary page action, but may become a full-width button below the title.

### 19.4 Merchant Detail

**Current purpose:** Inspect one merchant's information, store and agent, Shopify connection, metrics, feature controls, token and chat usage, and audit log.

**Recommended hierarchy:**

1. Back to Merchants control.
2. Merchant identity header with status and essential domain context.
3. Existing tabs: Details, Usage, Audit Log.
4. Details: Merchant Info, Store & Agent, Shopify Connection, Metrics, Store Feature Controls & Platform Toggles.
5. Usage: Token & Chat Usage.
6. Audit Log: Activity & Audit Log.

**Behavior:**

- Keep identity and status visible while switching tabs.
- Use two-column information panels at desktop and one column below 1024px.
- Feature toggles need descriptions, current state, and an immediate or save-based behavior label.
- Audit entries use compact rows with action, actor or source, timestamp, and detail. Do not use a dense decorative timeline.

### 19.5 Platform Controls

**Current purpose:** Configure global AI budget, default limits, default email recovery, default widget values, and emergency controls.

**Recommended hierarchy:**

1. Page header with role restriction state when the current user cannot change settings.
2. Global AI Budget.
3. Default Limits.
4. Default Email Recovery.
5. Default Widget.
6. Emergency Controls, visually separated and placed last.

**Behavior:**

- Each existing form remains an independent save unit.
- The read-only state for non-super-admin users must be visible in the page header and on controls.
- Threshold fields should show units and helper text. Avoid unlabeled numeric inputs.
- Emergency controls use a warning or danger panel, but the surrounding page stays calm.
- `Global Pause All Agents` requires confirmation naming the scope. `Global Resume All Agents` should state the new active state after completion.

### 19.6 Alerts

**Current purpose:** Show operational alerts and severity.

**Recommended hierarchy:**

1. Page header: `Alerts` and unread count if available.
2. Filter or scope only if supported by the existing data.
3. Alert list ordered by time and severity.

**Behavior:**

- Use a visible severity label and timestamp.
- Critical and warning items should not rely on left border color alone.
- Keep alert copy concise and actionable.
- An empty state should say when no alerts are present, not imply a system failure.

### 19.7 Admin modals

The current Create Merchant, Confirm Action, and Merchant Onboarding Link modals should use the shared modal rules. The invite link input is a technical value and should use monospace, read-only styling with `Copy Link` and `Open Wizard` as explicit actions.

---

## 20. Merchant OS patterns

### 20.1 Merchant OS design role

Merchant OS is the operating surface for a store owner or operator. It must balance commercial outcomes, live store behavior, configuration, and AI-generated recommendations. The user should always understand whether they are viewing a measured result, an estimate, a configuration state, or an action suggestion.

### 20.2 Growth Copilot

**Current purpose:** Show estimated opportunity, attributed revenue, blended ROAS, store conversion, AI-assisted sales, today's growth actions, weekly summary, AI explanation, strategic takeaways, and action execution history.

**Recommended hierarchy:**

1. Page header: `Growth Copilot` with the existing goal selector and `Refresh Actions`.
2. KPI row with Estimated Opportunity as the leading metric.
3. Today's Growth Actions as the primary decision block.
4. Two-column supporting row: Weekly Growth Summary and AI Growth Copilot Insights.
5. Action Execution History table.

**Behavior:**

- Label model-based estimates and attributed values distinctly.
- An action card should expose what was detected, why it matters, expected effect if available, current status, and the existing action control.
- `Ask Copilot` is a secondary explanatory action. It should not visually compete with the action list.
- Use a neutral empty state when no action is detected. Do not manufacture urgency.
- History is supporting evidence and should use compact table density.

**Responsive:**

- KPI cards become a one-column or two-column stack.
- Today's Growth Actions appears before the weekly summary.
- Weekly summary and AI explanation stack vertically.
- History table remains scrollable with the action status visible.

### 20.3 Overview

**Current purpose:** Show store performance, agent and widget status, recovery email outcomes, AI usage, and AI store intelligence.

**Recommended hierarchy:**

1. Page header: `Store Overview` with Agent Status and Widget Status.
2. Primary store metrics: Chats, Leads Captured, Marketing Opt-ins, Recommendations, Add to Carts, Completed Purchases.
3. Recovery Emails group.
4. Current Month AI Usage group with cost, limits, and progress.
5. AI Store Intelligence & Action Insights with What is Happening, Why It Is Happening, and Top 3 Recommended Next Actions.

**Behavior:**

- Keep commercial outcomes and AI cost visually distinct.
- Status badges reflect source state, not a general page health assumption.
- AI explanation blocks should use readable body width and explicit provenance language such as `Based on current store telemetry` when present.
- `Run Full Store Audit` is a primary analysis action within the intelligence block, not a page-level CTA.

### 20.4 Live Pulse & Funnel

**Current purpose:** Monitor active shoppers, live engagement, funnel drop-offs, and real-time event activity.

**Recommended hierarchy:**

1. Page header: `Live Shopper Pulse & Conversion Funnel`, real-time telemetry label, funnel window, and refresh.
2. Paused banner when platform admin has disabled live tracking.
3. Active Shoppers Right Now hero metric.
4. AI Chats Today, Cart Additions, Funnel Conversion mini-metrics.
5. Storefront Conversion Funnel with diagnostics.
6. Live Activity Ticker.
7. Recommendation performance and Ask AI controls where they already exist.

**Behavior:**

- Keep live data visually energetic only through a restrained status indicator. Do not animate the whole page.
- Show the 5-minute inactivity window as supporting context, not as a decorative badge.
- Separate live events from historical funnel totals.
- Refresh should expose last updated time and retain the selected funnel window.
- The `Real-Time Telemetry Paused by Platform Admin` banner is a full-width state, not a toast.

### 20.5 My Agent

**Current purpose:** Configure the assistant and its operating behavior.

**Recommended hierarchy:**

1. Page header with current agent status.
2. Identity, greeting, and behavior configuration groups as already represented in the page.
3. Knowledge or document upload area if present.
4. Save actions per form group.

**Behavior:**

- Explain the effect of each setting in helper text.
- Distinguish content configuration from platform or integration state.
- Preserve entered values during validation errors and document upload failures.

### 20.6 Leads & Opt-ins

**Current purpose:** Review captured leads, consent state, conversion, and export.

**Recommended hierarchy:**

1. Page header: `Marketing Opt-ins & Leads` and existing export action.
2. Summary metrics: Total Captured Leads, Opted-In, Converted Purchases, Conversion Rate.
3. Lead table with consent, conversion, and relevant identity fields.

**Behavior:**

- Make consent state explicit and never infer opt-in from a captured email.
- Use the same table state behavior as Admin Merchant Management.
- Export has its own loading state and completion message. Do not freeze the page without feedback.

### 20.7 Widget Settings

**Current purpose:** Configure widget styling and review the live preview and installation snippet.

**Recommended hierarchy:**

1. Page header: `Widget Customization & Styling`.
2. Configuration form.
3. Live Widget Preview.
4. Installation Snippet.

**Behavior:**

- Use a two-column form and preview on desktop; stack the preview after the form on mobile.
- The preview is a real preview of current values and should expose an explicit unsaved or saved state.
- The installation snippet is a code surface with monospace typography, copy action, and success feedback.
- Do not use the preview as a generic marketing mockup. It should answer whether the widget looks and behaves as configured.

### 20.8 Shopify Catalog

**Current purpose:** Inspect Shopify connection, sync state, catalog counts, and products.

**Recommended hierarchy:**

1. Page header: `Shopify Connection` with domain and connection state.
2. Connection actions: test and sync where already present.
3. Catalog metrics: Total Products, In Stock, Categories.
4. Product table and search.

**Behavior:**

- Test connection and sync are separate actions with separate loading states.
- The domain is a technical identity value and should use readable secondary text, not a giant badge.
- A stale catalog should show the last sync time and an actionable state.

### 20.9 Ad Creative Studio

**Current purpose:** Select products, configure ad inputs, preview generated variations, generate images or copy, and manage saved creatives.

**Recommended hierarchy:**

1. Page header: `AI Ad Creative Studio`.
2. Controls and selected product.
3. Preview surface with existing variations tabs.
4. Generation and save actions.
5. Saved Creatives table.

**Behavior:**

- Keep controls and preview in a stable 5 / 7 or 6 / 6 grid.
- Variation tabs are local content tabs and should not look like global navigation.
- Generation states preserve the selected product and show progress without replacing the preview with a blank panel.
- Saved creative actions remain explicit and are protected by confirmation where deletion exists.

### 20.10 WhatsApp Growth

**Current purpose:** Configure the WhatsApp provider, view analytics, conversations, messages, and consents.

**Recommended hierarchy:**

1. Page header with provider or connection status.
2. Analytics summary.
3. Configuration form.
4. Conversations and selected messages.
5. Consents table.

**Behavior:**

- Keep configuration state separate from conversation content.
- Use a split layout on wide screens only when the selected conversation context remains visible.
- On mobile, show the conversation list first, then open messages as a drawer or full-width detail view without losing the selected conversation.
- Consent revocation is a destructive action and uses the shared confirmation pattern.

### 20.11 Email Automation

**Current purpose:** Configure recovery email behavior and send a test email.

**Recommended hierarchy:**

1. Page header: `Email Automation` with sender or domain state.
2. Automation configuration.
3. Send Test Email.

**Behavior:**

- Explain whether the sender domain is verified before enabling recovery behavior.
- Test send feedback should include delivery request state without claiming inbox delivery unless the system can verify it.
- Keep test actions visually secondary to the saved configuration.

### 20.12 Smart Reorder

**Current purpose:** Review reorder analytics, configure channels, manage replenishable products, and inspect customer schedules.

**Recommended hierarchy:**

1. Page header: `Smart Reorder & Replenishment`.
2. Summary metrics: Active Schedules, Upcoming, Reminders Sent, Reorders Completed, Conversion Rate.
3. Reorder Channel & Loyalty Configuration.
4. Replenishable Products Catalog.
5. Customer Reorder Schedules.

**Behavior:**

- Keep summary numbers separate from editable settings.
- Product settings use the table pattern with clear saved state for row actions.
- Schedule tables prioritize due date, customer or product identity, channel, and status.
- AI recommendations are advisory and should be labeled as such.

### 20.13 Ad Intelligence

**Current purpose:** Review multi-touch attribution, channel and campaign performance, attributed orders and journeys, and ad spend.

**Recommended hierarchy:**

1. Page header: `Multi-Touch Ad Intelligence & Attribution`.
2. Attribution model control.
3. Overview metrics.
4. Channel and campaign performance.
5. Attributed orders and journey detail.
6. Manage Ad Spend.

**Behavior:**

- Make the active attribution model visible next to the data it affects.
- Separate modeled attribution from observed order data.
- Use consistent time windows and show them in every chart or table header where ambiguity is possible.
- Spend edits and journey inspections use their existing actions and should not compete visually with the overview.

---

## 21. Reusable component architecture

### 21.1 Layering model

The codebase is currently static HTML, CSS, and JavaScript with Three.js for background visuals. The design system should be implemented incrementally without requiring a framework migration.

Use four layers:

#### Layer 1: Tokens

Shared custom properties for color, type, spacing, shape, elevation, motion, and control sizes.

#### Layer 2: Primitives

Small visual building blocks with no product-specific business logic:

- `Button`
- `IconButton`
- `Input`
- `Select`
- `Textarea`
- `Checkbox`
- `Toggle`
- `Badge`
- `StatusIndicator`
- `Divider`
- `Tooltip`
- `Skeleton`
- `InlineMessage`

#### Layer 3: Patterns

Reusable combinations for existing surfaces:

- `AppShell`
- `Sidebar`
- `MobileDrawer`
- `PageHeader`
- `SectionHeader`
- `MetricGrid`
- `MetricCard`
- `FilterBar`
- `DataTable`
- `Tabs`
- `FormSection`
- `Panel`
- `Modal`
- `ConfirmDialog`
- `Toast`
- `EmptyState`
- `LoadingState`
- `ErrorState`
- `ChartFrame`
- `AuditLog`
- `CodeSnippet`

#### Layer 4: Existing product modules

Keep existing module sections and IDs as the product-specific layer. Each module composes patterns and maps API data into them. The design system does not create new modules.

### 21.2 Component contracts

Every reusable component should define:

- allowed content and maximum density;
- visual states;
- keyboard behavior;
- mobile behavior;
- semantic HTML requirements;
- loading and error handling;
- whether it is interactive or purely presentational.

### 21.3 Shared CSS direction

Create one shared token and primitive layer consumed by both `src/public/admin/css/admin.css` and `src/public/dashboard/css/styles.css`. Keep OS-specific layout rules in each file, but remove duplicate definitions for colors, font stacks, spacing, controls, buttons, badges, tables, modals, and focus states.

Do not add a new component library only to reproduce a visual style. The current static app can achieve this system with semantic HTML, shared CSS classes, and small JavaScript state helpers. If a library is introduced later, it must consume these tokens and must not become a second design system.

### 21.4 Naming rules

Use stable, role-based classes and data attributes.

Good examples:

- `.app-shell`
- `.page-header`
- `.metric-card`
- `.status-badge status-badge--warning`
- `.data-table`
- `[data-state="loading"]`
- `[aria-current="page"]`

Avoid names tied to one color or visual trend such as `.glass-panel`, `.purple-card`, `.gradient-button`, or `.glow-metric`.

### 21.5 State modeling

Prefer explicit state attributes or classes over style mutations scattered through JavaScript:

```html
<section class="panel" data-state="loading" aria-busy="true">
  ...
</section>
```

Approved state values are `default`, `hover`, `focus`, `active`, `loading`, `success`, `error`, `empty`, `paused`, `disabled`, and `readonly` where applicable.

### 21.6 Icons

Select one icon family for the product and use it consistently. Icons should be 16px in dense rows, 20px in navigation and controls, and 24px only for prominent empty or status states. Do not use emoji as the visual system for controls.

---

## 22. Page-level design recommendations

This table is the implementation checklist for the existing pages. It describes how to apply the system without changing the underlying workflow.

| Existing page | Primary visual job | Recommended layout | Highest-priority refinement |
| --- | --- | --- | --- |
| Admin Overview | Platform health and resource state | Header, two metric groups, budget / consumers split, alerts | Separate merchant status from platform activity and make global pause state explicit |
| Merchant Management | Find and inspect merchants | Header, search/filter toolbar, data table | Preserve filters and make row identity, status, and action hierarchy obvious |
| Merchant Detail | Inspect one merchant safely | Back control, identity header, existing tabs, detail panels | Keep status and scope visible while switching tabs |
| Platform Controls | Configure defaults and emergency state | Stacked form sections with independent saves | Visually separate normal configuration from emergency controls |
| Alerts | Resolve operational issues | Severity-ordered alert feed | Make severity and next action readable without relying on color |
| Growth Copilot | Decide what to do next | KPI row, action center, summary / AI split, history table | Distinguish measured outcomes, estimates, and AI explanations |
| Overview | Understand store performance | Status header, store metrics, email and AI usage groups, intelligence | Keep commercial outcomes separate from AI cost and model commentary |
| Live Pulse & Funnel | Understand current shopper behavior | Live status, active shopper focus, mini-metrics, funnel, live feed | Make time window, last update, paused state, and data source explicit |
| My Agent | Configure assistant behavior | Grouped forms with helper text and clear saves | Explain setting impact and preserve values through errors |
| Leads & Opt-ins | Review consented and captured leads | Summary metrics, export, data table | Treat consent as explicit data, never as an inferred state |
| Widget Settings | Configure and verify storefront presentation | Form plus live preview, installation snippet | Show saved versus unsaved preview state and make copy action obvious |
| Shopify Catalog | Verify connection and inspect catalog | Connection header, actions, catalog metrics, product table | Separate test connection from sync and show freshness |
| Ad Creative Studio | Generate and review creative | Controls plus preview, variation tabs, saved table | Keep generation state stable and prevent preview from becoming a blank loader |
| WhatsApp Growth | Configure provider and inspect conversations | Provider status, analytics, config, conversations, consents | Separate operational configuration from message history and consent actions |
| Email Automation | Configure recovery and test delivery | Configuration section plus test email section | Make sender verification and test delivery state explicit |
| Smart Reorder | Monitor replenishment and manage schedules | Metrics, channel settings, products, schedules | Separate insight from editable settings and preserve row-level save state |
| Ad Intelligence | Understand attribution and spend | Model control, overview, channel/campaign analysis, orders, spend | Keep attribution assumptions visible next to the data they affect |

---

## 23. Interaction quality checklist

Before considering a page complete, verify:

### Visual system

- [ ] The page uses the shared tokens, not one-off colors or spacing.
- [ ] There is one brand accent and semantic colors are used only for state.
- [ ] Surfaces are flat and layered only where hierarchy requires it.
- [ ] Typography uses the shared scale, sentence case, and tabular numerals.
- [ ] Cards are used to group real concepts, not every block.

### Information hierarchy

- [ ] The title, page purpose, primary action, and current state are clear within the first viewport.
- [ ] Related metrics are grouped and labeled.
- [ ] High-impact actions are visually distinct from explanation and history.
- [ ] AI-generated content is labeled as an estimate, analysis, or recommendation where appropriate.
- [ ] Existing labels, modules, and workflows remain intact.

### Interaction states

- [ ] Hover, focus, pressed, disabled, loading, success, and error states exist where applicable.
- [ ] Refresh, sync, export, save, test, generate, and destructive actions expose progress and result.
- [ ] Empty states explain what is empty and what can happen next.
- [ ] Paused states explain the source of the pause.
- [ ] Stale data is labeled instead of silently presented as current.

### Responsive behavior

- [ ] The shell becomes a usable drawer on mobile.
- [ ] Forms stack without losing labels or helper text.
- [ ] Tables preserve semantics and access to important columns.
- [ ] Tabs scroll instead of wrapping into an ambiguous multi-row control.
- [ ] Charts have a text summary or table fallback.

### Accessibility

- [ ] Keyboard navigation and focus-visible styles work.
- [ ] Modals trap focus and return it correctly.
- [ ] Status is not communicated by color alone.
- [ ] Touch targets meet the minimum size.
- [ ] Reduced motion removes decorative motion and keeps state understandable.
- [ ] Contrast passes in both light and dark themes.

---

## 24. Migration sequence

Apply the system in this order so visual work improves quality without disrupting existing behavior:

1. Extract shared tokens and typography into one layer.
2. Replace the two divergent button, input, badge, table, modal, and focus systems.
3. Remove decorative gradients, glow, and glass from product surfaces.
4. Normalize the shell, sidebar, mobile drawer, page header, and active navigation states.
5. Normalize metric groups, panels, tables, forms, tabs, and status indicators.
6. Add full loading, empty, error, paused, and success states to existing data regions.
7. Refine page-specific hierarchy following the Admin OS and Merchant OS sections above.
8. Audit every page at desktop, tablet, and mobile widths.
9. Run an accessibility pass with keyboard-only navigation, reduced motion, and light/dark contrast checks.

Do not migrate a single page into a new visual language while leaving its neighboring pages in the old system. Shared primitives should move first so the product feels coherent at each step.

---

## 25. Final design standard

The finished product should feel quiet enough for daily operations, dense enough for platform work, and clear enough for a merchant to make a decision quickly. A user should be able to answer four questions at any point:

1. Where am I?
2. What is the current state?
3. What matters most here?
4. What can I safely do next?

If a visual treatment does not improve one of those answers, it does not belong in the system.
