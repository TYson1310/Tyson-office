"use client";

import React from "react";

interface FormField {
  name: string;
  label: string;
  type: "text" | "email" | "number" | "date" | "select" | "textarea";
  required?: boolean;
  options?: { label: string; value: string }[];
  placeholder?: string;
}

interface FormBuilderProps {
  fields: FormField[];
  onSubmit: (data: Record<string, any>) => void;
  onCancel?: () => void;
  submitLabel?: string;
  isLoading?: boolean;
  initialValues?: Record<string, any>;
}

export function FormBuilder({
  fields,
  onSubmit,
  onCancel,
  submitLabel = "Submit",
  isLoading = false,
  initialValues = {},
}: FormBuilderProps) {
  const [formData, setFormData] = React.useState(initialValues);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {fields.map((field) => (
        <div key={field.name} className="flex flex-col">
          <label className="mb-2 font-medium text-dark dark:text-white">
            {field.label}
            {field.required && <span className="text-red">*</span>}
          </label>

          {field.type === "textarea" ? (
            <textarea
              name={field.name}
              value={formData[field.name] || ""}
              onChange={handleChange}
              placeholder={field.placeholder}
              required={field.required}
              className="rounded border border-stroke bg-transparent px-3 py-2 text-dark outline-none focus:border-primary dark:border-stroke-dark dark:text-white"
              rows={4}
            />
          ) : field.type === "select" ? (
            <select
              name={field.name}
              value={formData[field.name] || ""}
              onChange={handleChange}
              required={field.required}
              className="rounded border border-stroke bg-transparent px-3 py-2 text-dark outline-none focus:border-primary dark:border-stroke-dark dark:text-white"
            >
              <option value="">Select {field.label}</option>
              {field.options?.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={field.type}
              name={field.name}
              value={formData[field.name] || ""}
              onChange={handleChange}
              placeholder={field.placeholder}
              required={field.required}
              className="rounded border border-stroke bg-transparent px-3 py-2 text-dark outline-none focus:border-primary dark:border-stroke-dark dark:text-white"
            />
          )}
        </div>
      ))}

      <div className="flex gap-3 pt-4">
        <button
          type="submit"
          disabled={isLoading}
          className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-2 text-center font-medium text-white hover:bg-opacity-90 disabled:opacity-50"
        >
          {isLoading ? "Loading..." : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center justify-center rounded-md border border-stroke bg-white px-6 py-2 text-center font-medium text-dark hover:bg-gray-2 dark:border-stroke-dark dark:bg-dark-2 dark:text-white"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
