import { fileIconSvg } from "@mains/icons/file-icons";
import { SvgXml } from "react-native-svg";

import { colors } from "@/theme";
import { SFSymbol } from "./sf-symbol";

/** The desktop's file-type artwork and filename/config matching rules. */
export function FileIcon({ path, size = 20 }: { path: string; size?: number }) {
  const xml = fileIconSvg(path);
  return xml ? (
    <SvgXml xml={xml} width={size} height={size} style={{ flexShrink: 0 }} accessibilityElementsHidden />
  ) : (
    <SFSymbol name="doc" size={size} tint={colors.secondaryLabel} />
  );
}
