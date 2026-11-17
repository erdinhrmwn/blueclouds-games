import { describe, expect, test } from 'bun:test'
import { checkRound, type RoundCheck, type RoundProof } from './fairness'
import vectors from './vectors.json'

interface Vector {
  name: string
  proof: RoundProof
  expected: RoundCheck
}

// The vectors pin the algorithm: every round already played was dealt by it, so a change that alters any of
// these results would make old rounds fail their check. A port of the check (another language) uses them too.
describe('fairness test vectors', () => {
  test.each((vectors.vectors as Vector[]).map((vector) => [vector.name, vector] as const))(
    '%s',
    async (_name, vector) => {
      expect(await checkRound(vector.proof)).toEqual(vector.expected)
    },
  )
})
