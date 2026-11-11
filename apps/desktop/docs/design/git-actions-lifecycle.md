# Git actions and PR attachments

Inventory families: **32, 33, 92**. The panel, the native pipeline and temporary
files have separate owners. Closing a panel retires its feedback and staging;
an already accepted native operation finishes under the backend's ownership.

| Owner | Transitions and rules | Implementation |
| --- | --- | --- |
| Panel view | Idle → one action → success / retryable failure. Admission is synchronous. Equal failed drafts reuse an operation ID; changed input starts a new operation. Each attempt alone may finish its pending state. Workspace, account, backend, transport changes and unmount retire the view. | `git-actions-lifecycle.ts`, `use-git-actions-panel.ts` |
| Backend command | Admit workspace → bind canonical checkout and filesystem identity → execute checkpointed steps → release active ownership. Equal in-flight IDs join; changed payloads and competing commands reject before staging. Branch changes and discard share this gate. Archive/delete and backend shutdown wait for accepted commands. | `runtime/git-operation-lifecycle.ts`, `gitFlow.service.ts`, workspace service |
| Commit | Capture branch / HEAD → stage / generate → commit → optional push. Once the native commit returns, projection failures cannot revoke it. Failed push resumes from the accepted commit without staging subsequent edits. An unacknowledged commit whose HEAD moved requires inspection. | `gitFlowService.commit`, `performCommit` |
| Publish | Preflight → create repository → attach remote → push → update project. Successful steps are retained. Retry checks the checkout, HEAD, branch and remote before resuming a pending push. Existing foreign remotes are never overwritten. | `gitFlowService.publish` |
| PR | Capture target → push → create / reconcile → acknowledge URL. Retry validates branch, HEAD and remotes; a failed create is reconciled through a read-only list before another create. A URL returned alongside a CLI error is an accepted PR with a warning. | `gitFlowService.createPr`, `performCreatePR` |
| Attachment file | Receiving → writing → receiving → claimed → retained for retry / cleaning → removed. Only ordered chunks enter a receiving file. TTL and discard cannot delete writing or claimed files. A failed removal remains tracked and cannot be claimed again. Old releases cannot affect a replacement claim. | `pr-attachment-storage.ts` |
| Staging view | Stage chunks on captured transport → retain complete IDs on failed logical create → reuse on equal retry. Abort or any transport swap permanently retires the owner, including A → B → A. Partial uploads are discarded. | `pr-attachment-upload.ts` |
| Backend generation | Fence new Git actions → drain accepted commands → fence and drain file writes / claims → purge temporary files. Failed purges keep their paths for a later close. A new backend generation starts with fresh command and file owners. | `gitFlow.lifecycle.ts`, desktop and standalone hosts |

Paths above refer to the owning backend module/runtime or renderer git-actions
folder. Both media and private PR body files are owned by the temporary-file
store. Cleanup failure never revokes a proven Git commit or PR creation.

Operation checkpoints are **in memory for one backend generation**, limited to
500 retained logical requests. They are not crash recovery or an exactly-once
GitHub transaction. Older clients without `operationId` receive the concurrency
gate but no retry journal. Unknown repository-creation results, out-of-process
Git edits and a restart can require manual inspection. PR reconciliation checks
open PRs and cannot prove absence of a remotely created then closed PR.

The regression suite uses disposable real Git repositories, isolated SQLite,
controlled filesystem failures and a fake `gh` executable boundary. It exercises
no live GitHub account and changes no user Git settings.
