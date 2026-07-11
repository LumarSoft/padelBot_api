-- AlterTable: answers captured by the step-by-step signup at /register.
-- All nullable — the commercial block is skippable and existing leads have none of it.
ALTER TABLE `ClubSignupRequest`
    ADD COLUMN `city` VARCHAR(191) NULL,
    ADD COLUMN `courtCount` INTEGER NULL,
    ADD COLUMN `courtType` VARCHAR(191) NULL,
    ADD COLUMN `slotDurationMinutes` INTEGER NULL,
    ADD COLUMN `openTime` VARCHAR(191) NULL,
    ADD COLUMN `closeTime` VARCHAR(191) NULL,
    ADD COLUMN `avgPriceCents` INTEGER NULL,
    ADD COLUMN `chargesDeposit` VARCHAR(191) NULL,
    ADD COLUMN `hasMercadoPago` VARCHAR(191) NULL,
    ADD COLUMN `currentSystem` VARCHAR(191) NULL,
    ADD COLUMN `biggestPain` VARCHAR(191) NULL,
    ADD COLUMN `fixedSlots` VARCHAR(191) NULL,
    ADD COLUMN `howFound` VARCHAR(191) NULL,
    ADD COLUMN `contactWindow` VARCHAR(191) NULL;
