export type CardOutcome =
  | { result: "SUCCESS" }
  | { result: "FAILED"; failureCode: "MOCK_DECLINED" | "MOCK_TIMEOUT" };

/** The only card numbers the mock accepts, each with the outcome it simulates. TIMEOUT is stored as FAILED / MOCK_TIMEOUT. */
const TEST_CARDS: Record<string, CardOutcome> = {
  "4242424242424242": { result: "SUCCESS" },
  "4000000000000002": { result: "FAILED", failureCode: "MOCK_DECLINED" },
  "4000000000000119": { result: "FAILED", failureCode: "MOCK_TIMEOUT" },
};

/** The simulated outcome for a normalised (digits only) card number, or null when it is not a test card. */
export function outcomeForCard(cardNumber: string): CardOutcome | null {
  return TEST_CARDS[cardNumber] ?? null;
}

export function lastFour(cardNumber: string): string {
  return cardNumber.slice(-4);
}
