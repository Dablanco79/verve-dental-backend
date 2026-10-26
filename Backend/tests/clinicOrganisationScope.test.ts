import { createInMemoryClinicRepository } from "../src/repositories/clinicRepository.js";
import { createClinicService } from "../src/services/clinicService.js";
import type { AuthenticatedUser } from "../src/types/auth.js";

const HOME_CLINIC_ID = "33333333-3333-4333-8333-333333333333";
const SAME_ORG_CLINIC_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_ORG_CLINIC_ID = "55555555-5555-4555-8555-555555555555";
const HOME_ORGANISATION_ID = "66666666-6666-4666-8666-666666666666";
const OTHER_ORGANISATION_ID = "77777777-7777-4777-8777-777777777777";

const owner: AuthenticatedUser = {
  id: "88888888-8888-4888-8888-888888888888",
  email: "owner@example.test",
  role: "owner_admin",
  homeClinicId: HOME_CLINIC_ID,
  homeClinicName: "Home Clinic",
  firstName: "Owner",
  lastName: "Admin",
  displayName: "Owner Admin",
  permissions: [],
};

describe("clinic organisation compatibility", () => {
  it("lists only same-organisation clinics and inherits organisation on create", async () => {
    const repository = createInMemoryClinicRepository();
    await repository.create({
      id: HOME_CLINIC_ID,
      name: "Home Clinic",
      organisationId: HOME_ORGANISATION_ID,
    });
    await repository.create({
      id: SAME_ORG_CLINIC_ID,
      name: "Same Organisation Clinic",
      organisationId: HOME_ORGANISATION_ID,
    });
    await repository.create({
      id: OTHER_ORG_CLINIC_ID,
      name: "Other Organisation Clinic",
      organisationId: OTHER_ORGANISATION_ID,
    });
    const service = createClinicService(repository);

    const beforeCreate = await service.listClinics(owner);
    expect(beforeCreate.map((clinic) => clinic.id)).toEqual([
      HOME_CLINIC_ID,
      SAME_ORG_CLINIC_ID,
    ]);

    const created = await service.createClinic(owner, { name: "Inherited Organisation Clinic" });
    expect(created.organisationId).toBe(HOME_ORGANISATION_ID);

    const afterCreate = await service.listClinics(owner);
    expect(afterCreate.map((clinic) => clinic.id)).toContain(created.id);
    expect(afterCreate.map((clinic) => clinic.id)).not.toContain(OTHER_ORG_CLINIC_ID);
  });
});
