export function extractSharedFiles(formData: FormData): File[] {
  return formData
    .getAll('files')
    .filter((value): value is File => typeof value !== 'string' && value instanceof File)
    .filter((file) => file.size >= 0 && file.name.length > 0);
}

export type ShareTargetMessage =
  | { type: 'quickdrop-share-target'; id: string; files: File[] }
  | { type: 'quickdrop-share-target-error'; id: string; error: string };

export function parseShareTargetMessage(data: unknown): ShareTargetMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const message = data as Record<string, unknown>;
  if (typeof message.id !== 'string' || message.id.length === 0) return null;
  if (message.type === 'quickdrop-share-target-error' && typeof message.error === 'string') {
    return { type: message.type, id: message.id, error: message.error };
  }
  if (
    message.type === 'quickdrop-share-target' &&
    Array.isArray(message.files) &&
    message.files.every((file) => typeof File !== 'undefined' && file instanceof File)
  ) {
    return { type: message.type, id: message.id, files: message.files };
  }
  return null;
}
