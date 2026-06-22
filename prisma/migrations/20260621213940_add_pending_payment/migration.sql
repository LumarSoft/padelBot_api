-- AlterTable
ALTER TABLE `Booking` ADD COLUMN `depositCents` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `mpPaymentId` VARCHAR(191) NULL,
    ADD COLUMN `mpPreferenceId` VARCHAR(191) NULL,
    ADD COLUMN `paymentExpiresAt` DATETIME(3) NULL,
    MODIFY `status` ENUM('PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED') NOT NULL DEFAULT 'PENDING_PAYMENT';

-- CreateIndex
CREATE INDEX `Booking_status_paymentExpiresAt_idx` ON `Booking`(`status`, `paymentExpiresAt`);
