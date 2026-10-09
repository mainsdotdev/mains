export async function pageFileData(file: File): Promise<string> {
  if (file.size > 20 * 1024 * 1024) throw new Error("Page files must be 20 MB or smaller");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("Could not read this file"));
    reader.readAsDataURL(file);
  });
}
