import type { FrontendImportBatch } from '@/lib/services/importBatches';

export class ServiceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServiceValidationError';
  }
}

/**
 * A commit was rejected because an active batch on the same account already used
 * this filename. Carries the conflicting batch so the route can name it in the 409
 * body and the client can offer an explicit override.
 */
export class DuplicateFilenameError extends Error {
  constructor(
    message: string,
    public readonly batch: FrontendImportBatch,
  ) {
    super(message);
    this.name = 'DuplicateFilenameError';
  }
}

/** Undo was requested for a batch that is already undone — a 409, not a crash. */
export class BatchAlreadyUndoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BatchAlreadyUndoneError';
  }
}
