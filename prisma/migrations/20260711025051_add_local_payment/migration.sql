-- AlterTable
ALTER TABLE `Booking` ADD COLUMN `localPaymentCents` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `localPaymentMethod` VARCHAR(191) NULL;
