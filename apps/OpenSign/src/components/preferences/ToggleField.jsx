import HelpHint from "./HelpHint";

const ToggleField = ({ id, label, helpId, helpContent, caption, checked, onChange }) => {
  const captionId = caption ? `${id}-caption` : undefined;
  return (
    <div>
      <label htmlFor={id} className="text-[14px] font-medium inline-flex items-center">
        {label}
        {helpId && helpContent && <HelpHint id={helpId}>{helpContent}</HelpHint>}
      </label>
      <div className="mt-2 flex items-center gap-3">
        <input
          id={id}
          data-testid={`toggle-${id}`}
          type="checkbox"
          className="op-toggle op-toggle-sm checked:[--tglbg:oklch(var(--p))] transition-all checked:text-primary-content"
          checked={checked}
          onChange={onChange}
          aria-describedby={captionId}
        />
      </div>
      {caption && (
        <p id={captionId} className="text-xs text-base-content/60 mt-1">
          {caption}
        </p>
      )}
    </div>
  );
};

export default ToggleField;
