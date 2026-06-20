-- CreateTable
CREATE TABLE `Booking` (
    `id` VARCHAR(191) NOT NULL,
    `slotId` VARCHAR(191) NOT NULL,
    `clubId` VARCHAR(191) NOT NULL,
    `playerName` VARCHAR(191) NOT NULL,
    `playerPhone` VARCHAR(191) NOT NULL,
    `status` ENUM('CONFIRMED', 'CANCELLED') NOT NULL DEFAULT 'CONFIRMED',
    `notes` VARCHAR(191) NULL,
    `bookedByUserId` INTEGER NULL,
    `recurringBookingId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Booking_clubId_idx`(`clubId`),
    INDEX `Booking_slotId_idx`(`slotId`),
    INDEX `Booking_recurringBookingId_idx`(`recurringBookingId`),
    INDEX `Booking_clubId_status_idx`(`clubId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RecurringBooking` (
    `id` VARCHAR(191) NOT NULL,
    `clubId` VARCHAR(191) NOT NULL,
    `courtId` VARCHAR(191) NOT NULL,
    `dayOfWeek` INTEGER NOT NULL,
    `slotStart` VARCHAR(191) NOT NULL,
    `slotEnd` VARCHAR(191) NOT NULL,
    `playerName` VARCHAR(191) NOT NULL,
    `playerPhone` VARCHAR(191) NOT NULL,
    `priceCents` INTEGER NOT NULL,
    `notes` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdByUserId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RecurringBooking_clubId_idx`(`clubId`),
    INDEX `RecurringBooking_courtId_idx`(`courtId`),
    INDEX `RecurringBooking_clubId_courtId_dayOfWeek_idx`(`clubId`, `courtId`, `dayOfWeek`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Booking` ADD CONSTRAINT `Booking_slotId_fkey` FOREIGN KEY (`slotId`) REFERENCES `Slot`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Booking` ADD CONSTRAINT `Booking_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Booking` ADD CONSTRAINT `Booking_bookedByUserId_fkey` FOREIGN KEY (`bookedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Booking` ADD CONSTRAINT `Booking_recurringBookingId_fkey` FOREIGN KEY (`recurringBookingId`) REFERENCES `RecurringBooking`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecurringBooking` ADD CONSTRAINT `RecurringBooking_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecurringBooking` ADD CONSTRAINT `RecurringBooking_courtId_fkey` FOREIGN KEY (`courtId`) REFERENCES `Court`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecurringBooking` ADD CONSTRAINT `RecurringBooking_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
