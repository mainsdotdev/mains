import type { ReviewFile } from "./review-diff";

/** Search all changed paths, but keep a large review's menu DOM bounded. */
export function searchReviewFiles(files: readonly ReviewFile[], query: string) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = terms.length ? files.filter((file) => {
    const path = `${file.path}\n${file.diff?.prevName ?? ""}`.toLocaleLowerCase();
    return terms.every((term) => path.includes(term));
  }) : files;
  return { files: matches.slice(0, 100), total: matches.length };
}
