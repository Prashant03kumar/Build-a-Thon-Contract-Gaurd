// Route-identity helpers. Consumers may carry stale path-param names
// (mobile-app says /quotes/{id}; the spec later says /quotes/{quoteId}),
// so the matching key normalizes every param to {param}.

export function normalizePathTemplate(pathTemplate: string): string {
  return pathTemplate
    .trim()
    .replace(/\{[^/{}]+\}/g, "{param}") // {id}, {quoteId}, ... → {param}
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+/, "/")
    .replace(/\/+$/, "");
}

export function normalizeMethod(method: string): string {
  return method.trim().toUpperCase();
}
