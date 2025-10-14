# Project Architecture

This document describes the high-level architecture and coding conventions used in this repository. It clarifies responsibilities for each layer, their allowed dependencies.

## Layers and Responsibilities

- Orchestrators

  - Purpose: Contain high-level, centralized game logic and coordination. They perform periodic loops and orchestrate calls to services and other layers.
  - Rules: Orchestrators are the only place that should contain built-in (centralized) logic coordinating multiple systems. Other files and classes should not import or reference orchestrators.

- Services

  - Purpose: Provide reusable, focused functions that perform single responsibilities (e.g., reading/writing memory, interacting with game objects). Services are the public API for other parts of the codebase.
  - Rules: Services should contain no centralized orchestration logic. They should be pure helpers that can be called by orchestrators, roles, or tests. Services are the canonical place for functions that other classes should rely on.

- Config

  - Purpose: Store constants and configuration values (spawning limits, role definitions, thresholds, etc.).
  - Rules: No logic (no functions or branching) should exist in config files. They should export static data only.

- Roles
  - Purpose: Implement behavior for individual creep roles (e.g., harvester, upgrader). Each role should be a thin wrapper that calls into services to perform work and may be invoked by orchestrators.

## Dependency Rules (directional)

- Orchestrators -> Services
- Orchestrators -> Config
- Orchestrators -> Roles (optionally to instruct/dispatch)
- Roles -> Services
- Roles -> Config
- Services -> Config

Forbidden dependencies:

- Anything (outside of main.ts) -> Orchestrators
- Config -> anything but static data

This keeps orchestration centralized and services reusable.

## Notes

This document defines layer responsibilities and dependency directions so implementers can follow consistent boundaries.
