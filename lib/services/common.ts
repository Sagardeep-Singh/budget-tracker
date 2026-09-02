export class ServiceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServiceValidationError';
  }
}
