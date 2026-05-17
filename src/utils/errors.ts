export function isCreditsError(err: unknown): boolean {
  const msg: string =
    (err as { message?: string })?.message ??
    (err as { error?: { message?: string } })?.error?.message ??
    '';
  return msg.includes('credit balance is too low') || msg.includes('insufficient_quota');
}
