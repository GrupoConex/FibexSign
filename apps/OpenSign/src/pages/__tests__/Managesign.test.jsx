import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ManageSign from "../Managesign";
import { notify } from "../../utils";
import { toDataUrl } from "../../constant/Utils";
import Parse from "parse";

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useTranslation: () => ({ t: (key) => key })
  };
});

vi.mock("react-signature-canvas", () => ({
  default: React.forwardRef(function SignatureCanvasStub(props, ref) {
    React.useImperativeHandle(ref, () => ({
      clear: vi.fn(),
      toDataURL: vi.fn(() => "data:image/png;base64,canvas-stub")
    }));
    return <canvas data-testid="signature-canvas-stub" />;
  })
}));

vi.mock("../../utils", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    notify: {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn()
    }
  };
});

vi.mock("../../constant/Utils", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    toDataUrl: vi.fn(
      (file) => Promise.resolve(`data:image/png;base64,${file.name}`)
    )
  };
});

vi.mock("../../constant/saveFileSize", () => ({
  SaveFileSize: vi.fn()
}));

const mockSessionUser = {
  id: "user-1",
  get: vi.fn(() => undefined),
  getSessionToken: () => "session-token"
};

vi.mock("parse", () => ({
  default: {
    User: {
      current: vi.fn()
    },
    Cloud: {
      run: vi.fn()
    },
    File: vi.fn()
  }
}));

const renderManageSign = () => render(<ManageSign />);

const waitForInitialLoadToFinish = async () => {
  const saveButton = await screen.findByRole("button", { name: "save" });
  await waitFor(() => expect(saveButton).not.toBeDisabled());
  return saveButton;
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.setItem("TenantId", "tenant-1");
  Parse.User.current.mockReturnValue(mockSessionUser);
  Parse.Cloud.run.mockResolvedValue(null);
});

describe("ManageSign validation warning", () => {
  it("notifies a warning and renders no legacy floating warning when submitting without a configured signature", async () => {
    renderManageSign();
    const saveButton = await waitForInitialLoadToFinish();

    await userEvent.click(saveButton);

    expect(notify.warning).toHaveBeenCalledWith("upload-signature/Image");
  });
});

describe("ManageSign stamp drag and drop", () => {
  it("uploads the stamp through drag and drop using the same flow as the file input", async () => {
    renderManageSign();
    await waitForInitialLoadToFinish();

    const dropzone = await screen.findByTestId("stamp-dropzone");
    const file = new File(["stamp-bytes"], "stamp.png", {
      type: "image/png"
    });
    const dataTransfer = { files: [file] };

    fireEvent.dragOver(dropzone, { dataTransfer });
    fireEvent.drop(dropzone, { dataTransfer });

    await waitFor(() => {
      expect(dropzone.querySelector("img")).not.toBeNull();
    });
    const stampPreview = screen.getByTestId("stamp-dropzone").querySelector("img");
    expect(stampPreview.getAttribute("src")).toContain("stamp.png");
  });

  it("rejects a dropped file with an unsupported type and does not render a preview", async () => {
    renderManageSign();
    await waitForInitialLoadToFinish();

    const dropzone = await screen.findByTestId("stamp-dropzone");
    const file = new File(["not-an-image"], "malicious.pdf", {
      type: "application/pdf"
    });
    const dataTransfer = { files: [file] };

    fireEvent.dragOver(dropzone, { dataTransfer });
    fireEvent.drop(dropzone, { dataTransfer });

    await waitFor(() => {
      expect(notify.warning).toHaveBeenCalledWith("stamp-invalid-file");
    });
    expect(screen.getByTestId("stamp-dropzone").querySelector("img")).toBeNull();
  });

  it("rejects a dropped file that exceeds the maximum stamp size and does not render a preview", async () => {
    renderManageSign();
    await waitForInitialLoadToFinish();

    const dropzone = await screen.findByTestId("stamp-dropzone");
    const oversizedContent = new Uint8Array(6 * 1024 * 1024);
    const file = new File([oversizedContent], "huge-stamp.png", {
      type: "image/png"
    });
    const dataTransfer = { files: [file] };

    fireEvent.dragOver(dropzone, { dataTransfer });
    fireEvent.drop(dropzone, { dataTransfer });

    await waitFor(() => {
      expect(notify.warning).toHaveBeenCalledWith("stamp-invalid-file");
    });
    expect(screen.getByTestId("stamp-dropzone").querySelector("img")).toBeNull();
  });
});

describe("ManageSign status badges", () => {
  it("flips the signature card badge from not-defined to configured once an image is uploaded", async () => {
    renderManageSign();
    await waitForInitialLoadToFinish();

    expect(
      screen.getAllByText("signature-not-defined").length
    ).toBeGreaterThan(0);

    const fileInput = screen.getByTestId("signature-file-input");
    const file = new File(["sign-bytes"], "sign.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(
        screen.getAllByText("signature-configured").length
      ).toBeGreaterThan(0);
    });
  });
});

describe("ManageSign initial load failure", () => {
  it("keeps the save button enabled after the initial signature fetch fails", async () => {
    Parse.Cloud.run.mockRejectedValue(new Error("network-down"));

    renderManageSign();

    const saveButton = await screen.findByRole("button", { name: "save" });
    await waitFor(() => expect(saveButton).not.toBeDisabled());

    expect(notify.error).toHaveBeenCalledWith("network-down");
  });
});

describe("ManageSign submit flow", () => {
  it("calls managesign with the uploaded signature payload on save", async () => {
    Parse.File.mockImplementation(function ParseFileMock() {
      return {
        save: vi.fn().mockResolvedValue({
          url: () => "https://cdn.example.com/uploaded-sign.png"
        })
      };
    });

    renderManageSign();
    await waitForInitialLoadToFinish();

    vi.mocked(toDataUrl).mockResolvedValueOnce(
      "data:image/png;base64,aGVsbG8="
    );
    const fileInput = screen.getByTestId("signature-file-input");
    const file = new File(["sign-bytes"], "sign.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(
        screen.getAllByText("signature-configured").length
      ).toBeGreaterThan(0);
    });

    const saveButton = screen.getByRole("button", { name: "save" });
    await userEvent.click(saveButton);

    await waitFor(() => {
      expect(Parse.Cloud.run).toHaveBeenCalledWith(
        "managesign",
        expect.objectContaining({
          signature: "https://cdn.example.com/uploaded-sign.png",
          userId: "user-1",
          initials: "",
          id: "",
          title: "",
          stamp: undefined
        })
      );
    });
  });
});
