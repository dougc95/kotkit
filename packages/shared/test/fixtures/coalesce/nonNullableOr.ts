// Fixture for findZeroCoalesce pass (a): `n` is a genuinely non-nullable
// number, so `n || 0` is ordinary defensive code, not a nullable count being
// zero-filled. Must NOT be reported.
export function withDefault(n: number): number {
  const total = n || 0
  return total
}
