const MAIL_RATE_LIMIT_CODE = 155;
const HTTP_TOO_MANY_REQUESTS = 429;

export const isMailRateLimitError = (error) =>
  error?.response?.data?.code === MAIL_RATE_LIMIT_CODE ||
  error?.response?.status === HTTP_TOO_MANY_REQUESTS;

const NON_SPECIFIC_STATUSES = ["success", "error", "failed"];

export const toSendOutcome = (response) => {
  const status = response?.data?.result?.status;
  return { ok: status === "success", status, rateLimited: false };
};

export const toSendFailure = (error) => ({
  ok: false,
  status: "failed",
  rateLimited: isMailRateLimitError(error)
});

export const summarizeSendOutcomes = (outcomes) => {
  const failures = outcomes.filter((outcome) => !outcome.ok);
  const sentCount = outcomes.length - failures.length;
  if (failures.length === 0 && sentCount > 0) return { status: "success" };
  const specific = failures.find(
    (failure) =>
      failure.status && !NON_SPECIFIC_STATUSES.includes(failure.status)
  );
  return {
    status: specific?.status ?? "failed",
    failedCount: failures.length,
    sentCount,
    rateLimited: failures.some((failure) => failure.rateLimited)
  };
};

export const mailErrorMessageKey = (error) =>
  isMailRateLimitError(error)
    ? "mail-rate-limited"
    : "something-went-wrong-mssg";

export const mailSendFailureMessageKey = (result) =>
  result?.rateLimited ? "mail-rate-limited" : "mail-failed";
