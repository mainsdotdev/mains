import { Input } from "@/components/ui";

interface ChoiceStepProps {
  name: string;
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  yes: { title: string; description: string };
  no: { title: string; description: string };
  note: string;
}

export function ChoiceStep({
  name,
  label,
  value,
  onChange,
  disabled,
  yes,
  no,
  note,
}: ChoiceStepProps) {
  return (
    <div className="onboarding-choice-step">
      <fieldset className="onboarding-choices" disabled={disabled}>
        <legend className="sr-only">{label}</legend>
        {[
          { value: true, ...yes },
          { value: false, ...no },
        ].map((option) => (
          <label
            className="onboarding-choice glass-outline"
            key={String(option.value)}
          >
            <Input
              variant="bare"
              type="radio"
              name={name}
              className="sr-only"
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span className="onboarding-radio" aria-hidden="true" />
            <span className="onboarding-choice-copy">
              <span className="onboarding-choice-title">{option.title}</span>
              <span className="onboarding-choice-description">
                {option.description}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="onboarding-panel-note">
        {disabled ? "Loading your preferences…" : note}
      </p>
    </div>
  );
}
