import test from "node:test";
import assert from "node:assert/strict";

import {
  extractApiErrorDetails,
  extractApiErrorMessage,
} from "../src/services/apiErrors.ts";
import {
  dispatchSessionExpired,
  SESSION_EXPIRED_EVENT,
} from "../src/services/authSessionEvents.ts";
import {
  validateInternationalPhone,
  validatePasswordPolicy,
} from "../src/services/userValidation.ts";

test("api error helpers extract array, string, status, and fallback messages", () => {
  assert.equal(
    extractApiErrorMessage(
      { response: { data: { message: ["first", "second"] } } },
      "fallback",
    ),
    "first second",
  );
  assert.equal(
    extractApiErrorMessage(
      { response: { data: { message: "backend message" } } },
      "fallback",
    ),
    "backend message",
  );
  assert.equal(
    extractApiErrorMessage({ response: { data: { message: "   " } } }, "fallback"),
    "fallback",
  );
  assert.deepEqual(
    extractApiErrorDetails(
      { response: { status: 409, data: { message: "conflict" } } },
      "fallback",
    ),
    { message: "conflict", status: 409 },
  );
});

test("auth session event dispatches only when a browser window exists", () => {
  const originalWindow = globalThis.window;
  const dispatched: string[] = [];

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      dispatchEvent(event: Event) {
        dispatched.push(event.type);
        return true;
      },
    },
  });

  try {
    dispatchSessionExpired();
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }

  assert.deepEqual(dispatched, [SESSION_EXPIRED_EVENT]);
});

test("user validation enforces password policy and international phone shape", () => {
  assert.equal(validatePasswordPolicy("Weak1!"), false);
  assert.equal(validatePasswordPolicy("Stronger1!"), true);
  assert.equal(validatePasswordPolicy("nouppercase1!"), false);
  assert.equal(validatePasswordPolicy("NOLOWERCASE1!"), false);
  assert.equal(validatePasswordPolicy("NoNumber!"), false);
  assert.equal(validatePasswordPolicy("NoSpecial1"), false);

  assert.equal(validateInternationalPhone(), true);
  assert.equal(validateInternationalPhone("   "), true);
  assert.equal(validateInternationalPhone("4155552671"), false);
  assert.equal(validateInternationalPhone("+99912345678"), false);
  assert.equal(validateInternationalPhone("+14155552671"), true);
});

