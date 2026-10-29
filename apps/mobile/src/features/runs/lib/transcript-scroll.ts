export interface TranscriptGeometry {
  frame: number;
  content: number;
  offset: number | null;
  restOffset: number;
  bottomInset: number;
}

export interface HistoryEdges {
  hasOlder: boolean;
  hasNewer: boolean;
}

export interface ScrollDecision {
  following: boolean | null;
  page: "older" | "newer" | "latest" | null;
}

export const PIN_DISTANCE = 80;
export const JUMP_DISTANCE = 220;

/** The same inset-aware end is used for pinning, jump visibility and paging. */
export function transcriptEnd(geometry: TranscriptGeometry): number {
  return Math.max(geometry.restOffset, geometry.content - geometry.frame + geometry.bottomInset);
}

/** iOS supplies the actual landing offset; velocity is only the Android fallback. */
export function hasScrollMomentum(offset: number, target?: number, velocity = 0): boolean {
  return target !== undefined ? Math.abs(target - offset) > 1 : Math.abs(velocity) > 0.01;
}

/** Scroll intent is separate from the history window and native view layout. */
export class TranscriptScroll {
  pinned = true;
  dragging = false;
  private following = true;
  private previousOffset: number | null = null;
  private direction = 0;

  follow() { this.following = this.pinned = true; this.dragging = false; this.direction = 0; }
  pause() { this.following = this.pinned = false; }

  jump(edges: HistoryEdges): ScrollDecision {
    this.follow();
    return { following: true, page: edges.hasNewer ? "latest" : null };
  }

  beginDrag(geometry: TranscriptGeometry): ScrollDecision {
    this.pinned = false;
    this.dragging = true;
    this.rebase(geometry.offset);
    // A touch pauses native chasing, but only moving away freezes history.
    return { following: null, page: null };
  }

  /** Anchor corrections are layout changes, never a new user scroll direction. */
  rebase(offset: number | null) {
    this.previousOffset = offset;
    this.direction = 0;
  }

  move(geometry: TranscriptGeometry, edges: HistoryEdges): ScrollDecision {
    if (!this.dragging) return { following: null, page: null };
    const direction = this.movement(geometry.offset);
    this.previousOffset = geometry.offset;
    if (direction === 0) return { following: null, page: null };
    this.direction = direction;
    const following = this.updateFollowing(geometry, edges);
    return { following, page: this.page(geometry, edges) };
  }

  settle(geometry: TranscriptGeometry, edges: HistoryEdges, momentum = false): ScrollDecision {
    if (!this.dragging) return { following: null, page: null };
    const direction = this.movement(geometry.offset);
    if (direction !== 0) this.direction = direction;
    const following = this.updateFollowing(geometry, edges);
    this.dragging = momentum;
    this.pinned = !momentum && this.following && !edges.hasNewer;
    return { following, page: this.page(geometry, edges) };
  }

  showJump(geometry: TranscriptGeometry, hasNewer: boolean): boolean {
    return !this.pinned && !this.following && this.valid(geometry) &&
      (hasNewer || transcriptEnd(geometry) - geometry.offset! > JUMP_DISTANCE);
  }

  private valid(geometry: TranscriptGeometry) {
    return geometry.offset !== null && geometry.frame > 0 && geometry.content > 0;
  }

  private movement(offset: number | null): number {
    if (offset === null || this.previousOffset === null || Math.abs(offset - this.previousOffset) < 1) return 0;
    return Math.sign(offset - this.previousOffset);
  }

  private updateFollowing(geometry: TranscriptGeometry, edges: HistoryEdges): boolean | null {
    const previous = this.following;
    if (edges.hasNewer) this.following = false;
    else if (this.valid(geometry)) {
      const distance = transcriptEnd(geometry) - geometry.offset!;
      if (distance <= PIN_DISTANCE) this.following = true;
      else if (this.direction < 0) this.following = false;
    }
    return previous === this.following ? null : this.following;
  }

  private page(geometry: TranscriptGeometry, edges: HistoryEdges): "older" | "newer" | null {
    // If the page fits, both boundaries coincide. Its explicit load controls
    // handle navigation; a rubber-band bounce must not replace the page.
    if (!this.valid(geometry) || transcriptEnd(geometry) <= geometry.restOffset) return null;
    const y = geometry.offset!;
    if (this.direction < 0 && y < geometry.restOffset + 200 && edges.hasOlder) return "older";
    if (this.direction > 0 && transcriptEnd(geometry) - y < 100 && edges.hasNewer) return "newer";
    return null;
  }
}
