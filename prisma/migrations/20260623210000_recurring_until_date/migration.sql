-- AlterTable: optional end date for a recurring booking's weekly blocking.
ALTER TABLE `RecurringBooking` ADD COLUMN `untilDate` DATETIME(3) NULL;
