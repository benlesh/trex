/**
 * Copyright 2020 Ben Lesh <ben@benlesh.com>
 * MIT License
 */

export function chainAbort(
  parentSignal: AbortSignal,
  childController: AbortController
) {
  const handler = () => childController.abort();
  childController.signal.addEventListener("abort", () => {
    parentSignal.removeEventListener("abort", handler);
  });
  parentSignal.addEventListener("abort", handler);
}
