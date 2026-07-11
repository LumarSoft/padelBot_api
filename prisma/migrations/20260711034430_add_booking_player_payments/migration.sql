-- AlterTable
ALTER TABLE `Booking` ADD COLUMN `settledAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `BookingPlayerPayment` (
    `id` VARCHAR(191) NOT NULL,
    `bookingId` VARCHAR(191) NOT NULL,
    `clubId` VARCHAR(191) NOT NULL,
    `playerSlot` INTEGER NOT NULL,
    `amountCents` INTEGER NOT NULL,
    `method` ENUM('CASH', 'QR', 'TRANSFER') NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BookingPlayerPayment_bookingId_idx`(`bookingId`),
    INDEX `BookingPlayerPayment_clubId_idx`(`clubId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `BookingPlayerPayment` ADD CONSTRAINT `BookingPlayerPayment_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BookingPlayerPayment` ADD CONSTRAINT `BookingPlayerPayment_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
