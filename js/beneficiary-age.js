const MAX_AGE = 120;

/** Parse completed years, accepting Western, Arabic, and Persian numerals. */
export function parseBeneficiaryAge(value) {
  if (!["string", "number"].includes(typeof value)) return null;
  const text = String(value).trim().replace(/[٠-٩۰-۹]/g, digit => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
  if (!/^\d+$/.test(text)) return null;
  const age = Number(text);
  return Number.isInteger(age) && age >= 0 && age <= MAX_AGE ? age : null;
}

function daysInMonth(year, month) {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

function localCalendarDate(today) {
  if (!(today instanceof Date) || Number.isNaN(today.getTime())) return null;
  const year = today.getFullYear();
  if (year < 1 || year > 9999) return null;
  return { year, month: today.getMonth() + 1, day: today.getDate() };
}

function parseBirthDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/**
 * Age alone cannot identify a real birthday. Approximate it using today's local
 * month/day in the birth year; February 29 becomes February 28 if necessary.
 */
export function birthDateFromAge(value, today = new Date()) {
  const age = parseBeneficiaryAge(value);
  const current = localCalendarDate(today);
  if (age === null || !current || current.year - age < 1) return null;
  const year = current.year - age;
  const day = Math.min(current.day, daysInMonth(year, current.month));
  return `${String(year).padStart(4, "0")}-${String(current.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Completed calendar years, with February 29 birthdays advancing on March 1 in
 * nonleap years. Date-only input is never parsed as UTC or an elapsed duration.
 */
export function ageFromBirthDate(value, today = new Date()) {
  const birth = parseBirthDate(value);
  const current = localCalendarDate(today);
  if (!birth || !current) return null;
  const birthdayPending = current.month < birth.month || (current.month === birth.month && current.day < birth.day);
  const age = current.year - birth.year - (birthdayPending ? 1 : 0);
  return age >= 0 && age <= MAX_AGE ? age : null;
}

const formBindings = new WeakMap();
const AGE_ERROR = "أدخل عمراً صحيحاً بين 0 و120 سنة.";
const BIRTH_DATE_ERROR = "أدخل تاريخ ميلاد صحيحاً لا يتجاوز اليوم، بعمر من 0 إلى 120 سنة.";

/**
 * Bind named beneficiary fields. Existing DOB is authoritative at bind time and
 * is never replaced on initialization. Only an explicit age edit estimates DOB.
 * `today` may be a Date or a function returning the current local Date.
 * Returns a disposer; rebinding the same form removes its previous listeners.
 */
export function bindBeneficiaryAgeFields(form, { today = () => new Date() } = {}) {
  formBindings.get(form)?.();
  const ageInput = form?.querySelector('[name="age"]');
  const birthDateInput = form?.querySelector('[name="birth_date"]');
  if (!ageInput || !birthDateInput) return () => {};
  const currentDate = typeof today === "function" ? today : () => today;
  let updating = false;

  function update(action) {
    updating = true;
    try { action(); }
    finally { updating = false; }
  }
  function setValue(input, value) {
    if (input.value !== value) input.value = value;
  }
  function validateAge() {
    const blank = ageInput.value.trim() === "";
    const age = parseBeneficiaryAge(ageInput.value);
    const invalid = ageInput.validity.badInput || (!blank && age === null);
    ageInput.setCustomValidity(invalid ? AGE_ERROR : "");
    return { age, blank, valid: !invalid };
  }
  function clearPair() {
    update(() => {
      setValue(ageInput, "");
      setValue(birthDateInput, "");
      ageInput.setCustomValidity("");
      birthDateInput.setCustomValidity("");
    });
  }
  function fromAge() {
    if (updating) return;
    const { age, blank, valid } = validateAge();
    if (!valid) return;
    if (blank) { clearPair(); return; }
    const birthDate = birthDateFromAge(age, currentDate());
    if (birthDate === null) { ageInput.setCustomValidity(AGE_ERROR); return; }
    update(() => {
      setValue(ageInput, String(age));
      setValue(birthDateInput, birthDate);
      ageInput.setCustomValidity("");
      birthDateInput.setCustomValidity("");
    });
  }
  function fromBirthDate(clearBlank) {
    if (updating) return;
    if (birthDateInput.validity.badInput) {
      birthDateInput.setCustomValidity(BIRTH_DATE_ERROR);
      return;
    }
    if (birthDateInput.value === "") {
      birthDateInput.setCustomValidity("");
      if (clearBlank) clearPair();
      return;
    }
    const age = ageFromBirthDate(birthDateInput.value, currentDate());
    if (age === null) { birthDateInput.setCustomValidity(BIRTH_DATE_ERROR); return; }
    update(() => {
      setValue(ageInput, String(age));
      ageInput.setCustomValidity("");
      birthDateInput.setCustomValidity("");
    });
  }
  const onBirthDateChange = () => fromBirthDate(true);
  for (const type of ["input", "change"]) {
    ageInput.addEventListener(type, fromAge);
    birthDateInput.addEventListener(type, onBirthDateChange);
  }
  const dispose = () => {
    for (const type of ["input", "change"]) {
      ageInput.removeEventListener(type, fromAge);
      birthDateInput.removeEventListener(type, onBirthDateChange);
    }
    if (formBindings.get(form) === dispose) formBindings.delete(form);
  };
  formBindings.set(form, dispose);
  validateAge();
  fromBirthDate(false);
  return dispose;
}
