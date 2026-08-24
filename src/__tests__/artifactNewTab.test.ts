import { afterEach, describe, expect, it, vi } from 'vitest';

import { artifactViewerUrl, openArtifactInNewTab } from '@/services/artifactNewTab';

describe('artifact new-tab navigation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('severs the opener before navigating to the sandboxed portal viewer', () => {
    const replace = vi.fn();
    const opened = { opener: window, location: { replace } } as unknown as WindowProxy;
    vi.spyOn(window, 'open').mockReturnValue(opened);

    openArtifactInNewTab('modelling tool/2026');

    expect(window.open).toHaveBeenCalledWith('', '_blank');
    expect(opened.opener).toBeNull();
    expect(replace).toHaveBeenCalledWith('/artifacts/modelling%20tool%2F2026?view=tab');
  });

  it('reports a genuinely blocked new tab', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);

    expect(() => openArtifactInNewTab('modelling-tool')).toThrow('The new tab was blocked by your browser.');
  });

  it('builds only a portal viewer URL', () => {
    expect(artifactViewerUrl('../raw-entry')).toBe('/artifacts/..%2Fraw-entry?view=tab');
  });
});
