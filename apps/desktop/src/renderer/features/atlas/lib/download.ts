export function downloadAtlasText(fileName: string, text: string, mimeType = "text/markdown") {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = [...fileName].map((char) => char.charCodeAt(0) < 32 || "/\\".includes(char) ? "_" : char).join("");
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
