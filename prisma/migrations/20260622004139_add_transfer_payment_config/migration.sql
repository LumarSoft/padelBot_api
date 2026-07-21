-- AlterTable
ALTER TABLE `Booking` ADD COLUMN `transferAmountCents` INTEGER NULL;

-- AlterTable
ALTER TABLE `Club` ADD COLUMN `transferAlias` VARCHAR(191) NULL,
    ADD COLUMN `transferHolder` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `Booking_status_transferAmountCents_idx` ON `Booking`(`status`, `transferAmountCents`);
