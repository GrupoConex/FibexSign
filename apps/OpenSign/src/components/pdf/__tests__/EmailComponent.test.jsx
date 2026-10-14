import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EmailComponent from "../EmailComponent";

const cloudRun = vi.fn();

vi.mock("parse", () => ({
  default: { Cloud: { run: (...args) => cloudRun(...args) } }
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key) => key })
}));

vi.mock("../../../constant/Utils", () => ({ handleToPrint: vi.fn() }));

const GENERIC_ERROR_ALERT = {
  isShow: true,
  alertMessage: "something-went-wrong-mssg"
};

const renderComponent = () => {
  const props = {
    isEmail: true,
    setIsEmail: vi.fn(),
    setSuccessEmail: vi.fn(),
    pdfDetails: [{ objectId: "doc1" }],
    setIsAlert: vi.fn(),
    setIsDownloadModal: vi.fn()
  };
  render(<EmailComponent {...props} />);
  return props;
};

const sendTo = async (email) => {
  await userEvent.type(
    screen.getByPlaceholderText("enter-email-placeholder"),
    `${email}{Enter}`
  );
  await userEvent.click(screen.getByText("send"));
};

describe("EmailComponent forwarddoc", () => {
  beforeEach(() => {
    cloudRun.mockReset();
  });

  it("falls into the generic error branch and stops the loader when the server rejects", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const rejection = { code: 101, message: "Object not found" };
    cloudRun.mockRejectedValue(rejection);
    const props = renderComponent();

    await sendTo("a@b.com");

    await waitFor(() =>
      expect(props.setIsAlert).toHaveBeenCalledWith(GENERIC_ERROR_ALERT)
    );
    expect(props.setIsEmail).toHaveBeenCalledWith(false);
    expect(props.setSuccessEmail).not.toHaveBeenCalled();
    expect(screen.queryByText("loader")).not.toBeInTheDocument();
    expect(screen.queryByText("a@b.com")).not.toBeInTheDocument();
    expect(logSpy).toHaveBeenCalledWith("Err in forwarddoc", rejection);
    logSpy.mockRestore();
  });

  it("keeps only the failed recipients and shows the alert on a partial delivery", async () => {
    cloudRun.mockResolvedValue({
      status: "partial",
      sentCount: 1,
      failedCount: 1,
      failedRecipients: ["c@d.com"]
    });
    const props = renderComponent();

    await sendTo("a@b.com");

    await waitFor(() =>
      expect(props.setIsAlert).toHaveBeenCalledWith(GENERIC_ERROR_ALERT)
    );
    expect(props.setIsEmail).toHaveBeenCalledWith(false);
    expect(props.setSuccessEmail).not.toHaveBeenCalled();
    expect(screen.queryByText("loader")).not.toBeInTheDocument();
    expect(screen.getByText("c@d.com")).toBeInTheDocument();
    expect(screen.queryByText("a@b.com")).not.toBeInTheDocument();
    expect(document.querySelector("input[type=email]")).toHaveValue("");
  });

  it("behaves like a generic error on a partial answer without failedRecipients", async () => {
    cloudRun.mockResolvedValue({ status: "partial", sentCount: 1 });
    const props = renderComponent();

    await sendTo("a@b.com");

    await waitFor(() =>
      expect(props.setIsAlert).toHaveBeenCalledWith(GENERIC_ERROR_ALERT)
    );
    expect(props.setIsEmail).toHaveBeenCalledWith(false);
    expect(screen.queryByText("a@b.com")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("enter-email-placeholder")).toBeInTheDocument();
  });

  it("keeps the success behavior when the server answers success", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    cloudRun.mockResolvedValue({ status: "success" });
    const props = renderComponent();

    await sendTo("a@b.com");

    await waitFor(() =>
      expect(props.setSuccessEmail).toHaveBeenCalledWith(true)
    );
    expect(cloudRun).toHaveBeenCalledWith("forwarddoc", {
      docId: "doc1",
      recipients: ["a@b.com"]
    });
    expect(props.setIsEmail).toHaveBeenCalledWith(false);
    expect(props.setIsAlert).not.toHaveBeenCalled();
    expect(screen.queryByText("loader")).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(props.setSuccessEmail).toHaveBeenLastCalledWith(false);
    vi.useRealTimers();
  });
});
