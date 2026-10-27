-- The landing's pricing cards link to /register?plan=<key>. The signup keeps the plan the
-- prospect picked so the ops alert shows it and provisioning starts the club on it.

-- AlterTable
ALTER TABLE `ClubSignupRequest` ADD COLUMN `plan` VARCHAR(191) NULL;
