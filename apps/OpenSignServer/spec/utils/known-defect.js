export const knownDefect = (id, description, body) => async () => {
  const results = [];
  const check = (condition, message) => {
    results.push({ condition: Boolean(condition), message });
  };

  await body(check);

  if (results.length === 0) {
    fail(`Known defect ${id} performed no checks`);
    return;
  }
  if (results.every(result => result.condition)) {
    fail(`Known defect ${id} appears fixed; remove the marker`);
    return;
  }
  pending(`KNOWN DEFECT ${id}: ${description}`);
};
