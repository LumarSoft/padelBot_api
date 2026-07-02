-- AlterTable: per-club payment verification mode (AUTO = MercadoPago reconciliation,
-- RECEIPT = player sends a receipt photo verified manually from the panel).
ALTER TABLE `Club` ADD COLUMN `paymentVerificationMode` ENUM('AUTO', 'RECEIPT') NOT NULL DEFAULT 'AUTO';

-- AlterTable: timestamp set when the player sends the transfer receipt (RECEIPT mode).
ALTER TABLE `Booking` ADD COLUMN `receiptUploadedAt` DATETIME(3) NULL;

-- CreateTable: receipt-photo metadata. The image bytes live in object storage; only the
-- storage key/URL and metadata are persisted here.
CREATE TABLE `PaymentReceipt` (
    `id` VARCHAR(191) NOT NULL,
    `bookingId` VARCHAR(191) NOT NULL,
    `clubId` VARCHAR(191) NOT NULL,
    `storageKey` VARCHAR(191) NOT NULL,
    `url` TEXT NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `waMediaId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PaymentReceipt_bookingId_idx`(`bookingId`),
    INDEX `PaymentReceipt_clubId_idx`(`clubId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PaymentReceipt` ADD CONSTRAINT `PaymentReceipt_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentReceipt` ADD CONSTRAINT `PaymentReceipt_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
