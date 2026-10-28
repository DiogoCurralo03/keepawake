export function powerError(code, operation, backend = 'native', details = '') {
  const reason = code === 1260
    ? 'Windows Group Policy blocks this operation. Administrator elevation alone does not override that policy.'
    : code === 5
      ? 'Access denied. Only the power configuration command may require administrator permission.'
      : code === 2
        ? 'The requested power scheme or setting is unavailable.'
        : 'Windows rejected the power configuration operation.';
  const error = new Error(`${operation} failed (${backend}, Windows ${code}). ${reason}${details ? ` ${details.trim().slice(0, 1200)}` : ''}`);
  error.code = code;
  error.operation = operation;
  error.backend = backend;
  return error;
}

export const powerErrorDetails = error => ({
  code: Number.isInteger(error.code) ? error.code : null,
  operation: error.operation || null,
  backend: error.backend || null,
  message: error.message
});
