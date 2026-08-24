import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { WelcomeTour } from '@/components/WelcomeTour';

describe('WelcomeTour', () => {
  it('welcomes the signed-in user and walks through the Launchpad', async () => {
    const user = userEvent.setup();
    const finish = vi.fn().mockResolvedValue(undefined);
    render(<WelcomeTour open displayName="Greig Dunbar" onFinish={finish} />);

    expect(screen.getByRole('heading')).toHaveTextContent('Welcome to Covetrus Launchpad, Greig.');
    expect(screen.getByLabelText('Step 1 of 4')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading')).toHaveTextContent('Everything available to you');
    expect(screen.getByText(/All, Reports, and Tools tabs/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Start exploring' }));

    expect(finish).toHaveBeenCalledOnce();
  });

  it('allows the user to skip while persisting completion', async () => {
    const user = userEvent.setup();
    const finish = vi.fn().mockResolvedValue(undefined);
    render(<WelcomeTour open displayName="Alex Morgan" onFinish={finish} />);

    await user.click(screen.getByRole('button', { name: 'Skip tour' }));

    expect(finish).toHaveBeenCalledOnce();
  });
});
