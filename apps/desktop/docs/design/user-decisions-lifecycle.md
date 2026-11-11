# User approvals, async questions and plan decisions

Inventory families **7, 8, 9** preserve three different authorities: a live
provider permission, an accepted question-answer input, and a durable plan
status. Native acceptance is distinct from UI dismissal and status persistence.

| Owner | Rules and transitions | Implementation |
| --- | --- | --- |
| Native approval | Absent → pending → answered/canceled/expired. Identical pending requests join; a conflicting request cannot replace its waiter. Each admission gets an opaque token. Deadline checks occur at response time as well as through timers. A notification belongs to its original lease, including delayed creation and disposal. Cleanup/publication failures cannot prevent settlement. | `runs/user-input-lifecycle.ts`, thin input broker |
| Approval reply | A matching token settles once. The same completed decision can acknowledge a lost reply; conflicting or retired decisions fail. Completed receipts retain hashes, not form answers. Cancellation of an elicitation is distinct from decline. Native menu actions, notifications, desktop and phone carry the same incarnation. | Input lifecycle, notification/menu adapters, shared runs DTOs |
| Question disposition | Dismissal stays in artifact metadata and sends no native input. A new explicit answer can reopen a dismissed question. Ordinary accepted parent input supersedes older unanswered questions; correlated answers and subagent input do not. Dismissal and Stop retire already preparing decisions. | `run-async-questions.ts`, `async-answer-lifecycle.ts`, input-artifact seam |
| Question delivery | Checking → preparing → invoked → accepted or uncertain. A check does not consume another client's Send. Acceptance uses the stable question message id and existing input receipts. Unknown delivery freezes the original answers and permits receipt checks, never blind resend. An accepted input remains authoritative after cancellation; its late receipt can still settle the question. | Async answer lifecycle and native input preflight |
| Plan decision | Pending → native acceptance → applied/dismissed. One owner joins equal decisions and rejects competing choices. Follow-ups use a stable message id and persisted/native receipt checks. Stop is rechecked after continuation preparation and immediately before native session creation. A newer/failed/child plan, foreign account or archived/replica conversation refuses mutation. A live permission requires its correlated pending token; an ended live permission never becomes a new continuation. | `plan-decision-lifecycle.ts`, `runs:decidePlan` |
| Plan checkpoint | Native refusal leaves the plan pending. Once accepted, a failed marker retains its checkpoint: retry finishes persistence without another execution. Delivery uncertainty only checks receipts. Generic tool metadata/output edits cannot write `planStatus`; internal provider repository writes remain separate. | Plan decision lifecycle, shared `plan-decision` contract |
| Decision view | One synchronous admission before React renders busy. Backend/conversation/request replacement and disposal retire old tails. Stale acknowledgements/resolved pushes cannot remove a replacement approval. Failures preserve entered values and expose retry. Successful plan status appears only after the backend confirms; the plan action preserves unrelated composer drafts. | Shared `decision-owner`, tool approval hook/dialog, question provider, plan display |
| Phone projection | Cache the approval token alongside the request, never the user's form answers. Migration 22 retains older cached requests. Replies and deletions target their original backend/token. Backend switches retire consent/settings preparation permanently, including A → B → A; recovery of the same backend retains the editing view. | Mobile session, approval projection and cards |
| Backend generation | Close approval admission and cancel live waiters → fence new question/plan operations → drain admitted decisions while SQLite remains owned → close database. Registration reopens fresh owners after cleanup. Both backend hosts share this barrier. | User decision runtime and composition roots |

`@mains/contracts/plan-decision`, `runs` and `decision-owner` hold shared wire
shapes, status vocabulary, reserved metadata rules and view admission. Provider
response formats and MCP form validation remain with their existing adapters.
Questions never become synthetic native approvals.

Approval tokens are additive. Legacy tokenless replies work for an id's first
incarnation in a backend generation; reused ids require the token. The phone's
new nullable cache column supports older server projections.

Native approval receipts are ephemeral. This does not claim a transaction across
a permission response and SQLite, or exactly-once delivery across process
crashes. Follow-up plan inputs recover through their stable input receipts;
retired live permissions require a fresh explicit decision. No draft form values
are made durable. UI retirement cannot undo an already accepted provider action.

Regression tests use disposable SQLite databases, deferred acceptance/settings
barriers, multiple client decisions, fake deadlines, notification failures and
real renderer hooks/dialogs. They cover duplicate admission, retired tokens,
Stop/dismiss during preparation, accepted-but-unmarked recovery, competing plan
decisions, invalid plan targets, immutable uncertainty, late acknowledgements,
retry with preserved input and the mobile cache migration. No live provider or
user profile is used.
