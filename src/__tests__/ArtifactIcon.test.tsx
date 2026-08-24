import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ArtifactIcon, ArtifactIconPicker, ARTIFACT_ICONS } from '@/components/ArtifactIcon';
import { parseArtifactIcon } from '@/types/portal';

describe('artifact icons', () => {
  it('accepts the expanded allowlist and rejects unknown names', () => {
    expect(parseArtifactIcon('pie')).toBe('pie');
    expect(parseArtifactIcon('warehouse')).toBe('warehouse');
    expect(parseArtifactIcon('chart')).toBe('chart');
    expect(parseArtifactIcon('unknown')).toBeUndefined();
    expect(parseArtifactIcon(null)).toBeUndefined();
  });

  it('falls back to the kind default when the name is not recognised', () => {
    const { container } = render(<ArtifactIcon name={parseArtifactIcon('nope')} kind="tool" />);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('renders a visual picker for every allowed icon', () => {
    render(<form><ArtifactIconPicker name="icon" defaultValue="chart" /></form>);
    expect(screen.getAllByRole('radio')).toHaveLength(ARTIFACT_ICONS.length);
    expect(screen.getByRole('radio', { name: 'Chart' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Pie' })).not.toBeChecked();
  });
});
