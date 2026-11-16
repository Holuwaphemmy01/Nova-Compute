/** Error thrown by API clients (real or fake) for failed requests. */
export class ApiError extends Error {
  readonly status: number;
  /** Server error code from { error: { code } } (docs/api.md), or "network" / "http_error". */
  readonly code: string;
  constructor(status: number, message: string, code = "http_error") {
    super(message || `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}
