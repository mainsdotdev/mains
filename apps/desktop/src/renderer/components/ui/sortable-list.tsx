import {
  createContext,
  useContext,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DraggableSyntheticListeners,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";

export type SortableDirection = "up" | "down";

/**
 * What an item hands the element that moves it, usually its header row:
 * pointer drag through `ref` + `listeners`, and Alt+Arrow through `onKeyDown`.
 * `listeners` and `onKeyDown` are absent while the list is disabled, so a
 * consumer can read them as "sortable right now".
 */
export interface SortableHandle {
  ref: (element: HTMLElement | null) => void;
  listeners: DraggableSyntheticListeners;
  /**
   * Handles Alt+ArrowUp / Alt+ArrowDown and calls `preventDefault` when it
   * does. Call it first from the element's own key handler and stop there if
   * `event.defaultPrevented`.
   */
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
}

/** `ids` with `activeId` moved into `overId`'s slot, or null when nothing moves. */
export function reorderIds(
  ids: readonly string[],
  activeId: string,
  overId: string,
): string[] | null {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return null;
  return arrayMove([...ids], from, to);
}

/** `ids` with `id` one slot up or down, or null at either end of the list. */
export function moveIdByStep(
  ids: readonly string[],
  id: string,
  direction: SortableDirection,
): string[] | null {
  const from = ids.indexOf(id);
  const to = direction === "up" ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= ids.length) return null;
  return arrayMove([...ids], from, to);
}

/** Items slide up and down inside the list's own box, never out of it. */
const MODIFIERS = [restrictToVerticalAxis, restrictToParentElement];

/** Null while the list is disabled, so items hand out no keyboard path. */
const MoveContext = createContext<
  ((id: string, direction: SortableDirection) => void) | null
>(null);

/**
 * A vertical list the user reorders by dragging or with Alt+Arrow. It only
 * reports the new order; saving it (and showing it before the save lands) is
 * the caller's job. Children are `SortableItem`s, one per id, in `ids` order.
 */
export function SortableList({
  ids,
  onReorder,
  disabled = false,
  className,
  children,
}: {
  ids: readonly string[];
  onReorder: (orderedIds: string[]) => void;
  disabled?: boolean;
  /** Classes for the list's box, which is also where dragging is confined. */
  className?: string;
  children: ReactNode;
}) {
  // A few pixels of travel before a press turns into a drag, so a plain click
  // on the handle keeps doing whatever it does. Pointer only: the keyboard
  // path is Alt+Arrow, since Space and Enter usually already mean something
  // on the handle.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const next = reorderIds(ids, String(active.id), String(over.id));
    if (next) onReorder(next);
  };

  const move = (id: string, direction: SortableDirection) => {
    const next = moveIdByStep(ids, id, direction);
    if (next) onReorder(next);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={MODIFIERS}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={ids as string[]}
        strategy={verticalListSortingStrategy}
        disabled={disabled}
      >
        <MoveContext.Provider value={disabled ? null : move}>
          <div className={className}>{children}</div>
        </MoveContext.Provider>
      </SortableContext>
    </DndContext>
  );
}

/**
 * One row of a `SortableList`. The whole row moves, but only the element that
 * takes the handle picks it up, so a drag never starts from the row's content.
 */
export function SortableItem({
  id,
  children,
}: {
  id: string;
  children: (handle: SortableHandle) => ReactNode;
}) {
  const move = useContext(MoveContext);
  const {
    setNodeRef,
    setActivatorNodeRef,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const onKeyDown = move
    ? (event: KeyboardEvent<HTMLElement>) => {
        if (
          !event.altKey ||
          (event.key !== "ArrowUp" && event.key !== "ArrowDown")
        ) {
          return;
        }
        event.preventDefault();
        move(id, event.key === "ArrowUp" ? "up" : "down");
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      // Translate, not Transform: rows can differ in height, and Transform's
      // scale would stretch a row to the size of whichever slot it passes over.
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`relative ${isDragging ? "z-10 opacity-80" : ""}`}
    >
      {children({ ref: setActivatorNodeRef, listeners, onKeyDown })}
    </div>
  );
}
