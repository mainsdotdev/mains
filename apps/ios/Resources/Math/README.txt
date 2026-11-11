KaTeX 0.18.7, copied from the existing apps/mobile dependency.
MIT license: LICENSE-KaTeX.txt. Fonts and CSS must stay with this version.
No remote scripts, fonts or styles are used by the native math renderer.

iOS packaging: retain all 20 mathematical font faces as WOFF2 only.
The CSS font sources omit redundant WOFF/TTF fallback copies; glyphs and metrics are unchanged.
