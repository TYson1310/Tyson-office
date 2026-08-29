import assert from "node:assert/strict";
import test from "node:test";
import { isExpenseAttachmentRequiredForApproval } from "./expense-records.ts";

test("non-utility expenses over 100 do not require a bill copy", () => {
  assert.equal(
    isExpenseAttachmentRequiredForApproval({
      amount: 150,
      category: "Office Supplies",
    }),
    false,
  );
});

test("utility expenses still require a bill copy", () => {
  assert.equal(
    isExpenseAttachmentRequiredForApproval({
      amount: 50,
      category: "Utilities",
    }),
    true,
  );
});
