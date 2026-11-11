import { describe, expect, it } from "vitest";
import { isProfileComplete, type BasicProfile } from "./profile-completion";

const complete: BasicProfile = {
  email: "jogador@example.com",
  full_name: "Jogador",
  phone: "(11) 99999-9999",
  age: 26,
  position: "Meia",
  dominant_foot: "direito",
};

describe("profile completion", () => {
  it("accepts the required personal and football fields without address", () => {
    expect(isProfileComplete(complete)).toBe(true);
  });

  it("requires the account email, phone, age, primary position and dominant foot", () => {
    for (const key of ["email", "phone", "age", "position", "dominant_foot"] as const) {
      const incomplete = { ...complete, [key]: "" };
      expect(isProfileComplete(incomplete)).toBe(false);
    }
  });

  it("rejects invalid age, position and dominant foot values", () => {
    expect(isProfileComplete({ ...complete, age: 0 })).toBe(false);
    expect(isProfileComplete({ ...complete, age: 121 })).toBe(false);
    expect(isProfileComplete({ ...complete, position: "Treinador" })).toBe(false);
    expect(isProfileComplete({ ...complete, dominant_foot: "canhoto" })).toBe(false);
  });

  it("rejects a missing profile", () => {
    expect(isProfileComplete(null)).toBe(false);
  });
});
