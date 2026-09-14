import { DEFAULT_ICON_COLOR, parseIcon } from "@/lib/icon-registry";

export type IconPickerMode = "emoji" | "icon";

export interface FormState {
  defaultBranch: string;
  setupScript: string;
  runScript: string;
  archiveScript: string;
  commitInstructions: string;
  prInstructions: string;
  icon: string;
  iconMode: IconPickerMode;
  iconColor: string;
  isIconPickerOpen: boolean;
  isDirty: boolean;
  liveBranches: string[];
  prevProject: any;
}

export type FormAction =
  | { type: "SYNC_PROJECT"; project: any }
  | { type: "SET_FIELD"; field: "defaultBranch" | "setupScript" | "runScript" | "archiveScript" | "commitInstructions" | "prInstructions"; value: string }
  | { type: "SET_ICON"; icon: string; iconMode: IconPickerMode }
  | { type: "SET_ICON_COLOR"; iconColor: string }
  | { type: "SET_ICON_PICKER_OPEN"; isOpen: boolean }
  | { type: "SET_ICON_MODE"; iconMode: IconPickerMode }
  | { type: "SET_BRANCHES"; branches: string[] }
  | { type: "MARK_CLEAN" };

interface ParsedProjectIcon {
  icon: string;
  iconMode: IconPickerMode;
  iconColor: string;
}

/**
 * Splits the stored value into the picker's three fields. The name may carry a
 * `|<color>` suffix (see `formatIcon`), which never applies to emoji.
 */
function parseProjectIcon(iconStr: string | null | undefined): ParsedProjectIcon {
  if (!iconStr) return { icon: "", iconMode: "emoji", iconColor: DEFAULT_ICON_COLOR };

  if (iconStr.startsWith("icon:")) {
    const [name, color] = iconStr.slice("icon:".length).split("|");
    return {
      icon: name.trim().toLowerCase(),
      iconMode: "icon",
      iconColor: color?.trim().toLowerCase() || DEFAULT_ICON_COLOR,
    };
  }

  if (iconStr.startsWith("emoji:")) {
    return {
      icon: iconStr.slice("emoji:".length),
      iconMode: "emoji",
      iconColor: DEFAULT_ICON_COLOR,
    };
  }

  const parsed = parseIcon(iconStr);
  if (parsed.type === "icon") {
    return {
      icon: iconStr.split("|")[0].trim().toLowerCase(),
      iconMode: "icon",
      iconColor: parsed.color ?? DEFAULT_ICON_COLOR,
    };
  }

  return {
    icon: typeof parsed.value === "string" ? parsed.value : "",
    iconMode: "emoji",
    iconColor: DEFAULT_ICON_COLOR,
  };
}

export const initialFormState: FormState = {
  defaultBranch: "",
  setupScript: "",
  runScript: "",
  archiveScript: "",
  commitInstructions: "",
  prInstructions: "",
  icon: "",
  iconMode: "emoji",
  iconColor: DEFAULT_ICON_COLOR,
  isIconPickerOpen: false,
  isDirty: false,
  liveBranches: [],
  prevProject: undefined,
};

export function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case "SYNC_PROJECT": {
      const { icon, iconMode, iconColor } = parseProjectIcon(action.project?.icon);
      // A re-sync of the same project is just the refetch that follows a save —
      // it must not slam the icon picker shut mid-selection. Only switching to a
      // different project closes it.
      const isSameProject =
        !!action.project?.id && action.project.id === state.prevProject?.id;
      return {
        ...state,
        prevProject: action.project,
        defaultBranch: action.project?.defaultBranch ?? "",
        setupScript: action.project?.setupScript ?? "",
        runScript: action.project?.runScript ?? "",
        archiveScript: action.project?.archiveScript ?? "",
        commitInstructions: action.project?.commitInstructions ?? "",
        prInstructions: action.project?.prInstructions ?? "",
        icon,
        iconMode,
        iconColor,
        isIconPickerOpen: isSameProject ? state.isIconPickerOpen : false,
        isDirty: false,
      };
    }
    case "SET_FIELD":
      return { ...state, [action.field]: action.value, isDirty: true };
    case "SET_ICON":
      return { ...state, icon: action.icon, iconMode: action.iconMode, isIconPickerOpen: false, isDirty: true };
    case "SET_ICON_COLOR":
      // Picker stays open — color and icon are picked together.
      return { ...state, iconColor: action.iconColor, isDirty: true };
    case "SET_ICON_PICKER_OPEN":
      return { ...state, isIconPickerOpen: action.isOpen };
    case "SET_ICON_MODE":
      return { ...state, iconMode: action.iconMode };
    case "SET_BRANCHES":
      return { ...state, liveBranches: action.branches };
    case "MARK_CLEAN":
      return { ...state, isDirty: false };
  }
}
