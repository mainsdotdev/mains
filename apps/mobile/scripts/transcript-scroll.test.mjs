import assert from "node:assert/strict";
import test from "node:test";
import { TranscriptScroll, hasScrollMomentum } from "../src/features/runs/lib/transcript-scroll.ts";
import { historyLoaded, historyRequest, historyState, setHistoryFollowing, forgetHistory } from "../src/backend/run-history.ts";

const geometry = (overrides = {}) => ({ frame: 800, content: 2200, offset: 1434, restOffset: -100, bottomInset: 34, ...overrides });
let serial = 0;
function conversation(hasNewer = false) {
  const runId = `scroll-${serial++}`, backendId = "scroll-test";
  forgetHistory(backendId, runId);
  historyLoaded(backendId, runId, { start: { timestamp: 0, source: "artifact", id: 1 }, end: null,
    last: { timestamp: 1000, source: "artifact", id: 20 }, hasOlder: true, hasNewer });
  const scroll = new TranscriptScroll(), pages = [];
  return {
    scroll, pages,
    state: () => historyState(backendId, runId),
    request: () => historyRequest(backendId, runId, "refresh"),
    apply: (decision) => {
      if (decision.following !== null) setHistoryFollowing(backendId, runId, decision.following);
      if (decision.page) pages.push(decision.page);
    },
  };
}

test("dragging down at the latest message never freezes history or inserts Jump to latest", () => {
  const chat = conversation(), edges = { hasOlder: true, hasNewer: false };
  chat.apply(chat.scroll.beginDrag(geometry()));
  assert.equal(chat.state().end, null, "touching the transcript must not enter historical mode");
  chat.apply(chat.scroll.move(geometry({ offset: 1445 }), edges));
  chat.apply(chat.scroll.settle(geometry(), edges));
  assert.equal(chat.state().end, null);
  assert.equal(chat.scroll.pinned, true);
  assert.equal(chat.scroll.showJump(geometry(), false), false);
  assert.deepEqual(chat.pages, []);
});

test("scrolling toward newer messages near the top never loads older pages", () => {
  const chat = conversation(), edges = { hasOlder: true, hasNewer: false };
  chat.apply(chat.scroll.beginDrag(geometry({ offset: -100, content: 600 })));
  chat.apply(chat.scroll.move(geometry({ offset: -80, content: 600 }), edges));
  assert.deepEqual(chat.pages, []);
  assert.equal(chat.state().end, null);
});

test("programmatic following and animated jump offsets cannot flash a jump button", () => {
  const scroll = new TranscriptScroll();
  const growing = geometry({ content: 2600 });
  assert.equal(scroll.showJump(growing, false), false);
  scroll.pause();
  assert.equal(scroll.showJump(growing, false), true);
  scroll.follow();
  assert.equal(scroll.showJump(growing, true), false);
});

test("pinning uses the same bottom safe area as the jump distance", () => {
  const chat = conversation(), edges = { hasOlder: false, hasNewer: false };
  chat.apply(chat.scroll.beginDrag(geometry()));
  chat.apply(chat.scroll.move(geometry({ offset: 1340 }), edges));
  chat.apply(chat.scroll.settle(geometry({ offset: 1340 }), edges));
  assert.equal(chat.scroll.pinned, false, "94pt from the true end is outside the 80pt follow zone");
  assert.notEqual(chat.state().end, null);
});

test("a small upward drag keeps live history, while a real departure freezes its existing window", () => {
  const chat = conversation(), edges = { hasOlder: true, hasNewer: false };
  chat.apply(chat.scroll.beginDrag(geometry()));
  chat.apply(chat.scroll.move(geometry({ offset: 1400 }), edges));
  assert.equal(chat.state().end, null);
  chat.apply(chat.scroll.move(geometry({ offset: 1200 }), edges));
  const end = chat.state().end;
  assert.notEqual(end, null);
  assert.deepEqual(chat.request().end, end);
  assert.equal(chat.scroll.showJump(geometry({ offset: 1200 }), false), true);
  chat.apply(chat.scroll.move(geometry({ offset: 900 }), edges));
  assert.deepEqual(chat.state().end, end);
});

test("returning down to the loaded tail restores following and removes the frozen end", () => {
  const chat = conversation(), edges = { hasOlder: false, hasNewer: false };
  chat.apply(chat.scroll.beginDrag(geometry()));
  chat.apply(chat.scroll.move(geometry({ offset: 900 }), edges));
  chat.apply(chat.scroll.settle(geometry({ offset: 900 }), edges));
  chat.apply(chat.scroll.beginDrag(geometry({ offset: 900 })));
  chat.apply(chat.scroll.move(geometry({ offset: 1400 }), edges));
  assert.equal(chat.state().end, null);
  assert.equal(chat.scroll.showJump(geometry({ offset: 1400 }), false), false);
  chat.apply(chat.scroll.settle(geometry(), edges));
  assert.equal(chat.scroll.pinned, true);
});

test("momentum pauses native chasing until the fling actually ends without reversing its direction", () => {
  const chat = conversation(), edges = { hasOlder: false, hasNewer: false };
  chat.apply(chat.scroll.beginDrag(geometry()));
  chat.apply(chat.scroll.move(geometry({ offset: 1400 }), edges));
  chat.apply(chat.scroll.settle(geometry({ offset: 900 }), edges, true));
  assert.equal(chat.scroll.dragging, true);
  assert.equal(chat.scroll.pinned, false);
  assert.notEqual(chat.state().end, null);
  chat.apply(chat.scroll.move(geometry({ offset: 1250 }), edges));
  chat.apply(chat.scroll.move(geometry({ offset: 900 }), edges));
  chat.apply(chat.scroll.settle(geometry({ offset: 900 }), edges));
  assert.equal(chat.scroll.dragging, false);
  assert.equal(chat.scroll.pinned, false);
});

test("a downward fling keeps the tail live even when new content grows during the gesture", () => {
  const chat = conversation(), edges = { hasOlder: false, hasNewer: false };
  chat.apply(chat.scroll.beginDrag(geometry()));
  chat.apply(chat.scroll.move(geometry({ offset: 1440, content: 2500 }), edges));
  chat.apply(chat.scroll.settle(geometry({ offset: 1500, content: 2500 }), edges, true));
  assert.equal(chat.state().end, null);
  assert.equal(chat.scroll.pinned, false);
  assert.equal(chat.scroll.showJump(geometry({ offset: 1450, content: 2800 }), false), false);
  chat.apply(chat.scroll.move(geometry({ offset: 1480, content: 2800 }), edges));
  chat.apply(chat.scroll.settle(geometry({ offset: 1500, content: 2800 }), edges));
  assert.equal(chat.scroll.pinned, true);
});

test("historical pages load newer only toward their bottom, and older only toward their top", () => {
  const chat = conversation(), edges = { hasOlder: true, hasNewer: true };
  chat.scroll.pause();
  chat.apply(chat.scroll.beginDrag(geometry({ offset: 1400 })));
  chat.apply(chat.scroll.move(geometry({ offset: 1370 }), edges));
  assert.deepEqual(chat.pages, []);
  chat.apply(chat.scroll.move(geometry({ offset: 1400 }), edges));
  assert.deepEqual(chat.pages, ["newer"]);
  chat.pages.length = 0;
  chat.apply(chat.scroll.beginDrag(geometry({ offset: 300 })));
  chat.apply(chat.scroll.move(geometry({ offset: 80 }), edges));
  assert.deepEqual(chat.pages, ["older"]);
  assert.equal(chat.scroll.pinned, false);
});

test("anchor restoration and programmatic scroll-end events do not cause new pagination or freeze following", () => {
  const chat = conversation(), edges = { hasOlder: true, hasNewer: false };
  chat.apply(chat.scroll.beginDrag(geometry({ offset: 300 })));
  chat.apply(chat.scroll.move(geometry({ offset: 100 }), edges));
  chat.pages.length = 0;
  chat.scroll.rebase(80);
  chat.apply(chat.scroll.move(geometry({ offset: 80 }), edges));
  chat.apply(chat.scroll.settle(geometry({ offset: 80 }), edges));
  assert.deepEqual(chat.pages, []);
  chat.scroll.follow();
  chat.apply(chat.scroll.settle(geometry({ offset: 80 }), edges));
  assert.equal(chat.scroll.pinned, true);
});

test("short pages use their load controls instead of paging on rubber-band bounces", () => {
  const chat = conversation(), edges = { hasOlder: true, hasNewer: true };
  const short = geometry({ content: 300, offset: -100 });
  chat.scroll.pause();
  chat.apply(chat.scroll.beginDrag(short));
  chat.apply(chat.scroll.move({ ...short, offset: -60 }, edges));
  chat.apply(chat.scroll.move({ ...short, offset: -100 }, edges));
  chat.apply(chat.scroll.settle(short, edges));
  assert.deepEqual(chat.pages, []);
  assert.equal(chat.scroll.showJump(short, true), true);
});

test("an iOS landing at the current offset cannot leave the view waiting for nonexistent momentum", () => {
  const chat = conversation(), edges = { hasOlder: false, hasNewer: false };
  chat.apply(chat.scroll.beginDrag(geometry()));
  chat.apply(chat.scroll.settle(geometry(), edges, hasScrollMomentum(1434, 1434, 0.3)));
  assert.equal(chat.scroll.dragging, false);
  assert.equal(chat.scroll.pinned, true);
  assert.equal(hasScrollMomentum(1434, 900, -0.3), true);
  assert.equal(hasScrollMomentum(1434, undefined, -0.3), true);
  assert.equal(hasScrollMomentum(1434, undefined, 0), false);
});

test("jumping within a frozen latest window resumes immediately without a history fetch or size change", () => {
  const chat = conversation(), edges = { hasOlder: true, hasNewer: false };
  chat.apply(chat.scroll.beginDrag(geometry()));
  chat.apply(chat.scroll.move(geometry({ offset: 900 }), edges));
  chat.apply(chat.scroll.settle(geometry({ offset: 900 }), edges));
  assert.notEqual(chat.state().end, null);
  chat.apply(chat.scroll.jump(edges));
  assert.equal(chat.state().end, null);
  assert.equal(chat.scroll.pinned, true);
  assert.deepEqual(chat.pages, []);
});

test("jumping from an older window requests latest rather than pinning to its local bottom", () => {
  const chat = conversation(true), edges = { hasOlder: true, hasNewer: true };
  chat.scroll.pause();
  chat.apply(chat.scroll.jump(edges));
  assert.deepEqual(chat.pages, ["latest"]);
  assert.equal(chat.scroll.showJump(geometry({ offset: 900 }), true), false);
});
