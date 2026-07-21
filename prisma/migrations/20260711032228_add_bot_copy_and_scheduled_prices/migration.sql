-- AlterTable
ALTER TABLE `Club` ADD COLUMN `botWelcomeExtra` TEXT NULL,
    ADD COLUMN `locationInfo` TEXT NULL;

-- CreateTable
CREATE TABLE `ScheduledPriceAdjustment` (
    `id` VARCHAR(191) NOT NULL,
    `clubId` VARCHAR(191) NOT NULL,
    `percent` DOUBLE NOT NULL,
    `effectiveDateKey` VARCHAR(191) NOT NULL,
    `appliedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ScheduledPriceAdjustment_clubId_idx`(`clubId`),
    INDEX `ScheduledPriceAdjustment_appliedAt_effectiveDateKey_idx`(`appliedAt`, `effectiveDateKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ScheduledPriceAdjustment` ADD CONSTRAINT `ScheduledPriceAdjustment_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
