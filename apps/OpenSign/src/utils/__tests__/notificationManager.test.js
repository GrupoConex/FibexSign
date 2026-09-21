import { toast } from "sonner";
import { notify } from "../notificationManager";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn()
  }
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("notify.success", () => {
  it("calls toast.success with the default duration", () => {
    notify.success("msg");

    expect(toast.success).toHaveBeenCalledWith("msg", { duration: 4000 });
  });
});

describe("notify.error", () => {
  it("calls toast.error with the default duration", () => {
    notify.error("msg");

    expect(toast.error).toHaveBeenCalledWith("msg", { duration: 8000 });
  });
});

describe("notify.warning", () => {
  it("calls toast.warning with the default duration", () => {
    notify.warning("msg");

    expect(toast.warning).toHaveBeenCalledWith("msg", { duration: 6000 });
  });
});

describe("notify.info", () => {
  it("calls toast.info with the default duration", () => {
    notify.info("msg");

    expect(toast.info).toHaveBeenCalledWith("msg", { duration: 4000 });
  });
});

describe("notify duration override", () => {
  it("respects an explicit duration of 0 instead of falling back to the default", () => {
    notify.success("msg", { duration: 0 });

    expect(toast.success).toHaveBeenCalledWith("msg", { duration: 0 });
  });

  it("respects an explicit duration of Infinity instead of falling back to the default", () => {
    notify.error("msg", { duration: Infinity });

    expect(toast.error).toHaveBeenCalledWith("msg", { duration: Infinity });
  });
});

describe("notify extra options forwarding", () => {
  it("forwards description and action options alongside duration", () => {
    const onClick = vi.fn();

    notify.warning("msg", {
      description: "more details",
      action: { label: "Deshacer", onClick }
    });

    expect(toast.warning).toHaveBeenCalledWith("msg", {
      duration: 6000,
      description: "more details",
      action: { label: "Deshacer", onClick }
    });
  });
});

describe("notify.dismiss", () => {
  it("calls toast.dismiss with the given id", () => {
    notify.dismiss("toast-id");

    expect(toast.dismiss).toHaveBeenCalledWith("toast-id");
  });
});
