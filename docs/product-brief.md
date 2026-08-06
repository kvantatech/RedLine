# Product

RedLine is a universal QA agent — two suites, one spine (functional = Playwright,
performance = k6). This document describes the dashboard product as it exists today: an
onboarding wizard for the performance (k6) path. The functional (Playwright) path gets its
own onboarding wizard screens in a later phase; until then, this doc's Users/Purpose below
are performance-specific.

## Register

product

## Users

Any engineering team that installs RedLine and wants k6 performance tests without being a performance-testing expert. RedLine is free, self-hosted tooling — a company downloads it, runs it locally, and creates a team (or many) through the wizard. The audience is technical but not necessarily performance engineers: the team lead or developer who owns a service and wants a red-line on it.

## Product Purpose

The onboarding wizard (`dashboard/`) exists to remove the "I don't know how to write a k6 test" barrier: answer a few plain-language questions (team name, API/journey to test), and the agent creates the test, runs a first benchmark, and sets the red/green baseline live in front of the user. Success = a non-performance-engineer team gets a working, correctly-scoped test without needing performance engineering expertise or a specialist's direct involvement.

## Brand Personality

Fast and minimal — a functional wizard, not a showcase. It's a means to an end (getting a team onboarded quickly), used briefly per team and then not revisited. Polish should never come at the cost of clarity or speed; this is closer to a CLI-with-a-face than a product.

## Anti-references

Avoid over-designing this into something that looks like a heavily-marketed SaaS onboarding flow — it doesn't need marketing polish, animated illustrations, or multi-step visual flourish. That would be effort spent on the wrong thing for a self-hosted tool a team runs once to get set up.

## Design Principles

- Speed and clarity over visual polish — every screen should get the user to the next step immediately
- Trustworthy defaults — since users aren't performance experts, the wizard's choices (thresholds, iteration counts) need to look deliberate and safe, not arbitrary
- Minimal chrome — this is a means to an end, not a destination
- Should scale calmly to mass-onboarding (many teams going through this quickly) — no friction that slows repeat use across teams

## Accessibility & Inclusion

Standard WCAG AA baseline. A self-hosted engineering tool — keep it plain and functional rather than adding accessibility complexity the tool doesn't need.
