export function formatPrivateValue(value) {
  return value === null || value === undefined || value === "" ? "-" : String(value);
}
