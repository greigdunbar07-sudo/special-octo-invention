export function artifactViewerUrl(slug: string): string {
  return `/artifacts/${encodeURIComponent(slug)}?view=tab`;
}

export function openArtifactInNewTab(slug: string) {
  const opened = window.open('', '_blank');
  if (!opened) throw new Error('The new tab was blocked by your browser.');
  opened.opener = null;
  opened.location.replace(artifactViewerUrl(slug));
}
