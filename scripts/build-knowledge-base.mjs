import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const KNOWLEDGE_DIR = path.join(ROOT, 'knowledge');

if (!fs.existsSync(KNOWLEDGE_DIR)) {
  fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
}

// 1. react-frontend.md
const reactFrontendContent = `# Domain Knowledge: React, Next.js & TypeScript Frontend Engineering

## Candidate Positioning
- **Role Target:** Senior Frontend Developer / Frontend Engineer / React & Next.js Developer / Product UI Engineer
- **Experience:** 6+ years of commercial frontend engineering specializing in React, Next.js, and TypeScript.
- **Core Value:** Architectural scalability, reusable component systems, high performance (Core Web Vitals), technical SEO, accessibility (WCAG), and business-aligned product UI.
- **Agency & Enterprise Delivery:** Delivered end-to-end frontend solutions across 16+ production platforms (e-commerce, marketplaces, recruitment portals, and SaaS tools).

---

## Technical Capabilities & Architecture

### 1. Core Frameworks & Languages
- **React.js:** Functional components, custom hooks, context API, state management, render optimization, reconciliation, and memoization (\`useMemo\`, \`useCallback\`, \`React.memo\`).
- **Next.js:** App Router and Pages Router, Server-Side Rendering (SSR), Incremental Static Regeneration (ISR), Static Site Generation (SSG), dynamic routes, API routes, image optimization (\`next/image\`), and bundle splitting.
- **TypeScript:** Strict typing, generics, utility types, discriminated unions, interface modeling, API contract typing, and type-safe component props.
- **Gatsby.js:** Static generation, GraphQL data layer, plugin ecosystem, headless CMS integration, and performance optimization for content-heavy sites.
- **JavaScript (ES6+):** Async/await, Promises, closures, event loop, DOM manipulation, modular architecture.

### 2. Architecture, Performance & Standards
- **Rendering & Data Fetching:** Prerendering, SSR, SSG, ISR, client-side hydration, and progressive enhancement.
- **Bundle Optimization:** Route-based code splitting, dynamic imports (\`next/dynamic\`, \`React.lazy\`), bundle analysis, and resource preloading.
- **Web Performance & Core Web Vitals:** Targeted optimization for Largest Contentful Paint (LCP), Interaction to Next Paint (INP), and Cumulative Layout Shift (CLS). Critical rendering path optimization, font optimization, and lazy loading.
- **Technical SEO:** Server-rendered HTML markup, semantic HTML5, structured data (JSON-LD), Open Graph metadata, canonicalization, and XML sitemaps.
- **Accessibility (a11y):** WCAG 2.1 AA compliance, ARIA attributes, semantic structure, keyboard navigation, color contrast, and screen reader compatibility.

### 3. Styling & Component Systems
- **Tailwind CSS:** Utility-first styling, configuration, design tokens, responsive breakpoints, container queries, and performance-friendly purging.
- **Styled Components:** CSS-in-JS, theme providers, dynamic props, scoped styling, and SSR style injection.
- **Preprocessors & Methodologies:** LESS, SASS/SCSS, CSS Modules, BEM naming conventions.
- **Figma Implementation:** Pixel-accurate, responsive conversion of complex Figma designs into accessible, cross-browser production code.

### 4. APIs & Data Handling
- **REST APIs & AJAX:** Fetch API, Axios, custom HTTP hooks, caching, error boundaries, and optimistic UI updates.
- **GraphQL:** Queries, mutations, schema integration, and Apollo/client caching patterns.
- **Fullstack Expansion (Honest Boundary):** Node.js — expanding toward frontend-heavy Fullstack TypeScript (API consumption, lightweight endpoints, build scripts, fullstack Next.js). Strictly no claims of commercial backend engineering, complex microservices, or database administration.

---

## Verified Commercial React / Next.js Projects

### 1. ponadczasowi.pl
- **Domain:** E-Commerce / Fashion & Lifestyle Platform
- **Technology Stack:** Next.js, React, TypeScript, Tailwind CSS, REST APIs
- **Verified Scope & Deliverables:**
  - Built production Next.js e-commerce storefront from requirements to deployment.
  - Implemented core customer journeys: product catalog, cart, multi-step checkout, payment gateway integrations, and shipping provider selectors.
  - Developed integrated content blog module to support inbound organic marketing.
  - Engineered performance optimizations: lazy loading of media and components, route-based code splitting, and responsive mobile UX.

### 2. copernicspace.com
- **Domain:** Web3 / Space Asset Marketplace & NFT Platform
- **Technology Stack:** React, Next.js, TypeScript, REST API, Styled Components
- **Verified Scope & Deliverables:**
  - Developed marketplace platform from scratch.
  - Built interactive marketplace builder, catalog listings, asset detail views, and user profile management modules.
  - Engineered responsive interfaces and client-side performance optimizations for heavy visual assets.

### 3. hrk.pl
- **Domain:** Recruitment & HR Advisory Platform
- **Technology Stack:** Gatsby.js, React, TypeScript, GraphQL, Styled Components, Headless CMS
- **Verified Scope & Deliverables:**
  - Delivered frontend implementation for the recruitment platform.
  - Re-architected SEO and metadata infrastructure on top of Gatsby static generation.
  - Verified outcome: achieved approximately 50% increase in organic search traffic through improved indexability, page speed, and semantic structuring.

### 4. pmicareers.pl
- **Domain:** Corporate Careers & Talent Acquisition Portal
- **Technology Stack:** React, Next.js, TypeScript, REST APIs
- **Verified Scope & Deliverables:**
  - Led migration of legacy single-page React application to modern Next.js.
  - Improved platform scalability, initial load times, and search engine discoverability.
  - Built, delivered, and maintained the full frontend layer.

### 5. learningspace.app
- **Domain:** Interactive Educational & Learning Platform
- **Technology Stack:** React, Next.js, TypeScript, Component Systems
- **Verified Scope & Deliverables:**
  - Built educational web platform featuring scalable UI components and interactive learning UX.
  - Implemented responsive dashboards, lesson progress trackers, and modular content containers.

### 6. carneoo.de
- **Domain:** Automotive Platform & Vehicle Marketplace
- **Technology Stack:** React, Next.js, Component Libraries
- **Verified Scope & Deliverables:**
  - Engineered custom frontend components, implemented new user-facing features, and resolved platform defects.
  - Improved overall platform stability, responsive behavior, and user journey flow.

---

## Tailoring Rules for React / Next.js Vacancies
- **Headline Priority:** \`Senior Frontend Developer | React | Next.js | TypeScript | Product UI\`
- **Project Selection:** Choose 2–4 of the above verified projects (\`ponadczasowi.pl\`, \`copernicspace.com\`, \`hrk.pl\`, \`pmicareers.pl\`, \`learningspace.app\`, \`carneoo.de\`) matching the vacancy focus (e-commerce, marketplace, SaaS, or content).
- **Skill Ordering:** Prioritize React, Next.js, TypeScript, SSR/ISR/SSG, Core Web Vitals, and Tailwind CSS.
`;

// 2. magento-hyva.md
const magentoHyvaContent = `# Domain Knowledge: Magento 2, Hyvä Theme & E-Commerce Architecture

## Candidate Positioning
- **Role Target:** Senior Magento Frontend Developer / Frontend Tech Lead (Magento & Hyvä) / E-Commerce Frontend Architect
- **Experience:** 6+ years of commercial e-commerce frontend delivery, with extensive depth in Magento 2, Hyvä Theme, and Hyvä CMS.
- **Core Value:** End-to-end ownership of the storefront user journey (PLP, PDP, Cart, Checkout, Customer Account), Enterprise-to-Hyvä migrations, sub-second page performance, and technical SEO.
- **Client & Cross-Functional Leadership:** Primary technical contact for direct clients (HUBER SE), translating business/marketing/SEO goals into frontend milestones, and coordinating with backend engineers and QA.

---

## Technical Capabilities & Architecture

### 1. Magento 2 & Hyvä Core
- **Magento 2 Storefronts:** Luma theme architecture, custom theme development, XML layout inheritance, block/container manipulation, and PHTML template rendering.
- **Hyvä Theme & Hyvä CMS:** Hyvä theme implementation, Hyvä CMS block and page structures, component modularization, and replacing heavy Knockout/RequireJS stacks with lightweight Alpine.js and Tailwind CSS.
- **Alpine.js:** Reactive client-side components, micro-interactions, modal management, dynamic price/variant recalculations, and state synchronization.
- **XML & Layout:** Layout XML handles, referenceBlock, referenceContainer, move, and container declarations.
- **PHTML & Templating:** Clean PHP templating, view models, escaped output, secure rendering, and asset injection.

### 2. Storefront User Journeys & Business Logic
- **PLP (Product Listing Page):** Layered navigation, faceted filtering, pagination, infinite scroll, category banners, product badges, and quick-view functionality.
- **PDP (Product Detail Page):** Configurable/simple product variant switching, gallery zoom, stock status indicators, dynamic pricing, cross-sells/up-sells, and specification tables.
- **Cart & Miniecart:** Real-time mini-cart updates, coupon application, cart drawer interactions, quantity adjustments, and shipping estimation.
- **Checkout:** Multi-step and one-step checkout flows, shipping and payment method selection, form validation, and order confirmation.
- **Customer Account & Portal:** Registration, login, order history, address book, saved payment methods, and wishlists.
- **Multi-Store & Multi-Market:** Store views, localization, currency switching, multi-market catalogue structures, and translation workflows.

### 3. Performance & Technical SEO
- **Core Web Vitals Optimization:** Sub-second LCP through server-rendered critical markup, optimized hero image loading, critical CSS inlining, and deferred JavaScript execution.
- **Asset Optimization:** Purging unused CSS, SVG icons, asynchronous script loading, and eliminating bloated third-party JavaScript.
- **Technical SEO:** Structured product schema (JSON-LD), breadcrumbs, canonical tag enforcement, hreflang multi-store tags, and sitemaps.
- **Accessibility:** WCAG 2.1 accessibility compliance for checkout inputs, interactive elements, modal focus traps, and screen reader announcements.

---

## Verified Commercial Magento 2 & Hyvä Projects

### 1. HUBER SE (Direct Client — Germany)
- **Role:** Lead Front-End Developer — Magento 2 / Hyvä (Jun 2026 – Present)
- **Context:** Direct client customer-facing Magento 2 / Hyvä e-commerce platform.
- **Verified Scope & Deliverables:**
  - Leading frontend delivery for a modern Magento 2 / Hyvä storefront.
  - Primary frontend technical contact for client management, evaluating feasibility and architecture.
  - Translating business, SEO, and marketing requirements into technical frontend tasks and sprints.
  - Building Hyvä CMS structures, reusable components, multi-language translations, and frontend enhancements.
  - Implementing features across CMS landing pages, PLP, PDP, Cart, Checkout, and Customer Account.
  - Driving improvements in UX consistency, performance (Core Web Vitals), accessibility, technical SEO, and code maintainability.
  - Coordinating closely with backend developers, SEO agencies, and client stakeholders.

### 2. Lufed IT
- **Role:** Senior Front-End Developer (Jan 2026 – Jun 2026)
- **Context:** E-Commerce product platform environment.
- **Verified Scope & Deliverables:**
  - Led frontend architecture and delivery for a high-traffic Magento 2 storefront using Hyvä.
  - Owned frontend implementation across PLP, PDP, Cart, Checkout, and Customer Account.
  - Drove full migration from legacy Magento 2 Enterprise to Hyvä Theme.
  - Built a reusable CMS and component system for content editors and marketing teams.
  - Collaborated directly with client leadership and SEO teams to optimize Core Web Vitals and platform conversion.

### 3. For Better Future Software House (Magento Client Engagements)
- **Role:** Senior Front-End Developer (Sep 2020 – Feb 2026)
- **Context:** Managed frontend architecture across 16+ production e-commerce platforms.
- **Verified Projects:**
  - **housetipster.com:** Full Magento 2 build from scratch (Homepage, PLP, PDP, CMS pages, Customer Account, and custom UI components).
  - **edycja.pl:** Magento 2 e-commerce store built from scratch with custom theme and advanced UI.
  - **fmic.pl:** Automotive performance parts store; engineered business logic enhancements and performance optimizations.
  - **dreamroots.pl:** E-commerce performance optimization, multi-language translations, and new catalog pages.
  - **hbsgroup.net:** Magento 2 version upgrades, new page layouts, and business logic defect fixes.
  - **paypair.com:** Payment solution frontend improvements, bug fixes, new features, and UX enhancements.

### 4. Cloudflight (Enterprise Magento Delivery)
- **Role:** Front-End Developer (Jul 2022 – Oct 2024)
- **Context:** Supporting enterprise e-commerce delivery across ~9 Magento 2 storefronts.
- **Verified Projects:**
  - **British American Tobacco (4 storefronts):** Product pages, checkout flows, customer account areas, and multi-market storefront delivery.
  - **catering24.co.uk:** Custom theme and CMS-driven storefront with advanced commercial integrations.
  - **solar.com.pl:** Custom storefront with specialized catalog integrations and custom UI components.

### 5. 3MK Protection (3mk.pl)
- **Role:** Front-End Developer (Mar 2024 – May 2024)
- **Context:** Mobile accessories manufacturer e-commerce platform.
- **Verified Scope & Deliverables:**
  - Built Magento 2 storefront from scratch.
  - Delivered Homepage, Category/PLP, Cart, and custom CMS components.
  - Engineered custom UI elements focused on UX, responsive mobile ergonomics, and checkout conversion.

### 6. ORBA
- **Role:** Frontend Developer (Jan 2020 – Apr 2020)
- **Context:** Cosmetics industry e-commerce platform.
- **Verified Scope & Deliverables:**
  - Developed frontend features specializing in Magento 2.
  - Optimized site responsiveness, performance, and user purchasing journey.

---

## Tailoring Rules for Magento / Hyvä Vacancies
- **Headline Priority:** \`Lead / Senior Front-End Developer | Magento 2 | Hyvä | E-commerce Architecture\`
- **Project Selection:** Choose 2–4 of the above verified projects (\`HUBER SE\`, \`housetipster.com\`, \`edycja.pl\`, \`British American Tobacco\`, \`3mk.pl\`, \`catering24.co.uk\`) based on the client's industry and technical scope.
- **Skill Ordering:** Prioritize Magento 2, Hyvä Theme, Hyvä CMS, Alpine.js, Tailwind CSS, XML/Layout, PHTML, Core Web Vitals, and Technical SEO.
`;

// 3. shopify.md
const shopifyContent = `# Domain Knowledge: Shopify & Liquid Storefront Engineering

## Candidate Positioning
- **Role Target:** Senior Shopify Developer / Shopify Front-End Developer / E-Commerce Storefront Engineer
- **Experience:** 6+ years in commercial e-commerce development with dedicated commercial Shopify storefront engineering.
- **Core Value:** Custom theme development, modular Liquid sections & blocks, Shopify Online Store 2.0 (OS 2.0) JSON templates, conversion rate optimization (CRO), and high-performance mobile storefronts.
- **Broader E-Commerce Foundation:** Backed by enterprise e-commerce experience across Magento 2 and modern React/Next.js architectures.

---

## Technical Capabilities & Storefront Architecture

### 1. Shopify Theme Development & Liquid
- **Liquid Templating (Expert):** Liquid objects, tags, filters, iteration, control flow, custom logic, and variable assignment.
- **Online Store 2.0 (OS 2.0):** JSON templates (\`product.json\`, \`collection.json\`, \`index.json\`), dynamic section rendering, and app block embedding.
- **Custom Sections & Blocks (Expert):** Modular section creation, block nesting, configurable schema definitions (\`schema\` tags), presets, and input types (text, image_picker, collection, product, richtext).
- **Shopify Admin Configuration (Expert):** Theme settings, navigation menus, collection sorting rules, product variants, inventory management, metafields, and metaobjects.
- **Section Rendering API:** Dynamic section re-rendering for cart drawers, variant changes, and instant filtering without full page reloads.

### 2. E-Commerce Customer Journeys & UI
- **Homepage:** High-impact hero sections, featured product carousels, collection grids, promotional banners, testimonial sections, and brand storytelling blocks.
- **Collection / PLP:** Faceted search & discovery, collection filtering (by tags, metafields, price, availability), custom sorting, grid/list toggles, and product cards.
- **Product / PDP:** Dynamic variant selectors, image galleries, thumbnail navigation, inventory availability notices, custom product logic, size guides, and add-to-cart drawers.
- **Cart & Checkout:** AJAX slide-out cart (cart drawer), line item notes, free shipping thresholds, cart upsells, and theme integration with Shopify checkout.
- **Design Translation:** Converting Figma designs into responsive, cross-browser, production-ready Shopify storefront components.

### 3. Performance, SEO & Conversion (CRO)
- **Web Performance & Core Web Vitals:** Minimizing app script impact, lazy loading offscreen images, optimizing Shopify image filters (\`image_url\`, \`srcset\`), and inlining critical styles.
- **Technical SEO:** Clean heading hierarchies, structured microdata / Schema.org product data, automated alt tags, canonical tags, and Open Graph sharing cards.
- **Conversion Rate Optimization (CRO):** Streamlined mobile navigation, frictionless add-to-cart flows, sticky CTA bars, trust badges, and fast page response times.

### 4. APIs & Supporting Platforms
- **Storefront & Admin APIs:** REST API, GraphQL Storefront API, and headless integration fundamentals.
- **Supporting E-Commerce Platforms (Factual Scope):** WordPress and WooCommerce development (content-driven storefronts and custom components where noted in source history).

---

## Verified Commercial Shopify Projects

### 1. Glasy.pl
- **Status / Live URL:** Live — https://glasy.pl/
- **Domain:** Modern Eyewear & Optical Storefront
- **Verified Scope & Deliverables:**
  - Built custom homepage elements and brand storytelling sections.
  - Implemented collection / PLP improvements, product card enhancements, and refined filtering.
  - Custom header navigation, sticky header logic, and comprehensive footer blocks.
  - Enhanced Shopify theme functionality and mobile responsiveness.

### 2. Ascent
- **Status / Dev URL:** Development Store — https://ascent-development.myshopify.com/
- **Domain:** Direct-to-Consumer (D2C) Lifestyle Brand
- **Verified Scope & Deliverables:**
  - Developed custom homepage built strictly from provided Figma designs.
  - Created modular, reusable Liquid sections and blocks for full client content customizability.
  - Configured Shopify Admin settings, collection relations, and theme options.

### 3. Warmsome
- **Status / Live URL:** Live — https://warmsome.com/
- **Domain:** Home & Comfort Consumer Products
- **Verified Scope & Deliverables:**
  - Built custom Shopify storefront sections and interactive product showcases.
  - Developed responsive components optimized for mobile conversion.
  - Implemented custom theme styling, typography, and section styling.

### 4. Pixel25
- **Status:** In Development
- **Domain:** Automotive & Garage SaaS / Service Storefront
- **Verified Scope & Deliverables:**
  - Engineered specialized storefront with custom Liquid sections.
  - Implemented application-style frontend components tailored to service and product bookings.
  - Delivered responsive layout components and dynamic form elements.

### 5. Berg's
- **Status / Live URL:** Live — https://bergs.co/
- **Domain:** Fashion & Apparel Brand
- **Verified Scope & Deliverables:**
  - Implemented comprehensive product page (PDP) improvements.
  - Programmed custom product logic and dynamic variant handling.
  - Resolved frontend defects, layout inconsistencies, and performance bottlenecks in the existing Shopify store.

### 6. Diamandia
- **Status / Reference URL:** Development Project — https://diamandia.com/
- **Domain:** Jewelry & Luxury Accessories
- **Verified Scope & Deliverables:**
  - Developed custom homepage sections, brand narrative elements, and social media feed integrations.
  - Delivered theme improvements and visual styling.
  - **CRITICAL CAVEAT:** Project development was stopped by the client before our version was released to production. Must NEVER be represented as the currently deployed live production site.

---

## Tailoring Rules for Shopify Vacancies
- **Headline Priority:** \`Senior Shopify / Front-End Developer | Liquid | JavaScript | E-commerce\`
- **Project Selection:** Highlight 2–4 of the verified Shopify projects (\`Glasy.pl\`, \`Ascent\`, \`Warmsome\`, \`Berg's\`, \`Pixel25\`). Note the Diamandia caveat if referenced.
- **Skill Ordering:** Prioritize Shopify, Liquid, Shopify Themes, Custom Sections & Blocks, JSON Templates, Shopify Admin, Core Web Vitals, and Responsive Design.
`;

// 4. projects.md
const projectsContent = `# Unified Master Project Registry: Verified Commercial Experience

This document acts as the definitive, multi-domain project registry for Career-Ops tailored CV generation. All project claims, URLs, and deliverables are factual and verified against primary sources.

---

## Domain 1: React, Next.js & Modern Web Applications

| Project | Live / Reference URL | Domain | Technology Stack | Key Scope & Deliverables | Primary Context |
|---|---|---|---|---|---|
| **ponadczasowi.pl** | https://ponadczasowi.pl/ | E-Commerce | Next.js, React, TypeScript, Tailwind CSS, REST APIs | Built production Next.js store; checkout, payments, shipping, blog, lazy loading, code splitting, mobile UX. | For Better Future (Sep 2020 – Feb 2026) |
| **copernicspace.com** | https://copernicspace.com/ | Web3 / Marketplace | React, Next.js, TypeScript, REST APIs, Styled Components | Built marketplace from scratch; interactive builder, listings, user profiles, performance optimization. | For Better Future (Sep 2020 – Feb 2026) |
| **hrk.pl** | https://hrk.pl/ | Recruitment Platform | Gatsby.js, React, TypeScript, GraphQL, Headless CMS | Built recruitment platform; SEO architecture overhaul, verified ~50% increase in organic search traffic. | For Better Future (Sep 2020 – Feb 2026) |
| **pmicareers.pl** | https://pmicareers.pl/ | Corporate Careers Portal | React, Next.js, TypeScript, REST APIs | Migrated React SPA to Next.js; improved scalability, load times, full frontend delivery. | For Better Future (Sep 2020 – Feb 2026) |
| **learningspace.app** | https://learningspace.app/ | EdTech Platform | React, Next.js, TypeScript, Component Systems | Built interactive educational platform, scalable UI, progress trackers, interactive lesson UX. | For Better Future (Sep 2020 – Feb 2026) |
| **carneoo.de** | https://carneoo.de/ | Automotive Marketplace | React, Next.js, Component Libraries | Custom component development, feature engineering, bug fixes, UX stability enhancements. | For Better Future (Sep 2020 – Feb 2026) |

---

## Domain 2: Magento 2 & Hyvä Enterprise Storefronts

| Project / Client | Industry / Scope | Technology Stack | Key Scope & Deliverables | Primary Context |
|---|---|---|---|---|
| **HUBER SE** | Industrial / Direct Client | Magento 2, Hyvä Theme, Hyvä CMS, Alpine.js, Tailwind | Lead frontend delivery; direct client liaison, business/SEO requirements translation, CMS structures, PLP/PDP/Cart/Checkout/Account flows, Core Web Vitals, accessibility. | HUBER SE (Jun 2026 – Present) |
| **Lufed IT** | E-Commerce Product Platform | Magento 2, Hyvä Theme, Alpine.js, Tailwind | Senior frontend architect; full PLP/PDP/Cart/Checkout ownership, Enterprise to Hyvä migration, reusable CMS component system. | Lufed IT (Jan 2026 – Jun 2026) |
| **housetipster.com** | Home & Interior Marketplace | Magento 2, XML Layout, PHTML, JS | Full Magento 2 build from scratch; Homepage, PLP, PDP, CMS pages, Account area, custom components. | For Better Future (Sep 2020 – Feb 2026) |
| **edycja.pl** | Publishing E-Commerce | Magento 2, Custom Theme | Store built from scratch; custom theme implementation, advanced UI, checkout flow. | For Better Future (Sep 2020 – Feb 2026) |
| **fmic.pl** | Automotive Tuning Parts | Magento 2, Performance | Business logic enhancements, performance optimizations, catalog filtering. | For Better Future (Sep 2020 – Feb 2026) |
| **dreamroots.pl** | Health & Wellness Store | Magento 2 | Performance optimization, multi-language translations, new catalog pages. | For Better Future (Sep 2020 – Feb 2026) |
| **hbsgroup.net** | B2B E-Commerce | Magento 2 | Version updates, new landing pages, logic fixes. | For Better Future (Sep 2020 – Feb 2026) |
| **paypair.com** | FinTech / Payments | Magento 2 Integration | Bug fixes, new features, user experience improvements. | For Better Future (Sep 2020 – Feb 2026) |
| **British American Tobacco** | Multi-Market (4 Stores) | Magento 2 Enterprise | Product pages, checkout flows, customer account areas, multi-market international delivery. | Cloudflight (Jul 2022 – Oct 2024) |
| **catering24.co.uk** | Commercial Catering Supplies | Magento 2 | Custom storefront with advanced commercial integrations, CMS-driven pages. | Cloudflight (Jul 2022 – Oct 2024) |
| **solar.com.pl** | Fashion & Retail | Magento 2 | Custom storefront with specialized catalog features and custom UI components. | Cloudflight (Jul 2022 – Oct 2024) |
| **3MK Protection (3mk.pl)** | Mobile Accessories | Magento 2 | Built storefront from scratch; Homepage, Category, Cart, custom UI components with UX/conversion focus. | 3MK Protection (Mar 2024 – May 2024) |
| **ORBA** | Cosmetics E-Commerce | Magento 2 | Front-end optimization, performance improvements, user experience enhancements. | ORBA (Jan 2020 – Apr 2020) |

---

## Domain 3: Shopify & Liquid Storefronts

| Project | URL & Status | Domain | Technology Stack | Key Scope & Deliverables | Primary Context |
|---|---|---|---|---|---|
| **Glasy.pl** | Live — https://glasy.pl/ | Eyewear & Optics | Shopify, Liquid, JS, CSS | Custom homepage elements, collection/PLP improvements, custom header & footer, theme customization. | For Better Future (Sep 2020 – Feb 2026) |
| **Ascent** | Dev Store — https://ascent-development.myshopify.com/ | D2C Brand | Shopify, Liquid, JSON Templates | Custom homepage from Figma designs, reusable Liquid sections/blocks, Shopify Admin configuration. | For Better Future (Sep 2020 – Feb 2026) |
| **Warmsome** | Live — https://warmsome.com/ | Home Goods | Shopify, Liquid, Responsive UI | Custom storefront sections, responsive components, theme development. | For Better Future (Sep 2020 – Feb 2026) |
| **Pixel25** | In Development | Automotive SaaS | Shopify, Liquid, Custom Apps | Automotive storefront with custom Liquid sections and application-style UI components. | For Better Future (Sep 2020 – Feb 2026) |
| **Berg's** | Live — https://bergs.co/ | Apparel | Shopify, Liquid | Product page improvements, custom product logic, bug fixes in existing store. | For Better Future (Sep 2020 – Feb 2026) |
| **Diamandia** | Dev Project — https://diamandia.com/ (*See Caveat*) | Jewelry & Luxury | Shopify, Liquid | Homepage sections, social media feed integration, theme styling. **Caveat:** Development was halted before release; not currently deployed version. | For Better Future (Sep 2020 – Feb 2026) |

---

## Project Selection Guidelines for Tailored CVs
1. **Never dump all projects into one CV.** Select approximately 2–4 projects strictly relevant to the target role.
2. **For React / Next.js roles:** Highlight \`ponadczasowi.pl\`, \`copernicspace.com\`, \`hrk.pl\`, \`pmicareers.pl\`.
3. **For Magento / Hyvä roles:** Highlight \`HUBER SE\`, \`housetipster.com\`, \`British American Tobacco\`, \`3mk.pl\`, \`edycja.pl\`.
4. **For Shopify roles:** Highlight \`Glasy.pl\`, \`Ascent\`, \`Warmsome\`, \`Berg's\`, \`Pixel25\`.
5. **For General Frontend / Tech Lead roles:** Combine \`HUBER SE\` (leadership, direct client communication, e-commerce scale) with \`ponadczasowi.pl\` or \`copernicspace.com\` (React/Next.js architecture).
`;

// 5. ai-agentic-development.md
const aiAgenticContent = `# Domain Knowledge: AI-Assisted Engineering & Agentic Workflows

## Candidate Positioning
- **Core Stance:** Practical, high-velocity frontend and systems engineering accelerated by AI tooling and autonomous agent workflows.
- **Ownership Invariant:** Human ownership of architecture, technical decisions, security boundaries, business logic, code quality, and production releases.
- **Strict Role Boundary:** This knowledge represents **developer productivity and engineering workflow acceleration**, NOT Machine Learning engineering, training foundation model weights, or data science.

---

## Tools & Environments
- **Primary AI Coding Tools:** Cursor, Claude (Claude Code, Claude 3.5 Sonnet / 3.7 Sonnet), OpenAI (ChatGPT, Codex), Google (Gemini, Antigravity CLI).
- **Tool Selection Principle:** Choosing the right agent and model based on task scope, repository complexity, reasoning requirements, and context window requirements.

---

## Engineering Workflows & Methodologies

### 1. Specification-Driven Development
- Structuring requirements into clear, unambiguous technical specifications before writing code.
- Defining precise acceptance criteria, edge cases, and verification checklists for agent execution.
- Creating and maintaining agent rules, project instructions (\`AGENTS.md\`, \`.agents/skills\`), and coding standards to enforce consistency.

### 2. Task Decomposition & Implementation Planning
- Breaking complex refactors or multi-file features into incremental, reviewable subtasks.
- Using LLM reasoning for architectural analysis, dependency investigation, and trade-off evaluation before implementation.
- Formulating step-by-step implementation plans to prevent hallucinations and maintain codebase coherence.

### 3. Code Generation, Refactoring & Debugging
- AI-assisted scaffolding of boilerplate, typed interfaces, and complex utility logic.
- Systematic refactoring of legacy components toward modern patterns (e.g. class components to hooks, Pages to App Router, Knockout to Alpine.js).
- Rapid root-cause analysis of runtime bugs, build errors, and dependency mismatches.

### 4. Code Review & Multi-Tier Validation
- Using automated checks and linting pipelines to validate agent modifications.
- Performing human-in-the-loop line-by-line verification of generated diffs prior to committing.
- Running automated test suites (\`npm test\`, \`node test-all.mjs\`, type-checking) as non-negotiable verification gates.

### 5. Guardrails, Security & Data Protection
- Enforcing strict boundaries on tool capabilities and sensitive data handling.
- Preventing secrets, API keys, customer PII, and credentials from entering agent context or prompt history.
- Defining restricted files and directories that agents are prohibited from editing without explicit confirmation.

### 6. Context Engineering & Legacy Code Comprehension
- Providing targeted repository context, schemas, and interface definitions to improve agent accuracy.
- Rapidly understanding unfamiliar or undocumented legacy codebases through AI-assisted dependency tracing and architectural mapping.
- Generating and maintaining living technical documentation and implementation notes.

### 7. Repeatable Agent Pipelines
- Developing multi-step agent workflows for recurring tasks (such as CV tailoring, job evaluation, pipeline scanning, and code formatting) rather than relying on one-off ad-hoc prompts.

---

## Tailoring Application
When applying for roles that emphasize modern developer productivity, AI tool adoption, or AI-integrated web applications (e.g. GitLab Duo, developer tools, AI client interfaces):
- Highlight daily expertise with Cursor, Claude Code, and agentic workflows.
- Emphasize specification-driven development, code quality validation, and security guardrails.
- Reinforce that architecture and production standards remain 100% human-owned.
`;

fs.writeFileSync(path.join(KNOWLEDGE_DIR, 'react-frontend.md'), reactFrontendContent, 'utf8');
fs.writeFileSync(path.join(KNOWLEDGE_DIR, 'magento-hyva.md'), magentoHyvaContent, 'utf8');
fs.writeFileSync(path.join(KNOWLEDGE_DIR, 'shopify.md'), shopifyContent, 'utf8');
fs.writeFileSync(path.join(KNOWLEDGE_DIR, 'projects.md'), projectsContent, 'utf8');
fs.writeFileSync(path.join(KNOWLEDGE_DIR, 'ai-agentic-development.md'), aiAgenticContent, 'utf8');

console.log('Successfully generated all 5 knowledge base files in knowledge/');
