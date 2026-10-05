export interface SwitchProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  hideLabel?: boolean
  disabled?: boolean
  className?: string
}

/** On/off control (role=switch); Space and Enter toggle it natively as a button. */
export const Switch = ({ label, checked, onChange, hideLabel, disabled, className }: SwitchProps) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={hideLabel ? label : undefined}
    disabled={disabled}
    className={["sc-switch", className ?? ""].filter(Boolean).join(" ")}
    onClick={() => onChange(!checked)}
  >
    {hideLabel ? null : <span className="sc-switch-label">{label}</span>}
    <span className="sc-switch-track" aria-hidden="true">
      <span className="sc-switch-thumb" />
    </span>
  </button>
)
