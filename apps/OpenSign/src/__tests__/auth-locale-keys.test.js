import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const LOCALES_DIR = path.resolve(__dirname, "../../public/locales");
const LOCALES = ["de", "en", "es", "fr", "hi", "it", "kr"];
const SPANISH_TEXTS = {
  "otp-resend-limit":
    "Has solicitado demasiados códigos. Intenta de nuevo en unos minutos.",
  "email-already-registered": "Este correo ya está registrado.",
  "user-linked-existing-account":
    "El usuario ya tenía una cuenta: se agregó al equipo y deberá usar su contraseña actual o recuperarla.",
  "send-verification-code": "Enviar código de verificación",
  "otp-sent-to-email": "Enviamos un código de 6 dígitos a {{email}}.",
  "otp-too-many-attempts": "Demasiados intentos. Intenta de nuevo más tarde.",
  "login-email-verification-required":
    "Debes verificar tu correo. Ingresa el código que enviamos a {{email}}.",
  "invalid-credentials-or-otp": "Credenciales o código inválidos.",
  "otp-send-failed-hint":
    "No pudimos enviar el código. Pulsa Reenviar para intentarlo de nuevo.",
  "resend-in-seconds": "Reenviar en {{seconds}} s",
  "otp-resent-to-email": "Te reenviamos un código nuevo a {{email}}.",
  "resend-available-in-seconds":
    "Podrás reenviar el código en {{seconds}} segundos"
};
const KEYS = Object.keys(SPANISH_TEXTS);

const readLocale = (locale) =>
  JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, locale, "translation.json"), "utf8")
  );

describe.each(KEYS)("%s translation", (key) => {
  it.each(LOCALES)("is defined and non empty for %s", (locale) => {
    const text = readLocale(locale)[key];

    expect(typeof text).toBe("string");
    expect(text.trim().length).toBeGreaterThan(0);
  });

  it("uses the agreed Spanish wording", () => {
    expect(readLocale("es")[key]).toBe(SPANISH_TEXTS[key]);
  });

  it("is translated rather than copied from English in every other locale", () => {
    const english = readLocale("en")[key];

    LOCALES.filter((locale) => locale !== "en").forEach((locale) => {
      expect(readLocale(locale)[key]).not.toBe(english);
    });
  });
});
