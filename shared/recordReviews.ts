export type ReviewDay = { status: string; mealState: string; amount: number; amountReady: boolean; clockIn: string; clockOut: string; issues: number }
export type RecordReviewImpact = { employeeId: string; name: string; date: string; before: ReviewDay; after: ReviewDay }
export type RecordReviewPreview = { checksum: string; revision: number; affected: RecordReviewImpact[]; record: { name: string; ref: string; start: string; end: string }; disposition: 'excluded' | 'active' }
