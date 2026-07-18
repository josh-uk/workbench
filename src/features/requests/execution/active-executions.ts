const registry = new Map<string, AbortController>();

export function registerExecution(id: string, controller: AbortController) {
  registry.set(id, controller);
}

export function unregisterExecution(id: string) {
  registry.delete(id);
}

export function cancelExecution(id: string) {
  const controller = registry.get(id);
  if (!controller) return false;
  controller.abort(new Error("Cancelled by the user."));
  return true;
}
