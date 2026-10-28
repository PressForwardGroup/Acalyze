// Password rules for passwords people choose themselves (generated temporary ones are not checked).
const COMMON = new Set(['password', 'password1', '12345678', '123456789', 'qwerty123', 'acalyze123', 'iloveyou1', 'admin1234', 'welcome123']);

export function passwordProblem(pw) {
  const p = String(pw ?? '');
  if (p.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'Password must contain at least one letter and one number.';
  if (COMMON.has(p.toLowerCase())) return 'That password is too common. Choose something harder to guess.';
  return null;
}
