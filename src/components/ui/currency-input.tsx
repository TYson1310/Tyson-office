"use client";

import {
  type ChangeEvent,
  forwardRef,
  type FocusEvent,
  type InputHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

type CurrencyInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "inputMode" | "onChange" | "type" | "value"
> & {
  value: number | string | null | undefined;
  onValueChange: (decimalValue: string, numericValue: number) => void;
  currency?: string;
  locale?: string;
  selectOnFocus?: boolean;
  showSymbol?: boolean;
};

function parseCurrencyInput(value: string) {
  const digits = value.replace(/\D/g, "");

  if (!digits) {
    return null;
  }

  return Math.round(Number.parseInt(digits, 10)) / 100;
}

function coerceCurrencyValue(value: CurrencyInputProps["value"]) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return null;
  }

  const parsedDecimal = Number(trimmedValue.replace(/,/g, ""));

  if (Number.isFinite(parsedDecimal)) {
    return parsedDecimal;
  }

  return parseCurrencyInput(trimmedValue);
}

function roundCurrencyValue(value: number) {
  return Math.round(value * 100) / 100;
}

function formatCurrencyValue({
  currency,
  locale,
  showSymbol,
  value,
}: {
  currency: string;
  locale: string;
  showSymbol: boolean;
  value: number;
}) {
  try {
    return new Intl.NumberFormat(locale, {
      currency: currency || "USD",
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
      style: showSymbol ? "currency" : "decimal",
    }).format(value);
  } catch {
    return new Intl.NumberFormat(locale, {
      currency: "USD",
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
      style: showSymbol ? "currency" : "decimal",
    }).format(value);
  }
}

export const CurrencyInput = forwardRef<HTMLInputElement, CurrencyInputProps>(
  (
    {
      className,
      currency = "USD",
      locale = "en-US",
      onFocus,
      onValueChange,
      placeholder = "0.00",
      selectOnFocus = true,
      showSymbol = true,
      value,
      ...props
    },
    ref,
  ) => {
    const numericValue = coerceCurrencyValue(value);
    const displayValue =
      numericValue === null
        ? ""
        : formatCurrencyValue({
            currency,
            locale,
            showSymbol,
            value: numericValue,
          });

    function handleChange(event: ChangeEvent<HTMLInputElement>) {
      const nextValue = parseCurrencyInput(event.target.value);

      if (nextValue === null) {
        onValueChange("", 0);
        return;
      }

      const roundedValue = roundCurrencyValue(nextValue);
      onValueChange(roundedValue.toFixed(2), roundedValue);
    }

    function handleFocus(event: FocusEvent<HTMLInputElement>) {
      if (selectOnFocus) {
        event.currentTarget.select();
      }

      onFocus?.(event);
    }

    return (
      <input
        {...props}
        ref={ref}
        type="text"
        inputMode="decimal"
        value={displayValue}
        onChange={handleChange}
        onFocus={handleFocus}
        placeholder={placeholder}
        className={cn("tabular-nums", className)}
      />
    );
  },
);

CurrencyInput.displayName = "CurrencyInput";
