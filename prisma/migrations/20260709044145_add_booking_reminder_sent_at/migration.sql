-- AlterTable
ALTER TABLE `Booking` ADD COLUMN `reminderSentAt` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `Booking_status_reminderSentAt_idx` ON `Booking`(`status`, `reminderSentAt`);
