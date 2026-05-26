export const EXPENSE_CATEGORY_OPTIONS = [
  "Utilities",
  "Rent",
  "Repairs & Maintenance",
  "Supplies",
  "Fuel",
  "Insurance",
  "Taxes & Licenses",
  "Cleaning",
  "Contract Labor",
  "Other",
];

const EXPENSE_CATEGORY_ALIASES = new Map<string, string>([
  ["utilities", "Utilities"],
  ["utility", "Utilities"],
  ["utility bill", "Utilities"],
  ["electric", "Utilities"],
  ["electricity", "Utilities"],
  ["power", "Utilities"],
  ["water", "Utilities"],
  ["sewer", "Utilities"],
  ["trash", "Utilities"],
  ["garbage", "Utilities"],
  ["waste", "Utilities"],
  ["internet", "Utilities"],
  ["phone", "Utilities"],
  ["telecom", "Utilities"],
  ["gas", "Utilities"],
  ["rent", "Rent"],
  ["lease", "Rent"],
  ["repairs", "Repairs & Maintenance"],
  ["repair", "Repairs & Maintenance"],
  ["maintenance", "Repairs & Maintenance"],
  ["repairs maintenance", "Repairs & Maintenance"],
  ["repairs and maintenance", "Repairs & Maintenance"],
  ["supplies", "Supplies"],
  ["supply", "Supplies"],
  ["fuel", "Fuel"],
  ["insurance", "Insurance"],
  ["taxes", "Taxes & Licenses"],
  ["tax", "Taxes & Licenses"],
  ["licenses", "Taxes & Licenses"],
  ["license", "Taxes & Licenses"],
  ["permits", "Taxes & Licenses"],
  ["permit", "Taxes & Licenses"],
  ["cleaning", "Cleaning"],
  ["janitorial", "Cleaning"],
  ["contract labor", "Contract Labor"],
  ["contractor labor", "Contract Labor"],
  ["labor", "Contract Labor"],
  ["contractors", "Contract Labor"],
  ["other", "Other"],
]);

function toExpenseCategoryLookupKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toTitleCase(value: string) {
  return value.replace(/\w\S*/g, (word) => {
    if (word.length === 0) {
      return word;
    }

    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}

export function normalizeExpenseCategory(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, " ");

  if (!normalized) {
    return null;
  }

  const aliasMatch = EXPENSE_CATEGORY_ALIASES.get(
    toExpenseCategoryLookupKey(normalized),
  );

  if (aliasMatch) {
    return aliasMatch;
  }

  return toTitleCase(normalized);
}
