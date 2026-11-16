/** Error thrown by API clients (real or fake) for non-2xx responses. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message || `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
  }
}
