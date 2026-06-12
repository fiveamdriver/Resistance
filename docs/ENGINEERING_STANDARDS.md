# Engineering Standards

> The quality bar this project is built and reviewed against. Preserved verbatim
> from the original brief. See the README for how the codebase satisfies each point.

Build this project with senior-engineer-level code quality.

Treat this like production-grade software being reviewed by experienced engineers at a highly respected technology company. A senior engineer at Google, Stripe, SpaceX, or a top-tier infrastructure company should be able to review the codebase and say:

“This is clean, well-structured, maintainable, testable, and thoughtfully engineered.”

Engineering expectations:

1. Architecture

- Use a clear separation of concerns.
- Keep UI, business logic, data access, parsing, and AI-agent logic separated.
- Avoid putting complex logic directly inside React components.
- Organize modules by domain where appropriate.
- Keep file and folder naming consistent and descriptive.
- Prefer small, focused modules over large files.

2. Type safety

- Use TypeScript strictly.
- Avoid `any` unless absolutely necessary.
- Define clear interfaces and domain types.
- Use schema validation where appropriate, preferably with Zod.
- Validate external inputs, uploaded files, API requests, and parser outputs.

3. Code quality

- Write readable, explicit code.
- Avoid clever or overly abstract patterns.
- Keep functions small and purposeful.
- Use meaningful names.
- Add comments only where they explain important reasoning, tradeoffs, or non-obvious logic.
- Do not leave messy TODOs everywhere. Use intentional TODO comments only for planned future phases.

4. Error handling

- Handle file upload errors cleanly.
- Handle parser failures gracefully.
- Return useful error messages without exposing sensitive internals.
- Make failure states visible in the UI.
- Use structured error types where useful.

5. Security basics

- Validate uploaded file types.
- Enforce reasonable file size limits.
- Do not trust filenames from users.
- Sanitize stored filenames.
- Avoid path traversal issues.
- Keep uploads isolated by project.
- Do not store secrets in code.
- Do not use confidential or proprietary data.

6. Data modeling

- Design the Prisma schema carefully.
- Use proper relationships and indexes.
- Keep models extensible for future Altium netlist parsing, BOM parsing, RAG, graph visualization, and AI-agent tools.
- Avoid premature complexity, but do not create a schema that will obviously break in Phase 2.

7. Testing

- Add a basic test setup.
- Include tests for utility functions, file validation, parser interfaces, and core data transformations.
- Use sample/mock files only.
- Make tests easy to run.

8. Developer experience

- Add linting and formatting.
- Provide clear scripts in `package.json`.
- Write a useful README.
- Include environment setup instructions.
- Make local development simple.
- Include example seed/mock data if helpful.

9. UI quality

- Keep the UI simple, professional, and clean.
- Use consistent spacing and layout.
- Show empty states, loading states, and error states.
- Do not over-design the UI.
- Prioritize clarity for engineers using the product.

10. Maintainability

- Optimize for future phases:

  - Altium netlist parser
  - BOM parser
  - PDF parsing and RAG
  - Component/net connectivity graph
  - AI assistant tools
  - Report generation

- Make it easy to replace mock parsers with real parsers later.
- Make it easy to plug in an LLM provider later.
- Make it easy to add graph visualization later.

Before implementing, review the current codebase and identify any structural weaknesses. Then propose a cleaner structure if needed. After that, refactor or build the project to meet the standards above.

Do not rush. Prioritize correctness, clarity, and maintainability over speed or flashy features.
