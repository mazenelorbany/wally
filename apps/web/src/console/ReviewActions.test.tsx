import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import { ReviewActions } from './ReviewActions';

afterEach(cleanup);

/** Defaults so each test only spells out what it cares about. */
function renderActions(over: Partial<React.ComponentProps<typeof ReviewActions>> = {}) {
  const onOverride = vi.fn();
  const onRequestPhoto = vi.fn();
  render(
    <ReviewActions
      currentVerdict="PASS"
      hasPhoto
      onOverride={onOverride}
      overridePending={false}
      overrideDone={false}
      overrideError={null}
      onRequestPhoto={onRequestPhoto}
      requestPending={false}
      requestDone={false}
      requestError={null}
      {...over}
    />,
  );
  return { onOverride, onRequestPhoto };
}

describe('ReviewActions (FixtureCapture)', () => {
  it('Confirm records the AI verdict explicitly via overrideCapture with the same verdict', () => {
    const { onOverride } = renderActions({ currentVerdict: 'PASS' });
    fireEvent.click(screen.getByText('Confirm'));
    fireEvent.click(screen.getByText('Confirm verdict'));
    expect(onOverride).toHaveBeenCalledWith({ verdict: 'PASS', note: undefined });
  });

  it('Override sends the picked verdict (PASS/NEEDS_REVIEW/FAIL) with the note', () => {
    const { onOverride } = renderActions({ currentVerdict: 'PASS' });
    fireEvent.click(screen.getByText('Override'));
    fireEvent.click(screen.getByText('Fail'));
    fireEvent.change(screen.getByPlaceholderText('What did the model miss?'), {
      target: { value: 'Wrong SKUs on the shelf' },
    });
    fireEvent.click(screen.getByText('Save override'));
    expect(onOverride).toHaveBeenCalledWith({
      verdict: 'FAIL',
      note: 'Wrong SKUs on the shelf',
    });
  });

  it('Request new photo calls the re-shoot callback', () => {
    const { onRequestPhoto } = renderActions();
    fireEvent.click(screen.getByText('New photo'));
    fireEvent.click(screen.getByText('Request new photo'));
    expect(onRequestPhoto).toHaveBeenCalledTimes(1);
  });

  it('Confirm is unavailable until the fixture has been scored', () => {
    renderActions({ currentVerdict: null });
    // The Confirm mode button is disabled; Override / New photo stay available.
    const confirm = screen.getByText('Confirm').closest('button');
    expect(confirm).toBeDisabled();
    expect(screen.getByText('Override').closest('button')).not.toBeDisabled();
    expect(screen.getByText('New photo').closest('button')).not.toBeDisabled();
  });
});
