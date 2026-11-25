import { Fragment } from "react";
import { SideMenuExtension } from "@blocknote/core/extensions";
import {
  DragHandleMenu,
  RemoveBlockItem,
  SideMenu,
  SideMenuController,
  TableColumnHeaderItem,
  TableRowHeaderItem,
  useBlockNoteEditor,
  useComponentsContext,
  useEditorState,
  useExtensionState,
  usePortalElement,
  type FloatingUIOptions,
} from "@blocknote/react";

const textSideMenuPosition: FloatingUIOptions = {
  useFloatingOptions: {
    middleware: [{
      name: "atlasFirstLine",
      fn({ y, rects, elements }) {
        const reference = elements.reference instanceof Element
          ? elements.reference
          : elements.reference.contextElement;
        const text = reference?.querySelector(".bn-block-content :is(.bn-inline-content, pre)");
        if (!reference || !text) return {};

        // Atlas uses its own typography, so the native heading offsets no longer fit.
        const style = getComputedStyle(text);
        const lineHeight = Number.parseFloat(style.lineHeight);
        if (!Number.isFinite(lineHeight)) return {};

        const textTop = text.getBoundingClientRect().top - reference.getBoundingClientRect().top;
        const inset = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.borderTopWidth);
        return { y: y + textTop + inset + (lineHeight - rects.floating.height) / 2 };
      },
    }],
  },
};

function AtlasBlockColorsItem() {
  const editor = useBlockNoteEditor();
  const { Generic: { Menu } } = useComponentsContext()!;
  const portalElement = usePortalElement();
  const { color_picker: picker, drag_handle: labels } = editor.dictionary;
  const blockId = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block.id,
  });
  // The open drag menu pins the target block. Read its colors from the live document.
  const colors = useEditorState({
    editor,
    on: "change",
    selector: ({ editor }) => {
      const props = blockId ? editor.getBlock(blockId)?.props : undefined;
      return {
        textColor: props && "textColor" in props ? props.textColor : undefined,
        backgroundColor: props && "backgroundColor" in props ? props.backgroundColor : undefined,
      };
    },
  });

  if (!blockId || (colors.textColor === undefined && colors.backgroundColor === undefined)) return null;

  return (
    <Menu.Root position="right" sub portalElement={portalElement}>
      <Menu.Trigger sub>
        <Menu.Item className="bn-menu-item" subTrigger>{labels.colors_menuitem}</Menu.Item>
      </Menu.Trigger>
      <Menu.Dropdown sub className="bn-menu-dropdown bn-color-picker-dropdown">
        {(["textColor", "backgroundColor"] as const).map((property) => {
          const selected = colors[property];
          if (selected === undefined) return null;
          const isText = property === "textColor";

          return (
            <Fragment key={property}>
              <Menu.Label>{isText ? picker.text_title : picker.background_title}</Menu.Label>
              {Object.entries(picker.colors).map(([color, label]) => (
                <Menu.Item
                  key={color}
                  data-test={`${isText ? "text" : "background"}-color-${color}`}
                  checked={color === selected}
                  icon={<span
                    aria-hidden="true"
                    className="bn-color-icon pointer-events-none size-[18px] shrink-0 text-[13.5px] leading-[18px]"
                    data-text-color={isText ? color : "default"}
                    data-background-color={isText ? "default" : color}
                  >A</span>}
                  onClick={() => { editor.updateBlock(blockId, { props: { [property]: color } }); }}
                >
                  {label}
                </Menu.Item>
              ))}
            </Fragment>
          );
        })}
      </Menu.Dropdown>
    </Menu.Root>
  );
}

function AtlasPageDragHandleMenu() {
  const { drag_handle: labels } = useBlockNoteEditor().dictionary;
  return (
    <DragHandleMenu>
      <RemoveBlockItem>{labels.delete_menuitem}</RemoveBlockItem>
      <AtlasBlockColorsItem />
      <TableRowHeaderItem>{labels.header_row_menuitem}</TableRowHeaderItem>
      <TableColumnHeaderItem>{labels.header_column_menuitem}</TableColumnHeaderItem>
    </DragHandleMenu>
  );
}

function AtlasPageSideMenuButtons() {
  return <SideMenu dragHandleMenu={AtlasPageDragHandleMenu} />;
}

export function AtlasPageSideMenu() {
  const hasTextContent = useExtensionState(SideMenuExtension, {
    selector: (state) => {
      const content = state?.block.content;
      return Array.isArray(content) || typeof content === "string";
    },
  });
  return (
    <SideMenuController
      sideMenu={AtlasPageSideMenuButtons}
      floatingUIOptions={hasTextContent ? textSideMenuPosition : undefined}
    />
  );
}
