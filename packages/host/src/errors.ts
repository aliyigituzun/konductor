/** Error shape every host route reports; the API layer and CLI read `code` and `hint`. */
export class HostApiError extends Error {
  status: number;
  code: string;
  hint: string | null;
  details: string[];
  run_id: string | null;

  constructor(
    message: string,
    options: {
      status?: number;
      code?: string;
      hint?: string | null;
      details?: string[];
      run_id?: string | null;
    } = {},
  ) {
    super(message);
    this.name = "HostApiError";
    this.status = options.status ?? 400;
    this.code = options.code ?? "HOST_ERROR";
    this.hint = options.hint ?? null;
    this.details = options.details ?? [];
    this.run_id = options.run_id ?? null;
  }
}
