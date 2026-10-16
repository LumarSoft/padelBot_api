-- The ops console's follow-up and growth tools: our notes per club (its ficha), the lead
-- follow-up (call-back date, why we lost it, the UTM campaign it came from), anonymous visits
-- per /register screen (where prospects drop out), and each club's subscription per month
-- (monthly recurring revenue, new paying clubs and churn).

-- AlterTable
ALTER TABLE `Club` ADD COLUMN `opsNotes` TEXT NULL;
-- AlterTable
ALTER TABLE `ClubSignupRequest` ADD COLUMN `followUpAt` DATETIME(3) NULL,
    ADD COLUMN `lostReason` VARCHAR(191) NULL,
    ADD COLUMN `utmCampaign` VARCHAR(191) NULL,
    ADD COLUMN `utmMedium` VARCHAR(191) NULL,
    ADD COLUMN `utmSource` VARCHAR(191) NULL;
-- CreateTable
CREATE TABLE `SignupFunnelDaily` (
    `id` VARCHAR(191) NOT NULL,
    `dateKey` VARCHAR(191) NOT NULL,
    `step` VARCHAR(191) NOT NULL,
    `stepIndex` INTEGER NOT NULL,
    `visits` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `SignupFunnelDaily_dateKey_idx`(`dateKey`),
    UNIQUE INDEX `SignupFunnelDaily_dateKey_step_key`(`dateKey`, `step`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- CreateTable
CREATE TABLE `ClubMonthState` (
    `id` VARCHAR(191) NOT NULL,
    `clubId` VARCHAR(191) NOT NULL,
    `month` VARCHAR(191) NOT NULL,
    `clubName` VARCHAR(191) NOT NULL,
    `plan` VARCHAR(191) NOT NULL,
    `subscriptionStatus` ENUM('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED') NOT NULL,
    `mrrCents` INTEGER NOT NULL,
    `isDemo` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `ClubMonthState_month_idx`(`month`),
    UNIQUE INDEX `ClubMonthState_clubId_month_key`(`clubId`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- CreateIndex
CREATE INDEX `ClubSignupRequest_followUpAt_idx` ON `ClubSignupRequest`(`followUpAt`);
