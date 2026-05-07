---
name: Synthetic Intelligence
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#494454'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#7b7486'
  outline-variant: '#cbc3d7'
  surface-tint: '#6d3bd7'
  primary: '#6b38d4'
  on-primary: '#ffffff'
  primary-container: '#8455ef'
  on-primary-container: '#fffbff'
  inverse-primary: '#d0bcff'
  secondary: '#006591'
  on-secondary: '#ffffff'
  secondary-container: '#39b8fd'
  on-secondary-container: '#004666'
  tertiary: '#a12e70'
  on-tertiary: '#ffffff'
  tertiary-container: '#c0488a'
  on-tertiary-container: '#fffbff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e9ddff'
  primary-fixed-dim: '#d0bcff'
  on-primary-fixed: '#23005c'
  on-primary-fixed-variant: '#5516be'
  secondary-fixed: '#c9e6ff'
  secondary-fixed-dim: '#89ceff'
  on-secondary-fixed: '#001e2f'
  on-secondary-fixed-variant: '#004c6e'
  tertiary-fixed: '#ffd8e7'
  tertiary-fixed-dim: '#ffafd3'
  on-tertiary-fixed: '#3d0026'
  on-tertiary-fixed-variant: '#85145a'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  display-xl:
    fontFamily: Inter
    fontSize: 60px
    fontWeight: '800'
    lineHeight: 72px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
    letterSpacing: '0'
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: '0'
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
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
  base: 4px
  xs: 8px
  sm: 16px
  md: 24px
  lg: 48px
  xl: 80px
  gutter: 24px
  margin: 32px
---

## Brand & Style
The design system is engineered to evoke the presence of a high-end AI agent—precise, knowledgeable, and hyper-modern. It targets professionals seeking career advancement through the lens of cutting-edge technology. 

The aesthetic is a hybrid of **Minimalism** and **Glassmorphism**, characterized by expansive white space, razor-sharp execution, and ethereal "synthetic" accents. The emotional response is one of clarity and empowerment, where the interface feels less like a tool and more like an intelligent partner. Visual interest is generated through light-leak effects, micro-glows, and high-energy violet focal points against a disciplined slate foundation.

## Colors
The palette is anchored by **Electric Purple (#8B5CF6)**, a synthetic violet that represents the "intelligence" of the platform. This is supported by a sophisticated **Slate** scale for surfaces and text to maintain professional credibility.

- **Primary:** Electric Purple is used for primary actions, active states, and data visualizations.
- **Surface:** The background utilizes Light Slate (#F8FAFC) to provide a crisp, sterile environment that allows violet accents to pop.
- **Text:** Deep Slate (#1E293B) ensures maximum readability and high contrast.
- **Functional:** Success, warning, and error states should be desaturated to avoid clashing with the primary violet, using subtle glows rather than heavy solid fills.

## Typography
This design system exclusively utilizes **Inter** for its systematic, utilitarian precision. The typographic hierarchy is designed to feel authoritative yet accessible.

Headlines use tight letter-spacing and heavy weights to create a "tech-editorial" look. Labels and metadata are set in uppercase with increased letter-spacing to mimic terminal readouts and technical specifications. Paragraph text prioritizes legibility with generous line heights, ensuring that career-related data and AI-generated insights are easily digestible.

## Layout & Spacing
The layout follows a **Fixed Grid** model for desktop (12-column, 1200px max-width) and a fluid model for mobile. The spacing rhythm is strictly based on a **4px baseline**, ensuring mathematical harmony across all components.

Layouts should favor vertical stacks with significant "breathing room" (LG and XL spacing) between major sections to prevent information fatigue. Content containers use the gutter width (24px) for internal padding to maintain structural alignment.

## Elevation & Depth
Depth is created through **Tonal Layers** and **Backdrop Blurs** rather than traditional heavy shadows.

- **Level 0 (Floor):** The primary Surface Slate (#F8FAFC).
- **Level 1 (Cards):** Pure White (#FFFFFF) with a 1px border in Slate-200.
- **Level 2 (Modals/Popovers):** Semi-transparent white (80% opacity) with a 20px background blur (Glassmorphism) and a subtle 4px violet glow-shadow.
- **Accents:** Active elements should feature a "Synthetic Glow"—a drop shadow with 0px spread, high blur (15px), and 15% opacity of the Primary Electric Purple.

## Shapes
The shape language is defined by **Soft (0.25rem)** edges. While the vibe is futuristic, it avoids overly "bubbly" or pill-shaped elements to maintain a professional, high-end technical feel. 

Buttons, input fields, and small cards use the base `rounded` (4px). Larger containers and hero sections use `rounded-lg` (8px). This "crisp but safe" approach reinforces the precision of the AI agent narrative.

## Components
- **Buttons:** Primary buttons use a solid Electric Purple fill with white text. Hover states introduce a subtle violet outer glow. Secondary buttons are outlined with a 1px Slate border and violet text.
- **Chips/Tags:** Small, 4px-radius badges with a light violet background (10% opacity) and saturated violet text for technical skills or status indicators.
- **Input Fields:** Flat white backgrounds with a 1px Slate-200 border. On focus, the border transitions to Electric Purple with a 2px soft glow.
- **Cards:** Clean white surfaces with no visible shadow until hovered. Upon hover, the card gains a subtle "Synthetic Glow" and the border tints toward violet.
- **AI Response Agent:** A specialized component featuring a thin, 1px gradient border (Electric Purple to Transparent) and a soft blurred backdrop to distinguish AI-generated career advice from static content.
- **Progress Indicators:** Linear, thin bars using a gradient of Electric Purple to Light Slate to visualize career growth or profile completeness.