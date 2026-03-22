// Shared fetch utility with timeout and abort support

const DEFAULT_TIMEOUT = 60000; // 60 seconds minimum

export function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {},
  externalSignal?: AbortSignal
): Promise<Response> {
  const { timeout = DEFAULT_TIMEOUT, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  // Combine external signal (for unmount) with timeout signal
  if (externalSignal) {
    externalSignal.addEventListener("abort", () => controller.abort());
  }

  return fetch(url, { ...fetchOptions, signal: controller.signal })
    .finally(() => clearTimeout(timeoutId));
}
