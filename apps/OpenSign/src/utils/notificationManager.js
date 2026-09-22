import { toast } from "sonner";

const DEFAULT_DURATIONS = {
  success: 4000,
  info: 4000,
  warning: 6000,
  error: 8000
};

function show(type, message, options = {}) {
  const { duration, ...rest } = options;
  return toast[type](message, {
    duration: duration ?? DEFAULT_DURATIONS[type],
    ...rest
  });
}

export const notify = {
  success: (message, options) => show("success", message, options),
  error: (message, options) => show("error", message, options),
  warning: (message, options) => show("warning", message, options),
  info: (message, options) => show("info", message, options),
  dismiss: (id) => toast.dismiss(id)
};
