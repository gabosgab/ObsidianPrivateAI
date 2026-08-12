export function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function isAbortError(error: unknown): boolean {
	return error instanceof DOMException
		? error.name === 'AbortError'
		: error instanceof Error && error.name === 'AbortError';
}
