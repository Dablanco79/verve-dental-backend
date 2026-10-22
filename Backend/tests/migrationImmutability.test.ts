/**
 * Source-level immutability gate for embedded migrations.
 *
 * This deliberately does not retrofit checksums into schema_migrations and
 * does not claim live-schema equivalence. It prevents an existing migration
 * body from being edited silently; schema changes must use a new migration ID.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "@jest/globals";

import { BOOTSTRAP_MIGRATIONS } from "../src/db/migrate.js";

const reviewedSqlHashes: Record<string, string> = {
  "003_users_schema": "1fbf626083b4dc1a8bf841afa40bbacfb3cdbcb23f24f3d2049bdfab6cb614d4",
  "004_rename_clinic_to_home_clinic": "f8285eff86e09d1e1a77525d57f49644207bd7e8d5e04d4faaf1d2d74ce98740",
  "005_inventory_schema": "fa5c199ea44977de74eef58360d17bf482f1626902562998d3abf13362af8cf7",
  "005a_inventory_unit_model": "af5e8e27caf7e200f84092899f32e12feaaca76df361cf9a76ca09fb9d0dfb55",
  "006_roster_schema": "645e17ca6850c2fc0b0e58826b222497ca11c0722c1d00e9a84c0c47c8b33e34",
  "007_roster_performance_indexes": "442e653b12d0a14517aff9fee2e58e15c3986764277159d3f06a5f5ca8752292",
  "008_payroll_and_leave_schema": "40b663f085378cb0ed1c763390d038a9d037b80a498d4723ad6b497182652804",
  "009_user_payroll_track": "15e29612f3ad273fd59148a9673b83274a05e8f023ec5340772367cbf3477c80",
  "010_leave_requests_staff_email": "fd9a384b26506740b6dea2c542f28e0f1b549e496ef083a1745111748b18be6b",
  "011_commission_log_state_check": "d93512332efdd1dbd995b90617243f59d33fe978a04e81c4f97684933c6d18ae",
  "012_clinics_schema": "ed6bdcc28ffa792b50806ee41c6f71d4766ebd88168754be3c8f3a2e287d5333",
  "013_billing_schema": "84fb385cab5e08bd7372e69437463c12801473261a8d622359ba0bd10860f93f",
  "014_analytics_audit_schema": "60b1d1a881b2567e787e76ac7e6b0dd1a3bf54406667540c017ac69d7e21f39e",
  "016_users_totp_secret": "cd63d1438c32a06cbabd76e962d4f031524f7291e58fa586e6fee1a47a30b166",
  "015_rls_policies": "af0469b5f127cdd6e2d07dce6705602667ed0f391b347b33f105e046de321074",
  "017_suppliers_schema": "d72851fc63f82face465cab3d0c25ff6c5f06def1aef318eb3099e53e6f70ac8",
  "018_supplier_catalogue_schema": "efc8732379cb6de50aaecaf3b1b425e738bcf0e9d6b5ef68bdf9e8d87d18faf2",
  "019_user_name_fields": "3a323b3605a7111443726186121adbed8f33719d4432766d94f22813a38d869d",
  "020_user_permission_grants": "59060e01b3d85da1f5435b58a48e031c16c6ee190dd097db0d1de733d90d00a6",
  "021_supplier_invoice_ocr": "9a2f844d0c29f56f4d883db052912b63898f168daa8472ddada8545bb84e48f0",
  "022_supplier_abn_address": "bf245d4f6ee82e0cb8fd1cc54b87558e75991fd8baf21aa90039e6f77854a7f2",
  "023_organisations_schema": "f9893239e40b57d6fd8fe4ef36b18477303939fe15775a887ff7a30f3577959e",
  "024_clinics_organisation_id": "b191b0bd71adfba4a6bb583526bbcce4fab75757a46faafa4a83e25d21a06339",
  "027_supplier_master_metadata": "3fcba816716d98557acb46a5d931871a78e038c9aa1f40f76582ab977ae6734d",
  "025_legal_entities_schema": "8d2ed6ee1e2ae23e302ba911cb5c1c41157b57c4e146b23362cc44409146d1d8",
  "026_clinics_legal_entity_id": "9024f3b19be8e249f1f44a9a3de8607fa44e94edf682da47bf1b0fed4b24a4db",
  "028_supplier_relationships": "d1d1ef99ef781a48d5aa9cd7984abac4b4ea1f91d418d7783e1b4de2ac0fca90",
  "029_procurement_policies": "27470044c10abcc168c2e78696e658dec876976db7fd989c3672af356307d9cc",
  "030_supplier_contracts": "608e76ebad99aa86865ab86348eb095780e8f72a548861b9232c25e0e33a0d16",
  "031_supplier_contract_prices": "e7a9f0298f37caed2bd6cd60fd75b4acbfd888017ec38473c1a8b1455c666aa6",
  "032_product_suppliers": "f1751d75b1d9fc29702927c1b593ffedf83c800b02d272840622310f0bcfc885",
  "033_import_job_lifecycle": "7a9d55f4ac92dddad385447233cf24299d0277bbf0c7c294c0faf49d09d1f42c",
  "034_master_product_library": "af5dfc22ed2101d6006925987cd29bf83cfd462acfef99932f639458f71d9e31",
  "035_master_product_management_indexes": "7bc315d3e1dd425b156a54893ce6c3d96a8060232dbe03388e3503335610c2c5",
  "036_product_matching_engine": "de96349eb1a738b9bde8ef843acc6b7033bf56f45d3205cbd5c01b94c5f81d38",
  "037_stocktake_schema": "b9674e3bbcf5c2249d642f237eeb1dc195f59e777e0aa071b4d9a1417860ecd3",
  "039_supplier_invoice_receiving_lifecycle": "8f4bd7e13822834c9e877f552208793ccef7b88bc1b1a9983600e98a5679eb98",
  "038_stocktake_line_snapshot": "68e2cace75f40f94d9927321133a99e1cc62e53b10c68f1b236fc81eb335785f",
  "040_invoice_line_review_decision": "f523bcc0cb91b306482189a7dc5dbbaaa47858c6a23c9513f86681b5d00ebb97",
  "041_invoice_line_product_creation_data": "46d5e947b236979a737dde3c8a969a4ebc899708cf1f33de2eff58d6921a1f84",
  "042_purchase_order_lifecycle": "62664f1d64e360fdb01f505ced6ee0184b269f885a41949c085413e58099e355",
  "043_po_line_received_quantity": "15d2c1b2b35028841b79131af5def2f726105bec8582de47c54daae378c2fbf6",
  "044_purchasing_drafts": "96a4e7750878891efe13b45dc80835e89d8fa9127f94ff5e312ab49d3ad433e0",
  "045_supplier_invoice_line_financial_truth": "15336d8d899f61631a8c68f96b1a656b73dc753900840b35f1352c3fc7b9f9bf",
  "046_supplier_catalogue_sku_exclusive": "68b989f64942ebb36aba7a656036e51cf74ee77228ecd95894a263ed6811f7ff",
  "047_user_clinic_assignments": "1e7b5de55587b4e01d2115646405ac6725d127e2176dc011cbf7710b99864ac4",
  "048_rls_own_roster_entries": "01b4cfe65aad6103a7efd72df82e54c9d6deac0cdb6c21614be0312e4c523f37",
  "049_clinic_preferred_name": "7158e8581f99e237486ddc483ca0cdffcb2ba857a94f6d588bb22beeb0aea2d0",
  "050_fix_timesheet_roster_unique": "abbee2789066a1669855b2abaa3b6eec2deb7df46678304c5e240267fd6ad5dc",
  "051_geofence_columns": "b51b99d24aed5ef53f314d2a3cdc50fbc7d33fb8631240c2eef3d1b276e75542",
  "052_module_permissions_backfill": "1d2d77488fbe3171085f1cb94819e9add3c749bdec5987a927df5ef8442e4be7",
  "053_timesheet_staff_notes": "74e9380114e4822675443500f7c60dcd36d9b23f0ab3ff54726f664b4bd9491e",
  "054_staff_pay_rates": "4c1794dccd29e0cd0d3204a1b4a54256c2e886da4c18f0e6cc867f9d0b018ab0",
  "055_leave_pilot_safety": "a398a16be85e970e8a58a6682ba02d1130c89b6a871f491778576d1eac4c6f28",
  "056_approved_leave_cancellation": "5c046bc540c77d7ac17f3824b1d7d819ebf27158a637599cb64578dd37054e20",
  "057_leave_cancellation_requests": "d87ec182cc4291ae8b6156de0ab3be9f578350893d09af5b2e56573167e71e29",
  "059_force_workflow_table_rls": "38201cb05d0d7955f466d7487669e9b68f863f3aa1fc760815e7e0761b432362",
  "060_leave_coverage_groups": "13a00bdc0f2003b4f45a72af7654b5bc5ee9db3b79f7a72b5bec85326f3dea36",
};

describe("embedded migration immutability", () => {
  it("has one reviewed hash for every migration ID and no duplicate IDs", () => {
    const ids = BOOTSTRAP_MIGRATIONS.map((migration) => migration.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(reviewedSqlHashes)).toEqual(ids);
  });

  it("does not modify reviewed migration SQL in place", () => {
    for (const migration of BOOTSTRAP_MIGRATIONS) {
      const actual = createHash("sha256")
        .update(migration.sql, "utf8")
        .digest("hex");
      expect({
        id: migration.id,
        sha256: actual,
      }).toEqual({
        id: migration.id,
        sha256: reviewedSqlHashes[migration.id],
      });
    }
  });
});
