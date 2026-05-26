import { cn } from "@/lib/utils";
import { useId } from "react";

interface PropsType {
  label: string;
  placeholder: string;
  required?: boolean;
  disabled?: boolean;
  active?: boolean;
  className?: string;
  icon?: React.ReactNode;
  defaultValue?: string;
}

export function TextAreaGroup({
  label,
  placeholder,
  required,
  disabled,
  active,
  className,
  icon,
  defaultValue,
}: PropsType) {
  const id = useId();

  return (
    <div className={cn(className)}>
      <label
        htmlFor={id}
        className="mb-3 block text-body-sm font-medium text-dark dark:text-white"
      >
        {label}
      </label>

      <div className="relative mt-3 [&_svg]:pointer-events-none [&_svg]:absolute [&_svg]:left-5.5 [&_svg]:top-5.5">
        <textarea
          id={id}
          rows={6}
          placeholder={placeholder}
          defaultValue={defaultValue}
          className={cn(
            "app-input px-5.5 py-3 text-dark disabled:cursor-default disabled:bg-gray-2 data-[active=true]:border-primary dark:disabled:bg-dark dark:data-[active=true]:border-primary",
            icon && "py-5 pl-13 pr-5",
          )}
          required={required}
          disabled={disabled}
          data-active={active}
        />

        {icon}
      </div>
    </div>
  );
}
