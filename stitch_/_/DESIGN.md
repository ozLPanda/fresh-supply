---
name: GastroFlow
colors:
  surface: '#f7f9fb'
  surface-dim: '#d8dadc'
  surface-bright: '#f7f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f6'
  surface-container: '#eceef0'
  surface-container-high: '#e6e8ea'
  surface-container-highest: '#e0e3e5'
  on-surface: '#191c1e'
  on-surface-variant: '#434653'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f3'
  outline: '#737685'
  outline-variant: '#c3c6d6'
  surface-tint: '#2156ca'
  primary: '#00328a'
  on-primary: '#ffffff'
  primary-container: '#0047bb'
  on-primary-container: '#afc1ff'
  inverse-primary: '#b3c5ff'
  secondary: '#505f76'
  on-secondary: '#ffffff'
  secondary-container: '#d0e1fb'
  on-secondary-container: '#54647a'
  tertiary: '#31394e'
  on-tertiary: '#ffffff'
  tertiary-container: '#485066'
  on-tertiary-container: '#bbc2dc'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dbe1ff'
  primary-fixed-dim: '#b3c5ff'
  on-primary-fixed: '#00174a'
  on-primary-fixed-variant: '#003ea6'
  secondary-fixed: '#d3e4fe'
  secondary-fixed-dim: '#b7c8e1'
  on-secondary-fixed: '#0b1c30'
  on-secondary-fixed-variant: '#38485d'
  tertiary-fixed: '#dae2fd'
  tertiary-fixed-dim: '#bec6e0'
  on-tertiary-fixed: '#131b2e'
  on-tertiary-fixed-variant: '#3f465c'
  background: '#f7f9fb'
  on-background: '#191c1e'
  surface-variant: '#e0e3e5'
typography:
  headline-lg:
    fontFamily: Manrope
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Manrope
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Manrope
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  gutter: 24px
  margin-desktop: 64px
  margin-mobile: 16px
  container-max: 1280px
---

## Brand & Style
The brand personality for GastroFlow is rooted in reliability, precision, and architectural clarity. As a provider of professional services, the UI must evoke a sense of structural integrity and modern efficiency.

The design style follows a **Modern Corporate** aesthetic with a lean toward **Minimalism**. It prioritizes high-quality typography and intentional whitespace to reduce cognitive load. The visual language is disciplined and systematic, ensuring that information hierarchy is immediately apparent. We avoid decorative flourishes in favor of functional elegance, creating a workspace that feels dependable and high-performing.

## Colors
The color palette for GastroFlow is designed to project stability and professionalism.

- **Primary (#0047BB):** A deep, "Active Blue" used for primary actions, branding, and focused states. It represents the "Актив" (Active) spirit of the firm.
- **Secondary (#64748B):** A muted slate used for supporting information and secondary UI elements.
- **Tertiary (#0F172A):** An ink-dark navy reserved for high-contrast headings and deep backgrounds.
- **Neutral (#F8FAFC):** A crisp, cool grey used for surfaces to maintain a clean, airy feel.

Functional colors (Success, Warning, Error) should follow standard industry conventions but be adjusted to match the saturation levels of the Primary blue.

## Typography
The typography system balances the modern, geometric qualities of **Manrope** for headlines with the utilitarian clarity of **Inter** for body text. **JetBrains Mono** is introduced sparingly for labels and data points to emphasize the technical precision of GastroFlow.

All headlines use a tighter letter-spacing to appear more cohesive. Body text maintains a generous line height to ensure readability in data-heavy views. For mobile, headline sizes are scaled down to prevent awkward word breaks while maintaining their bold weight.

## Layout & Spacing
This design system utilizes a **Fixed Grid** model for desktop, centered within a 1280px container. The layout relies on an 8px spacing rhythm (derived from a 4px base unit) to maintain mathematical harmony across all components.

- **Desktop:** 12-column grid with 24px gutters and 64px side margins.
- **Tablet:** 8-column grid with 20px gutters and 32px side margins.
- **Mobile:** 4-column fluid grid with 16px gutters and 16px margins.

Vertical rhythm is strictly enforced; all components and text blocks should align to the 4px baseline grid to maintain a disciplined corporate structure.

## Elevation & Depth
Elevation is conveyed through **Tonal Layers** and subtle **Ambient Shadows**. We avoid heavy shadows in favor of surface-level differentiation.

- **Level 0 (Base):** Neutral background (#F8FAFC).
- **Level 1 (Card/Surface):** White background (#FFFFFF) with a soft 1px border (#E2E8F0).
- **Level 2 (Dropdowns/Modals):** White background with a diffused, low-opacity shadow (0px 4px 12px rgba(15, 23, 42, 0.08)).

This approach creates a "flat-plus" look where depth is suggested rather than forced, keeping the interface light and professional.

## Shapes
The shape language of GastroFlow is **Soft** but disciplined. We use a 0.25rem (4px) base radius for standard elements like buttons and inputs. This provides a modern touch without appearing overly "bubbly" or informal. Larger containers like cards may use the `rounded-lg` (8px) token to soften the overall layout.

## Components
Components within this design system are built for high-density information environments.

- **Buttons:** Primary buttons use a solid Primary Blue fill with white text. Secondary buttons use a ghost style (Primary Blue border and text). Padding is generous horizontally (1.5rem) but compact vertically (0.75rem).
- **Input Fields:** Use a 1px slate-200 border that thickens to 2px Primary Blue on focus. Labels use the `label-sm` (JetBrains Mono) style for a technical feel.
- **Cards:** White surfaces with a 1px border. No shadow by default; a subtle shadow appears only on hover to indicate interactivity.
- **Data Tables:** These are critical for GastroFlow. Use Inter for cell data and JetBrains Mono for numeric values. Row heights are kept at 48px for density.
- **Chips/Badges:** Small, caps-locked labels with a light background tint of the status color (e.g., light blue for "In Progress").
