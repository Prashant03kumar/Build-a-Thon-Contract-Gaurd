-- Milestone 1b: idempotent imports need a stable natural key per source file.
-- One spec file may occupy exactly one slot per provider; re-imports update in
-- place instead of duplicating rows.
-- CreateIndex
CREATE UNIQUE INDEX `SpecVersion_providerId_fileName_key` ON `SpecVersion`(`providerId`, `fileName`);
