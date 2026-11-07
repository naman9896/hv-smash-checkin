import { describe, expect, it } from "vitest";
import { formatAuPhone, isValidAuPhone, normaliseAuPhone } from "./utils";
import { checkinFormSchema, checkinRequestSchema, fieldErrors, maxYear, type CheckinFormValues } from "./validation";

const valid: CheckinFormValues = {
  customer_name: "  Jane Citizen ",
  email: " Jane@Example.com ",
  phone: "0403 343 004",
  make: "Toyota",
  model: "Corolla",
  year: "2019",
  job_type: "",
  insurance_company: "",
  claim_number: "",
  damage_description: "",
};

const errorsOf = (v: unknown) => {
  const r = checkinFormSchema().safeParse(v);
  return r.success ? {} : fieldErrors(r.error);
};

describe("phone helpers", () => {
  it.each([
    ["0403 343 004", "0403343004"],
    ["+61 403 343 004", "0403343004"],
    ["+61 (0)403 343 004", "0403343004"],
    ["(02) 4932 4551", "0249324551"],
  ])("normalises %s", (raw, out) => expect(normaliseAuPhone(raw)).toBe(out));

  it.each(["0403343004", "0249324551", "0398765432", "0712345678", "0891234567", "+61249324551"])("accepts %s", (p) =>
    expect(isValidAuPhone(p)).toBe(true),
  );
  it.each(["", "040334300", "04033430044", "0149324551", "0649324551", "1300123456", "abc"])("rejects %s", (p) =>
    expect(isValidAuPhone(p)).toBe(false),
  );

  it("formats mobiles and landlines", () => {
    expect(formatAuPhone("0403343004")).toBe("0403 343 004");
    expect(formatAuPhone("0249324551")).toBe("02 4932 4551");
    expect(formatAuPhone("040")).toBe("040");
  });
});

describe("checkinFormSchema", () => {
  it("cleans a valid form", () => {
    expect(checkinFormSchema().parse(valid)).toEqual({
      customer_name: "Jane Citizen",
      email: "jane@example.com",
      phone: "0403343004",
      make: "Toyota",
      model: "Corolla",
      year: 2019,
      job_type: null,
      insurance_company: null,
      claim_number: null,
      damage_description: null,
    });
  });

  it("requires name, email, phone, make and model", () => {
    const e = errorsOf({ ...valid, customer_name: " ", email: "", phone: "", make: "", model: "" });
    expect(Object.keys(e).sort()).toEqual(["customer_name", "email", "make", "model", "phone"]);
  });

  it("rejects a bad email and a bad phone", () => {
    const e = errorsOf({ ...valid, email: "jane@", phone: "12345" });
    expect(e.email).toMatch(/valid email/);
    expect(e.phone).toMatch(/Australian/);
  });

  it("year is optional, 4 digits, 1950 to next year", () => {
    expect(checkinFormSchema().parse({ ...valid, year: "" }).year).toBeNull();
    expect(checkinFormSchema().parse({ ...valid, year: String(maxYear()) }).year).toBe(maxYear());
    for (const y of ["1949", String(maxYear() + 1), "19", "20x0", "02019"]) expect(errorsOf({ ...valid, year: y }).year).toBeDefined();
  });

  it("keeps insurance details for an insurance job", () => {
    const out = checkinFormSchema().parse({ ...valid, job_type: "insurance", insurance_company: " NRMA ", claim_number: "CLM-1" });
    expect(out).toMatchObject({ job_type: "insurance", insurance_company: "NRMA", claim_number: "CLM-1" });
  });

  it("drops insurance details unless the job is insurance", () => {
    for (const job_type of ["private", ""] as const) {
      const out = checkinFormSchema().parse({ ...valid, job_type, insurance_company: "NRMA", claim_number: "CLM-1" });
      expect(out.insurance_company).toBeNull();
      expect(out.claim_number).toBeNull();
    }
  });

  it("rejects an unknown job type", () => {
    expect(errorsOf({ ...valid, job_type: "fleet" }).job_type).toBeDefined();
  });

  it("limits the damage description to 500 characters", () => {
    expect(checkinFormSchema().parse({ ...valid, damage_description: "x".repeat(500) }).damage_description).toHaveLength(500);
    expect(errorsOf({ ...valid, damage_description: "x".repeat(501) }).damage_description).toMatch(/500/);
  });

  it("rejects unknown fields (strict)", () => {
    expect(checkinFormSchema().safeParse({ ...valid, status: "completed" }).success).toBe(false);
  });
});

describe("checkinRequestSchema", () => {
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

  it("splits the signature from the input", () => {
    const out = checkinRequestSchema().parse({ ...valid, signature: png });
    expect(out.signature).toBe(png);
    expect(out.input.phone).toBe("0403343004");
  });

  it("requires a PNG data-URL signature", () => {
    for (const signature of [undefined, "", "data:image/jpeg;base64,AAAA", "javascript:alert(1)", "data:image/png;base64,<svg>"]) {
      const r = checkinRequestSchema().safeParse({ ...valid, signature });
      expect(r.success).toBe(false);
      if (!r.success) expect(fieldErrors(r.error).signature).toBeDefined();
    }
  });

  it("rejects extra fields such as a forged id or status", () => {
    expect(checkinRequestSchema().safeParse({ ...valid, signature: png, id: "x" }).success).toBe(false);
  });
});
