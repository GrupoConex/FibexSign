import { HelpCircle } from "lucide-react";
import { Tooltip as ReactTooltip } from "react-tooltip";

const HelpHint = ({ id, children, className }) => {
  return (
    <span className={`inline-flex align-middle ml-1 ${className || ""}`}>
      <button
        type="button"
        data-tooltip-id={id}
        aria-label="help"
        className="inline-flex rounded-full cursor-help text-primary hover:text-primary/80 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <HelpCircle size={13} aria-hidden="true" />
      </button>
      <ReactTooltip id={id} className="z-[999]">
        {children}
      </ReactTooltip>
    </span>
  );
};

export default HelpHint;
