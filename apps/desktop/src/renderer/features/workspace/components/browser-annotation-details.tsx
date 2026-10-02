import type { BrowserAnnotation } from "@mains/contracts/browser-annotations";

export function BrowserAnnotationElements({ elements }: Pick<BrowserAnnotation, "elements">) {
  return (
    <ol className="space-y-1.5">
      {elements.map((element, index) => (
        <li key={`${element.selector}-${index}`} className="flex min-w-0 items-center gap-2 text-xs text-primary-600 dark:text-primary-400" title={element.selector}>
          <span className="shrink-0 rounded-lg border border-primary-200 px-1.5 py-0.5 text-[10px] dark:border-primary-700/40">
            {element.tagName}
          </span>
          <span className="min-w-0 truncate">{element.componentName || element.text || element.selector}</span>
        </li>
      ))}
    </ol>
  );
}

export function BrowserAnnotationComment({ comment }: Pick<BrowserAnnotation, "comment">) {
  return (
    <p className="mt-3 whitespace-pre-wrap wrap-break-word text-s text-primary-900 dark:text-primary-100">
      {comment || <span className="text-xs text-primary-500">No comment</span>}
    </p>
  );
}
