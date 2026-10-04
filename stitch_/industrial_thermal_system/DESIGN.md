---
name: Industrial Thermal System
colors:
  surface: '#f8f9ff'
  surface-dim: '#ccdbf4'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e6eeff'
  surface-container-high: '#dde9ff'
  surface-container-highest: '#d5e3fd'
  on-surface: '#0d1c2f'
  on-surface-variant: '#45474c'
  inverse-surface: '#233144'
  inverse-on-surface: '#ebf1ff'
  outline: '#75777d'
  outline-variant: '#c5c6cd'
  surface-tint: '#545f73'
  primary: '#091426'
  on-primary: '#ffffff'
  primary-container: '#1e293b'
  on-primary-container: '#8590a6'
  inverse-primary: '#bcc7de'
  secondary: '#9d4300'
  on-secondary: '#ffffff'
  secondary-container: '#fd761a'
  on-secondary-container: '#5c2400'
  tertiary: '#330002'
  on-tertiary: '#ffffff'
  tertiary-container: '#5a0008'
  on-tertiary-container: '#ff5250'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d8e3fb'
  primary-fixed-dim: '#bcc7de'
  on-primary-fixed: '#111c2d'
  on-primary-fixed-variant: '#3c475a'
  secondary-fixed: '#ffdbca'
  secondary-fixed-dim: '#ffb690'
  on-secondary-fixed: '#341100'
  on-secondary-fixed-variant: '#783200'
  tertiary-fixed: '#ffdad7'
  tertiary-fixed-dim: '#ffb3ad'
  on-tertiary-fixed: '#410004'
  on-tertiary-fixed-variant: '#930013'
  background: '#f8f9ff'
  on-background: '#0d1c2f'
  surface-variant: '#d5e3fd'
  surface-base: '#FFFFFF'
  surface-muted: '#F8FAFC'
  border-subtle: '#E2E8F0'
  heat-high: '#EF4444'
  heat-medium: '#F97316'
  status-success: '#10B981'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  title-md:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 4px
  gutter: 16px
  margin-desktop: 32px
  margin-mobile: 16px
  container-max: 1280px
  sidebar-width: 280px
---

## Brand & Style

This design system establishes a high-performance, technical aesthetic for the heating and plumbing sector. It bridges the gap between rugged industrial reliability and modern SaaS efficiency. The target audience includes B2B contractors requiring precision and B2C homeowners seeking clarity and trust.

The visual style is **Corporate / Modern** with a focus on **Information Density**. It utilizes a structured grid, clear visual hierarchy, and functional accents to guide users through complex catalogs and technical specifications. The interface is intentionally clean to allow high-quality product imagery and technical data to remain the focal point.

## Colors

The palette is anchored by **Navy (#1E293B)** to evoke authority and professional stability. **Graphite** and **Light Grey** are used for structural elements, borders, and secondary text to maintain a technical feel without overwhelming the user.

**Vibrant Orange (#F97316)** serves as the primary action color, symbolizing warmth and "active" heating systems, while **Red (#EF4444)** is reserved for critical heat-related warnings, urgent calls to action, or hot water indicators. The background remains primarily white to ensure high readability and a "SaaS-native" cleanliness.

## Typography

The system utilizes **Inter** for its exceptional legibility in data-heavy environments. It provides a neutral, modern tone that scales perfectly from small technical specs to large marketing headlines.

To reinforce the "Technical/Industrial" persona, **JetBrains Mono** is introduced for technical labels, article numbers, specifications, and data points within tables. This monospaced secondary font provides a distinct visual cue for "hard data" versus "narrative text."

## Layout & Spacing

This design system uses a **Fixed Grid** approach for desktop views to maintain a professional, organized dashboard feel, and a **Fluid Grid** for mobile marketplaces.

- **Desktop:** 12-column grid with 24px gutters. A persistent sidebar (280px) is recommended for navigation, allowing the main content area to function as a technical workspace.
- **Tablets:** 8-column grid with 16px gutters. Sidebar collapses into a drawer.
- **Mobile:** 4-column grid with 16px gutters and 16px side margins.

Spacing follows a 4px base unit (4, 8, 12, 16, 24, 32, 48, 64) to ensure mathematical alignment across all components.

## Elevation & Depth

Visual hierarchy is achieved through **Tonal Layers** and **Low-contrast Outlines**. Surfaces are stacked logically:
1. **Background:** Light Grey (#F8FAFC) - The canvas for the application.
2. **Cards/Containers:** White (#FFFFFF) - Using a subtle 1px border (#E2E8F0) rather than heavy shadows to maintain a crisp, blueprint-like feel.
3. **Active/Hover:** Ambient, low-opacity shadows (Navy tint, 4% opacity) are used only for interactive elements like product cards or dropdown menus to signify lift.

The design avoids heavy blurs, favoring sharp transitions that suggest precision and mechanical reliability.

## Shapes

The design system uses a **Soft (0.25rem)** roundedness. This subtle rounding prevents the interface from feeling "sharp" or "hostile" while maintaining the rigid, structural integrity expected in engineering and logistics.

Large components like primary dashboard containers or "Add to Cart" banners may use `rounded-lg` (0.5rem) to differentiate them from smaller UI elements like input fields and tags.

## Components

- **Buttons:** Primary buttons use the Orange (#F97316) background with White text. Technical actions (Export, Print) use Navy outlines.
- **Data Tables:** High-density layouts. Headers are Graphite with uppercase Monospaced labels. Row hovering uses a subtle Light Grey (#F8FAFC) fill.
- **Cards:** Product cards feature a fixed-aspect-ratio image area, followed by the product name in Inter Bold and the article number in JetBrains Mono.
- **Inputs:** Clean, outlined fields with a 1px border. Focus states use a Navy border and a 2px Orange outer glow.
- **Status Chips:** Used for stock levels and temperatures. "In Stock" uses Green, while "Backordered" or "High Temp" use Orange or Red tints with semi-transparent backgrounds.
- **Dashboard Widgets:** Compact modules containing sparkline charts for price trends or stock levels, utilizing Navy for the primary line and Orange for current value markers.
- **Filters:** A vertical accordion-style filter system in the sidebar, allowing users to drill down by BTU rating, pipe diameter, or manufacturer.
