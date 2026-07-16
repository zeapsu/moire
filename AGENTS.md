# OpenAI Build Week Workflow

## Goal

Build and submit the OpenAI Build Week project with Codex and GPT-5.6 while keeping one primary Codex task as the center of implementation and the source of the Devpost `/feedback` session ID.

## Primary Codex Task

- The primary Codex task owns architecture, core implementation, integration, and final verification.
- Resume the primary task instead of starting a new task whenever practical.
- Keep the majority of substantive project work in the primary task.
- Use `/compact` when accumulated context becomes noisy but the task remains coherent.
- If the primary task becomes unreliable, preserve the evidence honestly; do not claim that a replacement task contains work it did not perform.
- Before submission, run `/feedback` in the primary task and use its session ID in the Devpost submission.

## Orchestration and Supporting Work

- Default the primary task to an orchestrator role for non-trivial work.
- Delegate only bounded, independent research, review, testing, or implementation slices.
- Keep architectural decisions, core implementation, integration, and acceptance decisions in the primary task.
- Prefer concise supporting-agent results and committed artifacts over large transcript handoffs.
- Supporting tasks and other harnesses must not substitute their session IDs for the primary Codex `/feedback` session ID.

## Planning and Other Harnesses

- Fable 5, Oh My Pi, and other tools may be used for brainstorming, research, planning, critique, and supporting work.
- A PRD produced with another tool is allowed, but it should be captured in GitHub Epics, Milestones, or Issues rather than added as a repository Markdown file.
- GPT-5.6 use in another harness does not by itself establish that the project was built with Codex.
- The primary Codex task must perform the majority of the core implementation using GPT-5.6.

## Project Record

- Git history and GitHub are the project record.
- Use GitHub Epics for major outcomes, Milestones for delivery phases, Issues for bounded work, and PRs for implementation and review.
- Do not add planning, status, handoff, session-ledger, or redundant documentation Markdown files.
- `AGENTS.md` is the only standing workflow document unless the user explicitly requests another document or the finished project requires user-facing documentation for submission.
- When useful, record the Codex session ID and implemented scope in the related PR description.
- Never invent, transform, or substitute a session ID.

## Completion

- Keep commits scoped to the corresponding Issue or PR.
- Verify each change proportionally to its risk.
- The primary task performs final integration, end-to-end verification, README/submission preparation if required, and `/feedback` capture.
