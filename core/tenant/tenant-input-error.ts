export class TenantInputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantInputValidationError";
  }
}
