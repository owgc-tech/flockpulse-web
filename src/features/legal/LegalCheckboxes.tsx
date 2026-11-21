'use client';

// FP-254: the two required boxes, shared by registration, founder registration and the one-time
// "Please confirm to continue" screen. Texts are Harvey's final wording (fp-254-screen-texts v1.0): do not reword.
// Both start unticked. The parent keeps the two booleans and disables its submit button until both are true.

const boxClass =
  'mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-300 text-zinc-900 focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900';
const labelClass = 'flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300';
const linkClass = 'underline hover:text-zinc-900 dark:hover:text-zinc-100';

// withThe: box text reads "…Terms of Service and the Privacy Policy"; the screen intro reads "…Terms of Service and Privacy Policy".
export function TermsLinks({ withThe = true }: { withThe?: boolean }) {
  return (
    <>
      <a href="/terms" target="_blank" rel="noopener noreferrer" className={linkClass}>
        Terms of Service
      </a>
      {withThe ? ' and the ' : ' and '}
      <a href="/privacy" target="_blank" rel="noopener noreferrer" className={linkClass}>
        Privacy Policy
      </a>
    </>
  );
}

export function AcceptTermsCheckbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={labelClass}>
      <input
        type="checkbox" name="acceptTerms" required
        checked={checked} onChange={e => onChange(e.target.checked)}
        className={boxClass}
      />
      <span>
        I accept the <TermsLinks />.
      </span>
    </label>
  );
}

export function ConfirmAdultCheckbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={labelClass}>
      <input
        type="checkbox" name="confirmAdult" required
        checked={checked} onChange={e => onChange(e.target.checked)}
        className={boxClass}
      />
      <span>I confirm I am 18 or older.</span>
    </label>
  );
}
