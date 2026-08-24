export const BRIDGE_PROTOCOL = 'covetrus.portal.bridge';

export const MAX_ARTIFACT_DOWNLOAD_BYTES = 50 * 1024 * 1024;

const SAFE_DOWNLOAD_EXTENSION = /\.(?:csv|json|pdf|pptx?|xlsx?|zip)$/i;

function isBlob(value: unknown): value is Blob {
  if (!value || typeof value !== 'object' || typeof Blob === 'undefined') return false;
  try {
    Blob.prototype.slice.call(value, 0, 0);
    return true;
  } catch {
    return false;
  }
}

export interface ArtifactBridgeMessage {
  protocol: string;
  version: number;
  type: string;
  detail?: string;
  filename?: string;
  blob?: Blob;
}

export function isArtifactBridgeMessage(value: unknown): value is ArtifactBridgeMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  if (message.protocol !== BRIDGE_PROTOCOL || message.version !== 1 || typeof message.type !== 'string') return false;
  if (message.type === 'download') {
    return typeof message.filename === 'string'
      && message.filename.length > 0
      && message.filename.length <= 180
      && SAFE_DOWNLOAD_EXTENSION.test(message.filename)
      && isBlob(message.blob)
      && message.blob.size > 0
      && message.blob.size <= MAX_ARTIFACT_DOWNLOAD_BYTES;
  }
  return ['ready', 'initialized', 'error', 'size'].includes(message.type);
}

export function saveArtifactDownload(message: ArtifactBridgeMessage) {
  if (message.type !== 'download' || !message.filename || !message.blob || !isArtifactBridgeMessage(message)) {
    throw new Error('The artifact supplied an invalid download.');
  }
  const filename = [...message.filename]
    .map((character) => character.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(character) ? '-' : character)
    .join('');
  const url = URL.createObjectURL(message.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}
