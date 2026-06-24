-- CreateTable: per-time-band price exceptions for a court.
CREATE TABLE `CourtPriceRule` (
    `id` VARCHAR(191) NOT NULL,
    `clubId` VARCHAR(191) NOT NULL,
    `courtId` VARCHAR(191) NOT NULL,
    `dayOfWeek` INTEGER NULL,
    `startTime` VARCHAR(191) NOT NULL,
    `priceCents` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CourtPriceRule_courtId_dayOfWeek_startTime_key`(`courtId`, `dayOfWeek`, `startTime`),
    INDEX `CourtPriceRule_clubId_idx`(`clubId`),
    INDEX `CourtPriceRule_courtId_idx`(`courtId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CourtPriceRule` ADD CONSTRAINT `CourtPriceRule_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CourtPriceRule` ADD CONSTRAINT `CourtPriceRule_courtId_fkey` FOREIGN KEY (`courtId`) REFERENCES `Court`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
