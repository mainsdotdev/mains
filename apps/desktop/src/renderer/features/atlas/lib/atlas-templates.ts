export const ATLAS_TEMPLATES = [
  {
    title: "Project brief",
    markdown: `## Problem

What problem are we solving, and who experiences it?

## Desired outcome

Describe what should be different when this project is done.

## Scope

### In scope

- What we will deliver

### Out of scope

- What we are intentionally leaving for later

## Success criteria

| Measure | Current state | Target |
| --- | --- | --- |
| | | |

## Plan

| Milestone | Owner | Target date |
| --- | --- | --- |
| Define the approach | | |
| Deliver a first version | | |
| Review the outcome | | |

## Risks and dependencies

What could block progress? What needs to happen first?

## Next steps

- [ ] Confirm the scope and owner
- [ ] Agree on the first milestone`,
  },
  {
    title: "Research notes",
    markdown: `## Research question

What do we need to learn, and which decision will it inform?

## Starting assumptions

- What we believe so far, before reviewing the evidence

## Findings

| Finding | Evidence or source | Confidence |
| --- | --- | --- |
| | | |

## Open questions

- What is still uncertain or contradicted by the evidence?

## Synthesis

What patterns emerged? Separate supported conclusions from assumptions.

## Recommendation

What should we do next, and why?

## Follow-up

- [ ] Check the most important unresolved assumption
- [ ] Share the findings and sources`,
  },
  {
    title: "Decision log",
    markdown: `## Decision to make

State the question in one sentence.

Status: Proposed

Owner:

Date:

## Context

Why does this decision matter now? Include constraints and relevant evidence.

## Options

| Option | Benefits | Trade-offs |
| --- | --- | --- |
| Keep the current approach | | |
| Alternative A | | |
| Alternative B | | |

## Decision and rationale

Record the chosen option and why it best meets the criteria.

## Consequences

What changes as a result? What risks or compromises are we accepting?

## Revisit when

What new evidence or change would make us reconsider?

## Actions

| Action | Owner | Due date |
| --- | --- | --- |
| | | |`,
  },
  {
    title: "Launch checklist",
    markdown: `## Launch overview

What are we releasing, and who is it for?

Owner:

Launch window:

## Ready to launch

- [ ] Agree on the launch scope and success criteria
- [ ] Test the main user journeys
- [ ] Resolve blocking issues and review known limitations
- [ ] Prepare documentation and support guidance
- [ ] Review the announcement and notify stakeholders

## Rollout plan

Describe the release steps, who owns each step, and how we will confirm they worked.

## Recovery plan

What would make us pause or roll back? Who makes that call, and how do we restore the previous state?

## After launch

- [ ] Confirm the release is working for users
- [ ] Monitor errors, feedback and success criteria
- [ ] Assign follow-up fixes
- [ ] Capture lessons for the next launch`,
  },
  {
    title: "Brainstorm",
    markdown: `## Challenge

How might we improve the situation for the people involved?

## Constraints

List the time, budget or other boundaries that ideas must respect.

## Ideas

Capture possibilities before evaluating them.

- A small improvement we could try quickly
- A different approach to the underlying problem
- An ambitious idea worth exploring

## Shortlist

| Idea | Expected impact | Effort | Biggest unknown |
| --- | --- | --- | --- |
| | | | |

## First experiment

Choose one idea. What is the smallest way to test it, and what result would justify continuing?

## Next steps

- [ ] Choose an experiment and owner
- [ ] Set a review date
- [ ] Record what we learn`,
  },
] as const;
