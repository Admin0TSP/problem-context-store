/**
 * Typed errors for the domain layer.
 *
 * Throw these in business logic; the API layer translates them into HTTP
 * responses. Keeps error handling explicit instead of relying on string matching.
 */

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class NotFoundError extends DomainError {
  constructor(resource: string, id?: string) {
    super('not_found', id ? `${resource} not found: ${id}` : `${resource} not found`);
    this.name = 'NotFoundError';
  }
}

export class PermissionError extends DomainError {
  constructor(action: string) {
    super('permission_denied', `Not allowed to ${action}`);
    this.name = 'PermissionError';
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super('conflict', message);
    this.name = 'ConflictError';
  }
}

export class ValidationError extends DomainError {
  constructor(
    message: string,
    public readonly fieldErrors?: Record<string, string>,
  ) {
    super('validation_failed', message);
    this.name = 'ValidationError';
  }
}
