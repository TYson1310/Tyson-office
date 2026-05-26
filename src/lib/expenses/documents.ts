export function getExpenseDocumentHref(expenseId: string) {
  return `/api/expenses/document?id=${encodeURIComponent(expenseId)}`;
}

export function getExpenseDocumentDownloadHref(expenseId: string) {
  return `/api/expenses/document?id=${encodeURIComponent(expenseId)}&download=1`;
}
