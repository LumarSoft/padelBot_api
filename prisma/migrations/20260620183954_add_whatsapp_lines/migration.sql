-- CreateTable
CREATE TABLE `WhatsAppLine` (
    `id` VARCHAR(191) NOT NULL,
    `phoneNumberId` VARCHAR(191) NOT NULL,
    `displayPhone` VARCHAR(191) NOT NULL,
    `clubId` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WhatsAppLine_phoneNumberId_key`(`phoneNumberId`),
    INDEX `WhatsAppLine_clubId_idx`(`clubId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `WhatsAppLine` ADD CONSTRAINT `WhatsAppLine_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
