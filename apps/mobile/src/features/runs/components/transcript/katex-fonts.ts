/* eslint-disable @typescript-eslint/no-require-imports -- Expo DOM assets require static require() calls. */

/*
 * Expo DOM stylesheets cannot yet follow local `url(...)` font references.
 * Static requires put KaTeX's WOFF2 files in the DOM asset graph; the inline
 * font faces below then point at the URLs Metro minted for that graph.
 */
// Relative paths sidestep KaTeX's wildcard package export, which Metro treats
// as missing even though these files ship in the package.
const amsRegular = require("../../../../../node_modules/katex/dist/fonts/KaTeX_AMS-Regular.woff2") as string;
const caligraphicBold = require("../../../../../node_modules/katex/dist/fonts/KaTeX_Caligraphic-Bold.woff2") as string;
const caligraphicRegular = require("../../../../../node_modules/katex/dist/fonts/KaTeX_Caligraphic-Regular.woff2") as string;
const frakturBold = require("../../../../../node_modules/katex/dist/fonts/KaTeX_Fraktur-Bold.woff2") as string;
const frakturRegular = require("../../../../../node_modules/katex/dist/fonts/KaTeX_Fraktur-Regular.woff2") as string;
const mainBold = require("../../../../../node_modules/katex/dist/fonts/KaTeX_Main-Bold.woff2") as string;
const mainBoldItalic = require("../../../../../node_modules/katex/dist/fonts/KaTeX_Main-BoldItalic.woff2") as string;
const mainItalic = require("../../../../../node_modules/katex/dist/fonts/KaTeX_Main-Italic.woff2") as string;
const mainRegular = require("../../../../../node_modules/katex/dist/fonts/KaTeX_Main-Regular.woff2") as string;
const mathBoldItalic = require("../../../../../node_modules/katex/dist/fonts/KaTeX_Math-BoldItalic.woff2") as string;
const mathItalic = require("../../../../../node_modules/katex/dist/fonts/KaTeX_Math-Italic.woff2") as string;
const sansSerifBold = require("../../../../../node_modules/katex/dist/fonts/KaTeX_SansSerif-Bold.woff2") as string;
const sansSerifItalic = require("../../../../../node_modules/katex/dist/fonts/KaTeX_SansSerif-Italic.woff2") as string;
const sansSerifRegular = require("../../../../../node_modules/katex/dist/fonts/KaTeX_SansSerif-Regular.woff2") as string;
const scriptRegular = require("../../../../../node_modules/katex/dist/fonts/KaTeX_Script-Regular.woff2") as string;
const size1Regular = require("../../../../../node_modules/katex/dist/fonts/KaTeX_Size1-Regular.woff2") as string;
const size2Regular = require("../../../../../node_modules/katex/dist/fonts/KaTeX_Size2-Regular.woff2") as string;
const size3Regular = require("../../../../../node_modules/katex/dist/fonts/KaTeX_Size3-Regular.woff2") as string;
const size4Regular = require("../../../../../node_modules/katex/dist/fonts/KaTeX_Size4-Regular.woff2") as string;
const typewriterRegular = require("../../../../../node_modules/katex/dist/fonts/KaTeX_Typewriter-Regular.woff2") as string;

function face(
  family: string,
  source: string,
  weight = 400,
  style = "normal",
): string {
  return `@font-face{font-display:block;font-family:${family};font-style:${style};font-weight:${weight};src:url("${source}") format("woff2")}`;
}

export const katexFontFaces = [
  face("KaTeX_AMS", amsRegular),
  face("KaTeX_Caligraphic", caligraphicBold, 700),
  face("KaTeX_Caligraphic", caligraphicRegular),
  face("KaTeX_Fraktur", frakturBold, 700),
  face("KaTeX_Fraktur", frakturRegular),
  face("KaTeX_Main", mainBold, 700),
  face("KaTeX_Main", mainBoldItalic, 700, "italic"),
  face("KaTeX_Main", mainItalic, 400, "italic"),
  face("KaTeX_Main", mainRegular),
  face("KaTeX_Math", mathBoldItalic, 700, "italic"),
  face("KaTeX_Math", mathItalic, 400, "italic"),
  face("KaTeX_SansSerif", sansSerifBold, 700),
  face("KaTeX_SansSerif", sansSerifItalic, 400, "italic"),
  face("KaTeX_SansSerif", sansSerifRegular),
  face("KaTeX_Script", scriptRegular),
  face("KaTeX_Size1", size1Regular),
  face("KaTeX_Size2", size2Regular),
  face("KaTeX_Size3", size3Regular),
  face("KaTeX_Size4", size4Regular),
  face("KaTeX_Typewriter", typewriterRegular),
].join("\n");
